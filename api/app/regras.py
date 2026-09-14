"""Regras de negócio puras — sem banco, sem HTTP. É o que os testes cobrem.

A lógica aqui é a mesma validada no protótipo entre julho e setembro de 2026.
"""
from datetime import date, timedelta
from decimal import Decimal
from enum import StrEnum


class TipoServico(StrEnum):
    VOLANTE = "volante"
    ATPVE = "atpve"
    LICENCIAMENTO = "licenciamento"
    AVULSO = "avulso"


class Status(StrEnum):
    NO_PRAZO = "no_prazo"
    PRAZO_PROXIMO = "prazo_proximo"
    ATRASADO = "atrasado"
    EXIGENCIA = "exigencia"
    PARADO = "parado"
    CONCLUIDO = "concluido"


ETAPA_CONCLUIDO = "Concluído"
ETAPA_EXIGENCIA = "Exigência aberta"
ETAPA_PARADO_PREFIXO = "Faltou"

PRAZO_PADRAO: dict[TipoServico, int] = {
    TipoServico.VOLANTE: 15,
    TipoServico.ATPVE: 1,
    TipoServico.LICENCIAMENTO: 2,
    TipoServico.AVULSO: 5,
}

# Etapas de cada esteira, na ordem. As duas últimas são transversais.
ETAPAS: dict[TipoServico, list[str]] = {
    TipoServico.VOLANTE: [
        "Recebido",
        "Documentos conferidos",
        "Débitos levantados",
        "Formulário preenchido",
        "Solicitação enviada",
        "Garagem avisada",
        "Vistoria confirmada",
        "Vistoria realizada",
        "Enviado para emissão",
        ETAPA_EXIGENCIA,
        "Faltou / reagendar",
        ETAPA_CONCLUIDO,
    ],
    TipoServico.ATPVE: [
        "Recebido",
        "Agendado no DETRAN",
        "Documento conferido",
        "Formulário preenchido",
        ETAPA_EXIGENCIA,
        ETAPA_CONCLUIDO,
    ],
    TipoServico.LICENCIAMENTO: [
        "Recebido",
        "Débitos conferidos",
        "Formulário preenchido",
        ETAPA_EXIGENCIA,
        ETAPA_CONCLUIDO,
    ],
    TipoServico.AVULSO: [
        "Recebido",
        "Em análise",
        "Em andamento",
        ETAPA_EXIGENCIA,
        "Faltou / parado",
        ETAPA_CONCLUIDO,
    ],
}

DIAS_ALERTA = 2          # amarelo quando faltam 2 dias ou menos
DIAS_ENCAIXE = 2         # encaixe permitido até 2 dias antes da vistoria

DESPESA_COM_VISTORIA = Decimal("190.00")
DESPESA_SEM_VISTORIA = Decimal("50.00")

# Alíquota do imposto sobre o valor da nota, por ano. Muda de ano para ano —
# quando mudar (ex.: 2027), só acrescentar uma linha aqui, nada mais no código
# precisa mexer. Uma nota emitida em 2026 sempre usa a de 2026, mesmo que o
# cálculo rode em 2027 — é a alíquota vigente na emissão que vale.
ALIQUOTA_IMPOSTO_POR_ANO: dict[int, Decimal] = {
    2026: Decimal("0.06"),
}


def aliquota_imposto(ano: int | None = None) -> Decimal:
    """Alíquota vigente no ano dado (hoje, se omitido). Ano sem alíquota
    cadastrada usa a mais recente já definida — nunca quebra por falta de
    linha nova em janeiro."""
    ano = ano or date.today().year
    anos_cadastrados = [a for a in ALIQUOTA_IMPOSTO_POR_ANO if a <= ano]
    ano_de_referencia = max(anos_cadastrados) if anos_cadastrados else min(ALIQUOTA_IMPOSTO_POR_ANO)
    return ALIQUOTA_IMPOSTO_POR_ANO[ano_de_referencia]


def calcular_imposto(valor: Decimal, ano: int | None = None) -> Decimal:
    return (valor * aliquota_imposto(ano)).quantize(Decimal("0.01"))


def data_limite(data_recebimento: date, prazo_dias: int) -> date:
    return data_recebimento + timedelta(days=prazo_dias)


def calcular_status(etapa: str, limite: date | None, hoje: date | None = None) -> Status:
    """Precedência: etapa terminal vence prazo. Igual ao protótipo."""
    hoje = hoje or date.today()
    if etapa == ETAPA_CONCLUIDO:
        return Status.CONCLUIDO
    if etapa == ETAPA_EXIGENCIA:
        return Status.EXIGENCIA
    if etapa.startswith(ETAPA_PARADO_PREFIXO):
        return Status.PARADO
    if limite is None:
        return Status.NO_PRAZO
    if hoje > limite:
        return Status.ATRASADO
    if (limite - hoje).days <= DIAS_ALERTA:
        return Status.PRAZO_PROXIMO
    return Status.NO_PRAZO


def despesa_sugerida(tipo: TipoServico) -> Decimal:
    return DESPESA_COM_VISTORIA if tipo == TipoServico.VOLANTE else DESPESA_SEM_VISTORIA


def encaixe_permitido(data_vistoria: date, hoje: date | None = None) -> bool:
    """Encaixe vale até 2 dias antes da vistoria (inclusive esse dia)."""
    hoje = hoje or date.today()
    return (data_vistoria - hoje).days >= DIAS_ENCAIXE


def totais_nota(itens: list[dict], ano_emissao: int | None = None) -> dict:
    """O valor da nota JÁ INCLUI a despesa: a diferença é o que fica para o escritório.
    O imposto incide sobre o valor da nota; o lucro líquido é a diferença já descontado ele.
    ano_emissao fixa a alíquota do ano da nota; sem emissão ainda, usa a de hoje."""
    despesas = sum((Decimal(str(i["despesa"])) for i in itens), Decimal("0"))
    valor = sum((Decimal(str(i["valor_nota"])) for i in itens), Decimal("0"))
    diferenca = valor - despesas
    imposto = calcular_imposto(valor, ano_emissao)
    return {
        "quantidade": len(itens),
        "despesas": despesas,
        "valor": valor,
        "diferenca": diferenca,
        "imposto": imposto,
        "lucro_liquido": diferenca - imposto,
    }
