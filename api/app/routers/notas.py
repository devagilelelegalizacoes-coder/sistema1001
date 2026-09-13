from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..models import Nota, NotaItem, Processo, Usuario
from ..regras import totais_nota
from ..schemas import NotaAtualizar, NotaCriar, NotaOut
from ..seguranca import exige_papel

# faturamento é papel de admin — o operador comum não vê valores
router = APIRouter(prefix="/notas", tags=["notas"],
                   dependencies=[Depends(exige_papel("admin"))])


def _saida(n: Nota) -> NotaOut:
    t = totais_nota([{"despesa": i.despesa, "valor_nota": i.valor_nota} for i in n.itens])
    return NotaOut(
        id=n.id, referencia=n.referencia, numero_nf=n.numero_nf, data_emissao=n.data_emissao,
        data_envio=n.data_envio, data_pagamento=n.data_pagamento, status=n.status,
        destinatario=n.destinatario, quantidade=t["quantidade"], despesas=t["despesas"],
        valor=t["valor"], diferenca=t["diferenca"],
    )


@router.get("", response_model=list[NotaOut])
def listar(db: Session = Depends(get_db)):
    q = select(Nota).options(selectinload(Nota.itens)).order_by(Nota.criado_em.desc())
    return [_saida(n) for n in db.scalars(q).all()]


@router.get("/faturaveis")
def faturaveis(db: Session = Depends(get_db)):
    """Processos prontos e ainda não faturados — é a lista que o operador tica."""
    ja = select(NotaItem.processo_id)
    q = (select(Processo)
         .options(selectinload(Processo.veiculo), selectinload(Processo.lote))
         .where(Processo.etapa == "Concluído", Processo.id.not_in(ja))
         .order_by(Processo.data_recebimento))
    return [
        {"processo_id": p.id, "placa": p.veiculo.placa, "numero_ordem": p.veiculo.numero_ordem,
         "tipo_servico": p.tipo_servico, "lote": p.lote.nome if p.lote else None}
        for p in db.scalars(q).all()
    ]


@router.post("", response_model=NotaOut, status_code=201)
def criar(dados: NotaCriar, db: Session = Depends(get_db),
          usuario: Usuario = Depends(exige_papel("admin"))):
    nota = Nota(referencia=dados.referencia, destinatario=dados.destinatario,
                criado_por_id=usuario.id)
    for item in dados.itens:
        nota.itens.append(NotaItem(processo_id=item.processo_id, despesa=item.despesa,
                                   valor_nota=item.valor_nota))
    db.add(nota)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Um dos veículos já está em outra nota")
    db.refresh(nota)
    return _saida(nota)


@router.patch("/{nota_id}", response_model=NotaOut)
def atualizar(nota_id: int, dados: NotaAtualizar, db: Session = Depends(get_db)):
    nota = db.get(Nota, nota_id)
    if not nota:
        raise HTTPException(404, "Nota não encontrada")
    campos = dados.model_dump(exclude_unset=True, exclude={"itens"})
    for campo, valor in campos.items():
        setattr(nota, campo, valor)
    if dados.itens is not None:
        nota.itens.clear()
        db.flush()
        for item in dados.itens:
            nota.itens.append(NotaItem(processo_id=item.processo_id, despesa=item.despesa,
                                       valor_nota=item.valor_nota))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Um dos veículos já está em outra nota")
    db.refresh(nota)
    return _saida(nota)


def montar_resumo(db: Session, nota: Nota) -> str:
    """Texto do e-mail. Mesmo formato que o protótipo já enviava."""
    t = totais_nota([{"despesa": i.despesa, "valor_nota": i.valor_nota} for i in nota.itens])
    brl = lambda v: f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    linhas = ["RESUMO DA NOTA FISCAL — AUTO VIAÇÃO 1001 LTDA", ""]
    if nota.referencia:
        linhas.append(f"Referência: {nota.referencia}")
    if nota.numero_nf:
        linhas.append(f"Nota fiscal nº {nota.numero_nf}")
    if nota.data_emissao:
        linhas.append(f"Emissão: {nota.data_emissao.strftime('%d/%m/%Y')}")
    linhas += ["", f"{'ORDEM':<8}{'PLACA':<11}{'SERVIÇO':<15}{'DESPESA':>13}{'VALOR DA NOTA':>16}"]
    for i in nota.itens:
        v = i.processo.veiculo
        linhas.append(f"{(v.numero_ordem or '—'):<8}{v.placa:<11}"
                      f"{i.processo.tipo_servico:<15}{brl(i.despesa):>13}{brl(i.valor_nota):>16}")
    linhas += ["", f"{t['quantidade']} veículos",
               f"Total de despesas: {brl(t['despesas'])}",
               f"VALOR TOTAL DA NOTA: {brl(t['valor'])}"]
    if nota.observacoes:
        linhas += ["", f"Obs.: {nota.observacoes}"]
    return "\n".join(linhas)


@router.get("/{nota_id}/resumo")
def resumo(nota_id: int, db: Session = Depends(get_db)):
    nota = db.get(Nota, nota_id)
    if not nota:
        raise HTTPException(404, "Nota não encontrada")
    return {"assunto": f"Resumo da nota fiscal — {nota.referencia}",
            "corpo": montar_resumo(db, nota)}


@router.post("/{nota_id}/enviar")
def enviar(nota_id: int, db: Session = Depends(get_db)):
    from ..email import enviar_email
    nota = db.get(Nota, nota_id)
    if not nota:
        raise HTTPException(404, "Nota não encontrada")
    if not nota.destinatario:
        raise HTTPException(400, "Informe o destinatário antes de enviar")
    assunto = f"Resumo da nota fiscal — {nota.referencia}"
    if nota.numero_nf:
        assunto += f" (NF {nota.numero_nf})"
    enviar_email(nota.destinatario, assunto, montar_resumo(db, nota))
    nota.data_envio = datetime.now(timezone.utc)
    if nota.status == "rascunho":
        nota.status = "enviada"
    db.commit()
    return {"enviado_para": nota.destinatario, "em": nota.data_envio}
