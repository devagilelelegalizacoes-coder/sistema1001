"""Carga inicial: leva os processos do protótipo (Portal 1001) para o banco novo.

Uso:
    python -m app.seed.importar_portal /caminho/export

Espera a estrutura do export do portal:
    export/tickets/*.json   e   export/avisos/*.json
"""
import json
import sys
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import select

from ..db import Sessao, engine
from ..models import Anexo, Aviso, Base, Empresa, Lote, Processo, Usuario, Veiculo
from ..regras import PRAZO_PADRAO, TipoServico
from ..seguranca import hash_senha

# o protótipo usava estes rótulos; aqui viram os do sistema novo
TIPOS = {"VOLANTE": "volante", "ATPVE": "atpve",
         "LICENCIAMENTO": "licenciamento", "AVULSO": "avulso"}
ETAPAS = {
    "EXIGÊNCIA ABERTA": "Exigência aberta",
    "FALTOU / REAGENDAR": "Faltou / reagendar",
    "FALTOU / PARADO": "Faltou / parado",
    "CONCLUÍDO": "Concluído",
}


def normalizar_etapa(etapa: str) -> str:
    if etapa in ETAPAS:
        return ETAPAS[etapa]
    # "5. Solicitação enviada (e-mail)" -> "Solicitação enviada"
    limpo = etapa.split(". ", 1)[-1].split(" (")[0].strip()
    return limpo or "Recebido"


def d(valor: str | None) -> date | None:
    if not valor:
        return None
    try:
        return date.fromisoformat(valor[:10])
    except ValueError:
        return None


def rodar(pasta: Path) -> dict:
    Base.metadata.create_all(engine)
    db = Sessao()
    contagem = {"empresas": 0, "usuarios": 0, "veiculos": 0, "lotes": 0,
                "processos": 0, "anexos": 0, "avisos": 0}

    empresas = {
        "30.069.314/0001-01": ("AUTO VIAÇÃO 1001 LTDA", False),
        "11.867.575/0001-22": ("JCA LOCADORA DE VEICULOS LTDA", True),
        "09.338.337/0004-20": ("METAR VEICULOS LTDA", True),
    }
    for cnpj, (nome, vendedora) in empresas.items():
        if not db.scalar(select(Empresa).where(Empresa.cnpj == cnpj)):
            db.add(Empresa(razao_social=nome, cnpj=cnpj, e_vendedora=vendedora,
                           endereco="ROD AMARAL PEIXOTO, 2401, BALDEADOR" if not vendedora else None,
                           cep="24140-005" if not vendedora else None,
                           municipio="NITERÓI" if not vendedora else None,
                           uf="RJ" if not vendedora else None))
            contagem["empresas"] += 1
    db.flush()
    mil = db.scalar(select(Empresa).where(Empresa.cnpj == "30.069.314/0001-01"))

    equipe = [
        ("Leonardo da Costa Pereira", "adm.agilelegalizacoes@gmail.com", "admin", "1997"),
        ("Eduardo Lopes da Silva", "eduardo@agilelegalizacoes.com.br", "despachante", "2461"),
        ("Contato Agile", "contato.agilelegalizacoes@gmail.com", "operador", None),
    ]
    for nome, email, papel, matricula in equipe:
        if not db.scalar(select(Usuario).where(Usuario.email == email)):
            db.add(Usuario(nome=nome, email=email, papel=papel, matricula=matricula,
                           senha_hash=hash_senha("trocar123")))
            contagem["usuarios"] += 1
    db.flush()

    for arq in sorted((pasta / "tickets").glob("*.json")):
        t = json.loads(arq.read_text(encoding="utf-8"))
        placa = (t.get("placa") or "").strip().upper() or None
        ordem = (t.get("numeroOrdem") or "").strip() or None

        # sem placa (os CRLV de 01/09 são assim), identifica pelo nº de ordem.
        # Nunca inventar placa: é dado de processo no DETRAN.
        veiculo = None
        if placa:
            veiculo = db.scalar(select(Veiculo).where(Veiculo.placa == placa))
        elif ordem:
            veiculo = db.scalar(select(Veiculo).where(Veiculo.placa.is_(None),
                                                      Veiculo.numero_ordem == ordem))
        if not veiculo:
            veiculo = Veiculo(placa=placa, renavam=t.get("renavam") or None,
                              numero_ordem=ordem)
            db.add(veiculo)
            db.flush()
            contagem["veiculos"] += 1

        lote = None
        if t.get("lote"):
            lote = db.scalar(select(Lote).where(Lote.nome == t["lote"]))
            if not lote:
                lote = Lote(nome=t["lote"], tipo_servico=TIPOS.get(t.get("tipo"), "volante"),
                            data_vistoria=date(2026, 9, 10) if "CAJU 10-09" in t["lote"] else None,
                            local="Caju" if "CAJU" in t["lote"] else None)
                db.add(lote)
                db.flush()
                contagem["lotes"] += 1

        tipo = TIPOS.get(t.get("tipo"), "avulso")
        p = Processo(
            veiculo_id=veiculo.id, empresa_id=mil.id, lote_id=lote.id if lote else None,
            tipo_servico=tipo, tipo_avulso=t.get("tipoAvulso") or None,
            data_recebimento=d(t.get("dataRecebimento")) or date.today(),
            prazo_dias=int(t.get("prazoDias") or PRAZO_PADRAO[TipoServico(tipo)]),
            etapa=normalizar_etapa(t.get("etapa") or "Recebido"),
            exigencia=t.get("exigencia") or None,
            data_reagendamento=d(t.get("dataReagendamento")),
            observacoes=t.get("observacoes") or None,
            origem="lote" if lote else "email",
        )
        db.add(p)
        db.flush()
        contagem["processos"] += 1

        for a in t.get("anexos") or []:
            db.add(Anexo(processo_id=p.id, nome=a.get("nome", "documento"),
                         url=a.get("url", ""), tipo_doc="email"))
            contagem["anexos"] += 1

    for arq in sorted((pasta / "avisos").glob("*.json")):
        a = json.loads(arq.read_text(encoding="utf-8"))
        db.add(Aviso(mensagem=a.get("mensagem", ""), tipo=a.get("tipo", "geral"),
                     lido=bool(a.get("lida")), criado_por=a.get("criadoPor")))
        contagem["avisos"] += 1

    db.commit()
    db.close()
    return contagem


if __name__ == "__main__":
    pasta = Path(sys.argv[1] if len(sys.argv) > 1 else "export")
    resultado = rodar(pasta)
    print("importado:", ", ".join(f"{v} {k}" for k, v in resultado.items() if v))
