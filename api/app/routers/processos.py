from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..models import Anexo, Auditoria, Empresa, Lote, Processo, Usuario, Veiculo
from ..regras import ETAPA_CONCLUIDO, ETAPAS, PRAZO_PADRAO, Status, TipoServico, calcular_status
from ..schemas import EtapaEmLote, ProcessoAtualizar, ProcessoCriar, ProcessoOut
from ..seguranca import exige_papel, usuario_atual

router = APIRouter(prefix="/processos", tags=["processos"])


@router.get("", response_model=list[ProcessoOut])
def listar(
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(usuario_atual),
    tipo: str | None = None,
    lote: str | None = None,
    status: str | None = None,
    placa: str | None = None,
    de: date | None = None,
    ate: date | None = None,
    arquivado: bool = False,
    limite: int = Query(500, le=2000),
):
    q = (
        select(Processo)
        .options(selectinload(Processo.veiculo), selectinload(Processo.lote),
                 selectinload(Processo.anexos))
        .order_by(Processo.data_recebimento.desc(), Processo.id)
    )
    # tela principal só mostra o que está ativo; a aba Arquivados pede ?arquivado=true
    q = q.where(Processo.arquivado_em.is_not(None) if arquivado else Processo.arquivado_em.is_(None))
    if tipo:
        q = q.where(Processo.tipo_servico == tipo)
    if lote:
        q = q.join(Lote).where(Lote.nome == lote)
    if placa:
        q = q.join(Veiculo).where(Veiculo.placa.ilike(f"%{placa}%"))
    if de:
        q = q.where(Processo.data_recebimento >= de)
    if ate:
        q = q.where(Processo.data_recebimento <= ate)
    # cliente só enxerga a própria empresa
    if usuario.papel == "cliente" and usuario.empresa_id:
        q = q.where(Processo.empresa_id == usuario.empresa_id)

    itens = db.scalars(q.limit(limite)).all()
    empresas = {e.id: e.razao_social for e in db.scalars(select(Empresa)).all()}
    hoje = date.today()

    saida = []
    for p in itens:
        st = calcular_status(p.etapa, p.data_limite, hoje).value
        if status and st != status:
            continue
        saida.append(ProcessoOut(
            id=p.id, tipo_servico=p.tipo_servico, tipo_avulso=p.tipo_avulso,
            lote=p.lote.nome if p.lote else None,
            placa=p.veiculo.placa, renavam=p.veiculo.renavam, numero_ordem=p.veiculo.numero_ordem,
            empresa=empresas.get(p.empresa_id, ""),
            data_recebimento=p.data_recebimento, prazo_dias=p.prazo_dias,
            data_limite=p.data_limite, etapa=p.etapa, status=st,
            dias_restantes=(p.data_limite - hoje).days,
            exigencia=p.exigencia, observacoes=p.observacoes, qtd_anexos=len(p.anexos),
            arquivado_em=p.arquivado_em,
        ))
    return saida


@router.get("/resumo")
def resumo(db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_atual)):
    """Contadores por status — é o que o painel mostra no topo."""
    hoje = date.today()
    q = select(Processo).options(selectinload(Processo.veiculo)).where(Processo.arquivado_em.is_(None))
    if usuario.papel == "cliente" and usuario.empresa_id:
        q = q.where(Processo.empresa_id == usuario.empresa_id)
    contagem = {s.value: 0 for s in Status}
    for p in db.scalars(q).all():
        contagem[calcular_status(p.etapa, p.data_limite, hoje).value] += 1
    return contagem


