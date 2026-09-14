from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..models import Lote, Nota, Processo, Usuario
from ..regras import DIAS_ALERTA, DIAS_ENCAIXE, Status, calcular_imposto, calcular_status
from ..schemas import LinhaMensal
from ..seguranca import exige_papel, usuario_atual

router = APIRouter(prefix="/relatorios", tags=["relatorios"])


@router.get("/mensal", response_model=list[LinhaMensal], dependencies=[Depends(exige_papel("admin"))])
def mensal(db: Session = Depends(get_db)):
    """Fechamento por mês de emissão da nota. Sem emissão cai em 'a emitir'.
    Imposto (6% sobre o valor) e lucro líquido são calculados por nota e somados —
    não sobre o total do mês, pra bater com o que sai em cada nota individual."""
    q = select(Nota).options(selectinload(Nota.itens))
    meses: dict[str, dict] = defaultdict(
        lambda: {"notas": 0, "despesas": Decimal("0"), "valor": Decimal("0"),
                 "diferenca": Decimal("0"), "imposto": Decimal("0"),
                 "lucro_liquido": Decimal("0"), "recebido": Decimal("0")}
    )
    for n in db.scalars(q).all():
        chave = n.data_emissao.strftime("%Y-%m") if n.data_emissao else "a emitir"
        desp = sum((i.despesa for i in n.itens), Decimal("0"))
        val = sum((i.valor_nota for i in n.itens), Decimal("0"))
        diferenca = val - desp
        imposto = calcular_imposto(val, n.data_emissao.year if n.data_emissao else None)
        m = meses[chave]
        m["notas"] += 1
        m["despesas"] += desp
        m["valor"] += val
        m["diferenca"] += diferenca
        m["imposto"] += imposto
        m["lucro_liquido"] += diferenca - imposto
        if n.status == "paga":
            m["recebido"] += val
    return [{"mes": k, **v} for k, v in sorted(meses.items(), reverse=True)]


@router.get("/alertas")
def alertas(db: Session = Depends(get_db), _: Usuario = Depends(usuario_atual)):
    """O que o vigia de prazo do n8n consulta toda manhã."""
    hoje = date.today()
    q = select(Processo).options(selectinload(Processo.veiculo), selectinload(Processo.lote))
    atrasados, proximos, exigencias = [], [], []
    for p in db.scalars(q).all():
        st = calcular_status(p.etapa, p.data_limite, hoje)
        item = {"processo_id": p.id, "placa": p.veiculo.placa,
                "tipo_servico": p.tipo_servico, "lote": p.lote.nome if p.lote else None,
                "data_limite": p.data_limite, "dias": (p.data_limite - hoje).days,
                "exigencia": p.exigencia}
        if st == Status.ATRASADO:
            atrasados.append(item)
        elif st == Status.PRAZO_PROXIMO:
            proximos.append(item)
        elif st == Status.EXIGENCIA:
            exigencias.append(item)

    # vistorias cuja janela de encaixe fecha hoje ou amanhã
    limite = hoje + timedelta(days=DIAS_ENCAIXE + 1)
    encaixes = [
        {"lote": l.nome, "data_vistoria": l.data_vistoria,
         "fecha_em": l.data_vistoria - timedelta(days=DIAS_ENCAIXE)}
        for l in db.scalars(
            select(Lote).where(Lote.data_vistoria.is_not(None),
                               Lote.data_vistoria >= hoje,
                               Lote.data_vistoria <= limite)
        ).all()
    ]
    return {"atrasados": atrasados, "prazo_proximo": proximos,
            "exigencias": exigencias, "encaixe_fechando": encaixes,
            "dias_alerta": DIAS_ALERTA}
