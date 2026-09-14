from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, EmailStr


class VeiculoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    placa: str
    renavam: str | None = None
    numero_ordem: str | None = None
    marca_modelo: str | None = None


class ProcessoBase(BaseModel):
    tipo_servico: str
    tipo_avulso: str | None = None
    data_recebimento: date
    prazo_dias: int | None = None      # se vier vazio, usa o padrão do tipo
    etapa: str | None = None           # se vier vazio, começa em "Recebido"
    exigencia: str | None = None
    data_reagendamento: date | None = None
    observacoes: str | None = None
    duda_tp: str | None = None
    data_venda: date | None = None
    numero_crv: str | None = None


class ProcessoCriar(ProcessoBase):
    placa: str
    renavam: str | None = None
    numero_ordem: str | None = None
    empresa_cnpj: str | None = None
    lote_nome: str | None = None


class ProcessoAtualizar(BaseModel):
    etapa: str | None = None
    exigencia: str | None = None
    data_reagendamento: date | None = None
    responsavel_id: int | None = None
    observacoes: str | None = None
    prazo_dias: int | None = None


class ProcessoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    tipo_servico: str
    tipo_avulso: str | None = None
    lote: str | None = None
    placa: str | None = None
    renavam: str | None = None
    numero_ordem: str | None = None
    empresa: str
    data_recebimento: date
    prazo_dias: int
    data_limite: date
    etapa: str
    status: str                 # calculado, não armazenado
    dias_restantes: int
    exigencia: str | None = None
    observacoes: str | None = None
    qtd_anexos: int = 0


class NotaItemIn(BaseModel):
    processo_id: int
    despesa: Decimal
    valor_nota: Decimal


class NotaCriar(BaseModel):
    referencia: str
    destinatario: str | None = None
    itens: list[NotaItemIn]


class NotaAtualizar(BaseModel):
    referencia: str | None = None
    numero_nf: str | None = None
    data_emissao: date | None = None
    data_pagamento: date | None = None
    status: str | None = None
    destinatario: str | None = None
    observacoes: str | None = None
    itens: list[NotaItemIn] | None = None


class NotaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    referencia: str
    numero_nf: str | None = None
    data_emissao: date | None = None
    data_envio: datetime | None = None
    data_pagamento: date | None = None
    status: str
    destinatario: str | None = None
    quantidade: int
    despesas: Decimal
    valor: Decimal
    diferenca: Decimal


class AvisoCriar(BaseModel):
    mensagem: str
    tipo: str = "geral"
    processo_id: int | None = None


class AvisoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    mensagem: str
    tipo: str
    lido: bool
    criado_por: str | None = None
    criado_em: datetime


class UsuarioCriar(BaseModel):
    nome: str
    email: EmailStr
    senha: str
    papel: str = "operador"   # admin | operador | despachante | cliente
    empresa_id: int | None = None   # só faz sentido para papel=cliente
    matricula: str | None = None


class UsuarioAtualizar(BaseModel):
    nome: str | None = None
    papel: str | None = None
    empresa_id: int | None = None
    matricula: str | None = None
    ativo: bool | None = None
    senha: str | None = None   # se vier, troca a senha


class UsuarioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    nome: str
    email: str
    papel: str
    empresa_id: int | None = None
    matricula: str | None = None
    ativo: bool


class Login(BaseModel):
    email: EmailStr
    senha: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    nome: str
    papel: str


class LinhaMensal(BaseModel):
    mes: str
    notas: int
    despesas: Decimal
    valor: Decimal
    diferenca: Decimal
    recebido: Decimal
