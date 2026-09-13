from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean, Computed, Date, DateTime, ForeignKey, Index, Integer, Numeric,
    String, Text, UniqueConstraint, func, text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Usuario(Base):
    __tablename__ = "usuario"
    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(160), unique=True)
    senha_hash: Mapped[str] = mapped_column(String(200))
    # admin | operador | despachante | cliente
    papel: Mapped[str] = mapped_column(String(20), default="operador")
    # preenchido só para papel=cliente: limita o que a pessoa enxerga
    empresa_id: Mapped[int | None] = mapped_column(ForeignKey("empresa.id"))
    matricula: Mapped[str | None] = mapped_column(String(20))
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)


class Empresa(Base):
    __tablename__ = "empresa"
    id: Mapped[int] = mapped_column(primary_key=True)
    razao_social: Mapped[str] = mapped_column(String(160))
    cnpj: Mapped[str] = mapped_column(String(20), unique=True)
    endereco: Mapped[str | None] = mapped_column(String(200))
    cep: Mapped[str | None] = mapped_column(String(12))
    municipio: Mapped[str | None] = mapped_column(String(80))
    uf: Mapped[str | None] = mapped_column(String(2))
    # true para as locadoras que aparecem como vendedoras (JCA, Metar)
    e_vendedora: Mapped[bool] = mapped_column(Boolean, default=False)


