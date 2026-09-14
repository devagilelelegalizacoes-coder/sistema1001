"""Testes das regras de negócio. Rodam sem banco e sem rede.

Os números aqui vêm de casos reais do protótipo — se alguém mudar a regra
sem querer, estes testes quebram.
"""
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api"))

from app.regras import (  # noqa: E402
    PRAZO_PADRAO, Status, TipoServico, calcular_status, data_limite,
    calcular_imposto, despesa_sugerida, encaixe_permitido, totais_nota,
)

HOJE = date(2026, 9, 7)


def test_prazos_das_esteiras():
    assert PRAZO_PADRAO[TipoServico.VOLANTE] == 15
    assert PRAZO_PADRAO[TipoServico.ATPVE] == 1
    assert PRAZO_PADRAO[TipoServico.LICENCIAMENTO] == 2


def test_data_limite_do_lote_caju():
    # lote enviado em 03/09 com prazo de 15 dias
    assert data_limite(date(2026, 9, 3), 15) == date(2026, 9, 18)


def test_lote_caju_esta_no_prazo():
    assert calcular_status("Solicitação enviada", date(2026, 9, 18), HOJE) == Status.NO_PRAZO


def test_crlv_de_01_09_esta_atrasado():
    # licenciamento recebido 01/09, prazo 48h -> limite 03/09
    assert calcular_status("Recebido", date(2026, 9, 3), HOJE) == Status.ATRASADO


def test_exigencia_vence_o_prazo():
    # mesmo dentro do prazo, exigência aberta manda no status
    assert calcular_status("Exigência aberta", date(2026, 12, 31), HOJE) == Status.EXIGENCIA


def test_concluido_vence_ate_o_atraso():
    assert calcular_status("Concluído", date(2026, 1, 1), HOJE) == Status.CONCLUIDO


def test_faltou_vira_parado():
    assert calcular_status("Faltou / reagendar", date(2026, 12, 31), HOJE) == Status.PARADO


def test_amarelo_a_dois_dias():
    assert calcular_status("Recebido", date(2026, 9, 9), HOJE) == Status.PRAZO_PROXIMO
    assert calcular_status("Recebido", date(2026, 9, 10), HOJE) == Status.NO_PRAZO


def test_janela_de_encaixe():
    # vistoria em 10/09: encaixe vale até 08/09
    assert encaixe_permitido(date(2026, 9, 10), HOJE) is True
    assert encaixe_permitido(date(2026, 9, 8), date(2026, 9, 6)) is True
    assert encaixe_permitido(date(2026, 9, 8), date(2026, 9, 7)) is False


def test_despesa_sugerida():
    assert despesa_sugerida(TipoServico.VOLANTE) == Decimal("190.00")
    assert despesa_sugerida(TipoServico.ATPVE) == Decimal("50.00")


def test_valor_da_nota_ja_inclui_a_despesa():
    t = totais_nota([{"despesa": 190, "valor_nota": 250},
                     {"despesa": 190, "valor_nota": 250}])
    assert t["quantidade"] == 2
    assert t["despesas"] == Decimal("380")
    assert t["valor"] == Decimal("500")
    assert t["diferenca"] == Decimal("120")   # o que fica para o escritório


def test_nota_vazia_nao_quebra():
    t = totais_nota([])
    assert t["valor"] == Decimal("0") and t["diferenca"] == Decimal("0")


def test_imposto_e_6_por_cento_do_valor():
    assert calcular_imposto(Decimal("500")) == Decimal("30.00")


def test_lucro_liquido_desconta_o_imposto_da_diferenca():
    t = totais_nota([{"despesa": 190, "valor_nota": 250},
                     {"despesa": 190, "valor_nota": 250}])
    assert t["imposto"] == Decimal("30.00")          # 6% de 500
    assert t["lucro_liquido"] == Decimal("90.00")    # 120 (diferença) - 30 (imposto)