@router.post("", response_model=ProcessoOut, status_code=201)
def criar(
    dados: ProcessoCriar,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(exige_papel("admin", "operador", "despachante")),
):
    tipo = TipoServico(dados.tipo_servico)
    veiculo = db.scalar(select(Veiculo).where(Veiculo.placa == dados.placa.upper()))
    if not veiculo:
        veiculo = Veiculo(placa=dados.placa.upper(), renavam=dados.renavam,
                          numero_ordem=dados.numero_ordem)
        db.add(veiculo)
        db.flush()

    cnpj = dados.empresa_cnpj or "30.069.314/0001-01"
    empresa = db.scalar(select(Empresa).where(Empresa.cnpj == cnpj))
    if not empresa:
        raise HTTPException(400, f"Empresa {cnpj} não cadastrada")

    lote = None
    if dados.lote_nome:
        lote = db.scalar(select(Lote).where(Lote.nome == dados.lote_nome))
        if not lote:
            lote = Lote(nome=dados.lote_nome, tipo_servico=tipo.value)
            db.add(lote)
            db.flush()

    p = Processo(
        veiculo_id=veiculo.id, empresa_id=empresa.id, lote_id=lote.id if lote else None,
        tipo_servico=tipo.value, tipo_avulso=dados.tipo_avulso,
        data_recebimento=dados.data_recebimento,
        prazo_dias=dados.prazo_dias or PRAZO_PADRAO[tipo],
        etapa=dados.etapa or ETAPAS[tipo][0],
        exigencia=dados.exigencia, data_reagendamento=dados.data_reagendamento,
        observacoes=dados.observacoes, duda_tp=dados.duda_tp,
        data_venda=dados.data_venda, numero_crv=dados.numero_crv,
        responsavel_id=usuario.id, origem="manual",
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _com_empresa(db, p)


_SEM_VALOR = object()   # distingue "campo não veio no PATCH" de "veio como null/vazio"


@router.patch("/{processo_id}", response_model=ProcessoOut)
def atualizar(
    processo_id: int,
    dados: ProcessoAtualizar,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(exige_papel("admin", "operador", "despachante")),
):
    p = db.get(Processo, processo_id)
    if not p:
        raise HTTPException(404, "Processo não encontrado")

    campos = dados.model_dump(exclude_unset=True)
    # não são colunas de Processo — número de ordem/renavam são do veículo,
    # e empresa_cnpj resolve pra empresa_id. A placa não se corrige por aqui:
    # é a chave que casa com o DETRAN, então trocar tem que ser deliberado.
    numero_ordem = campos.pop("numero_ordem", _SEM_VALOR)
    renavam = campos.pop("renavam", _SEM_VALOR)
    empresa_cnpj = campos.pop("empresa_cnpj", _SEM_VALOR)

    antes = {"etapa": p.etapa, "exigencia": p.exigencia, "prazo_dias": p.prazo_dias,
             "numero_ordem": p.veiculo.numero_ordem, "renavam": p.veiculo.renavam,
             "empresa_id": p.empresa_id}

    for campo, valor in campos.items():
        setattr(p, campo, valor)

    if numero_ordem is not _SEM_VALOR:
        p.veiculo.numero_ordem = numero_ordem or None
    if renavam is not _SEM_VALOR:
        p.veiculo.renavam = renavam or None
    if empresa_cnpj not in (_SEM_VALOR, None, ""):
        empresa = db.scalar(select(Empresa).where(Empresa.cnpj == empresa_cnpj))
        if not empresa:
            raise HTTPException(400, f"Empresa {empresa_cnpj} não cadastrada")
        p.empresa_id = empresa.id

    depois = {"etapa": p.etapa, "exigencia": p.exigencia, "prazo_dias": p.prazo_dias,
              "numero_ordem": p.veiculo.numero_ordem, "renavam": p.veiculo.renavam,
              "empresa_id": p.empresa_id}

    db.add(Auditoria(usuario_id=usuario.id, entidade="processo", entidade_id=p.id,
                     acao="update", antes=antes, depois=depois))
    db.commit()
    db.refresh(p)
    return _com_empresa(db, p)


@router.post("/{processo_id}/arquivar", response_model=ProcessoOut)
def arquivar(processo_id: int, db: Session = Depends(get_db),
             usuario: Usuario = Depends(exige_papel("admin", "operador", "despachante"))):
    p = db.get(Processo, processo_id)
    if not p:
        raise HTTPException(404, "Processo não encontrado")
    if p.etapa != ETAPA_CONCLUIDO:
        raise HTTPException(400, "Só é possível arquivar processo concluído")
    if p.arquivado_em:
        raise HTTPException(400, "Processo já está arquivado")
    p.arquivado_em = datetime.now(timezone.utc)
    db.add(Auditoria(usuario_id=usuario.id, entidade="processo", entidade_id=p.id,
                     acao="arquivar", antes={"arquivado_em": None},
                     depois={"arquivado_em": p.arquivado_em.isoformat()}))
    db.commit()
    db.refresh(p)
    return _com_empresa(db, p)


@router.post("/{processo_id}/desarquivar", response_model=ProcessoOut)
def desarquivar(processo_id: int, db: Session = Depends(get_db),
                usuario: Usuario = Depends(exige_papel("admin", "operador", "despachante"))):
    p = db.get(Processo, processo_id)
    if not p:
        raise HTTPException(404, "Processo não encontrado")
    if not p.arquivado_em:
        raise HTTPException(400, "Processo não está arquivado")
    antes = p.arquivado_em.isoformat()
    p.arquivado_em = None
    db.add(Auditoria(usuario_id=usuario.id, entidade="processo", entidade_id=p.id,
                     acao="desarquivar", antes={"arquivado_em": antes}, depois={"arquivado_em": None}))
    db.commit()
    db.refresh(p)
    return _com_empresa(db, p)


@router.patch("/lote/{lote_id}/etapa")
def mudar_etapa_em_lote(
    lote_id: int,
    dados: EtapaEmLote,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(exige_papel("admin", "operador", "despachante")),
):
    """Move todos os processos de um lote pra mesma etapa de uma vez —
    é o que acontece de verdade quando a equipe volante termina a vistoria
    de um lote inteiro no mesmo dia."""
    processos = db.scalars(select(Processo).where(Processo.lote_id == lote_id)).all()
    if not processos:
        raise HTTPException(404, "Lote sem processos")
    for p in processos:
        db.add(Auditoria(usuario_id=usuario.id, entidade="processo", entidade_id=p.id,
                         acao="update_lote", antes={"etapa": p.etapa}, depois={"etapa": dados.etapa}))
        p.etapa = dados.etapa
    db.commit()
    return {"lote_id": lote_id, "atualizados": len(processos), "etapa": dados.etapa}


@router.post("/lote/{lote_id}/arquivar")
def arquivar_lote(
    lote_id: int,
    db: Session = Depends(get_db),
    usuario: Usuario = Depends(exige_papel("admin", "operador", "despachante")),
):
    """Arquiva de uma vez todo processo do lote que já estiver concluído.
    O que ainda não terminou fica de fora — não é ignorado, é contado
    separado, pra quem clicou saber que sobrou algo pra fechar ainda."""
    processos = db.scalars(select(Processo).where(Processo.lote_id == lote_id)).all()
    if not processos:
        raise HTTPException(404, "Lote sem processos")
    arquivados = 0
    ignorados = 0
    for p in processos:
        if p.etapa != ETAPA_CONCLUIDO or p.arquivado_em:
            ignorados += 1
            continue
        p.arquivado_em = datetime.now(timezone.utc)
        db.add(Auditoria(usuario_id=usuario.id, entidade="processo", entidade_id=p.id,
                         acao="arquivar_lote", antes={"arquivado_em": None},
                         depois={"arquivado_em": p.arquivado_em.isoformat()}))
        arquivados += 1
    db.commit()
    return {"lote_id": lote_id, "arquivados": arquivados, "ignorados": ignorados}


def _com_empresa(db: Session, p: Processo) -> ProcessoOut:
    hoje = date.today()
    empresa = db.get(Empresa, p.empresa_id)
    return ProcessoOut(
        id=p.id, tipo_servico=p.tipo_servico, tipo_avulso=p.tipo_avulso,
        lote=p.lote.nome if p.lote else None,
        placa=p.veiculo.placa, renavam=p.veiculo.renavam, numero_ordem=p.veiculo.numero_ordem,
        empresa=empresa.razao_social if empresa else "",
        data_recebimento=p.data_recebimento, prazo_dias=p.prazo_dias, data_limite=p.data_limite,
        etapa=p.etapa, status=calcular_status(p.etapa, p.data_limite, hoje).value,
        dias_restantes=(p.data_limite - hoje).days,
        exigencia=p.exigencia, observacoes=p.observacoes, qtd_anexos=len(p.anexos),
        arquivado_em=p.arquivado_em,
    )


@router.get("/exportar.xlsx")
def exportar(db: Session = Depends(get_db), usuario: Usuario = Depends(usuario_atual)):
    """Gera a planilha a partir do banco — substitui a exportação manual."""
    import io

    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill

    wb = Workbook()
    wb.remove(wb.active)
    empresas = {e.id: e.razao_social for e in db.scalars(select(Empresa)).all()}
    hoje = date.today()
    cabecalho = ["Placa", "Renavam", "Nº ordem", "Empresa", "Lote", "Recebido",
                 "Prazo", "Limite", "Etapa", "Status", "Exigência", "Observações"]

    for tipo in TipoServico:
        ws = wb.create_sheet(tipo.value.upper()[:31])
        for i, titulo in enumerate(cabecalho, 1):
            c = ws.cell(row=1, column=i, value=titulo)
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = PatternFill("solid", fgColor="2E75B6")
            c.alignment = Alignment(horizontal="center")
        linha = 2
        q = (select(Processo).where(Processo.tipo_servico == tipo.value)
             .options(selectinload(Processo.veiculo), selectinload(Processo.lote)))
        for p in db.scalars(q).all():
            ws.append([
                p.veiculo.placa, p.veiculo.renavam, p.veiculo.numero_ordem,
                empresas.get(p.empresa_id, ""), p.lote.nome if p.lote else "",
                p.data_recebimento, p.prazo_dias, p.data_limite, p.etapa,
                calcular_status(p.etapa, p.data_limite, hoje).value,
                p.exigencia or "", p.observacoes or "",
            ])
            linha += 1
        for col, larg in zip("ABCDEFGHIJKL", [11, 14, 10, 24, 24, 12, 8, 12, 26, 16, 34, 60]):
            ws.column_dimensions[col].width = larg
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = f"A1:L{max(linha - 1, 1)}"

    buf = io.BytesIO()
    wb.save(buf)
    return Response(
        buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="processos_1001.xlsx"'},
    )