class Veiculo(Base):
    __tablename__ = "veiculo"
    # placa pode faltar: acontece de verdade quando o pedido chega só com o nº de
    # ordem e a placa está dentro do PDF anexo. Índice único parcial: só vale
    # quando a placa existe, e nunca deixa duas iguais entrarem.
    __table_args__ = (
        Index("uq_veiculo_placa", "placa", unique=True,
              postgresql_where=text("placa IS NOT NULL")),
        Index("ix_veiculo_ordem", "numero_ordem"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    placa: Mapped[str | None] = mapped_column(String(10))
    renavam: Mapped[str | None] = mapped_column(String(15), index=True)
    chassi: Mapped[str | None] = mapped_column(String(25))
    numero_ordem: Mapped[str | None] = mapped_column(String(10))
    marca_modelo: Mapped[str | None] = mapped_column(String(80))
    ano_fab: Mapped[int | None]
    ano_modelo: Mapped[int | None]
    cor: Mapped[str | None] = mapped_column(String(30))
    especie: Mapped[str] = mapped_column(String(30), default="PASSAGEIRO")
    categoria: Mapped[str] = mapped_column(String(30), default="ALUGUEL")
    tipo: Mapped[str] = mapped_column(String(30), default="ÔNIBUS")
    combustivel: Mapped[str] = mapped_column(String(20), default="DIESEL")


class Lote(Base):
    __tablename__ = "lote"
    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(80), unique=True)
    tipo_servico: Mapped[str] = mapped_column(String(20))
    data_vistoria: Mapped[date | None] = mapped_column(Date)
    local: Mapped[str | None] = mapped_column(String(80))
    despachante_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    formulario: Mapped[str | None] = mapped_column(String(60))
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    processos: Mapped[list["Processo"]] = relationship(back_populates="lote")


class Processo(Base):
    __tablename__ = "processo"
    id: Mapped[int] = mapped_column(primary_key=True)
    veiculo_id: Mapped[int] = mapped_column(ForeignKey("veiculo.id"))
    empresa_id: Mapped[int] = mapped_column(ForeignKey("empresa.id"))
    lote_id: Mapped[int | None] = mapped_column(ForeignKey("lote.id"))
    vendedor_id: Mapped[int | None] = mapped_column(ForeignKey("empresa.id"))

    tipo_servico: Mapped[str] = mapped_column(String(20), index=True)
    tipo_avulso: Mapped[str | None] = mapped_column(String(80))

    data_recebimento: Mapped[date] = mapped_column(Date)
    prazo_dias: Mapped[int] = mapped_column(Integer)
    # coluna gerada pelo banco: nunca digitada, nunca diverge
    data_limite: Mapped[date] = mapped_column(
        Date, Computed("data_recebimento + prazo_dias", persisted=True)
    )

    etapa: Mapped[str] = mapped_column(String(60), index=True)
    exigencia: Mapped[str | None] = mapped_column(Text)
    data_reagendamento: Mapped[date | None] = mapped_column(Date)
    responsavel_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    observacoes: Mapped[str | None] = mapped_column(Text)

    # dados do processo de transferência
    duda_tp: Mapped[str | None] = mapped_column(String(20))
    data_venda: Mapped[date | None] = mapped_column(Date)
    numero_crv: Mapped[str | None] = mapped_column(String(20))

    origem: Mapped[str] = mapped_column(String(20), default="manual")  # email | manual | lote
    email_msg_id: Mapped[str | None] = mapped_column(String(80))

    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    atualizado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    veiculo: Mapped[Veiculo] = relationship()
    lote: Mapped[Lote | None] = relationship(back_populates="processos")
    anexos: Mapped[list["Anexo"]] = relationship(back_populates="processo", cascade="all, delete-orphan")


class Anexo(Base):
    __tablename__ = "anexo"
    id: Mapped[int] = mapped_column(primary_key=True)
    processo_id: Mapped[int] = mapped_column(ForeignKey("processo.id", ondelete="CASCADE"))
    nome: Mapped[str] = mapped_column(String(120))
    url: Mapped[str] = mapped_column(Text)
    tipo_doc: Mapped[str | None] = mapped_column(String(20))   # crv | atpv | crlv | duda | email
    pagina_origem: Mapped[str | None] = mapped_column(String(20))
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    processo: Mapped[Processo] = relationship(back_populates="anexos")


class Nota(Base):
    __tablename__ = "nota"
    id: Mapped[int] = mapped_column(primary_key=True)
    referencia: Mapped[str] = mapped_column(String(120))
    numero_nf: Mapped[str | None] = mapped_column(String(30))
    data_emissao: Mapped[date | None] = mapped_column(Date, index=True)
    data_envio: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    data_pagamento: Mapped[date | None] = mapped_column(Date)
    # rascunho | emitida | enviada | paga
    status: Mapped[str] = mapped_column(String(20), default="rascunho")
    destinatario: Mapped[str | None] = mapped_column(String(160))
    observacoes: Mapped[str | None] = mapped_column(Text)
    criado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    itens: Mapped[list["NotaItem"]] = relationship(back_populates="nota", cascade="all, delete-orphan")


class NotaItem(Base):
    __tablename__ = "nota_item"
    # a trava que impede faturar o mesmo veículo duas vezes é do banco, não da tela
    __table_args__ = (UniqueConstraint("processo_id", name="uq_nota_item_processo"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    nota_id: Mapped[int] = mapped_column(ForeignKey("nota.id", ondelete="CASCADE"))
    processo_id: Mapped[int] = mapped_column(ForeignKey("processo.id"))
    despesa: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    valor_nota: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    nota: Mapped[Nota] = relationship(back_populates="itens")
    processo: Mapped[Processo] = relationship()


class Aviso(Base):
    __tablename__ = "aviso"
    id: Mapped[int] = mapped_column(primary_key=True)
    mensagem: Mapped[str] = mapped_column(Text)
    tipo: Mapped[str] = mapped_column(String(20), default="geral")  # geral | avulso | exigencia
    processo_id: Mapped[int | None] = mapped_column(ForeignKey("processo.id"))
    lido: Mapped[bool] = mapped_column(Boolean, default=False)
    criado_por: Mapped[str | None] = mapped_column(String(120))
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Auditoria(Base):
    __tablename__ = "auditoria"
    id: Mapped[int] = mapped_column(primary_key=True)
    usuario_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    entidade: Mapped[str] = mapped_column(String(40))
    entidade_id: Mapped[int]
    acao: Mapped[str] = mapped_column(String(20))
    antes: Mapped[dict | None] = mapped_column(JSONB)
    depois: Mapped[dict | None] = mapped_column(JSONB)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
