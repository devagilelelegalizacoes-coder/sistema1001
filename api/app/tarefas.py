"""Fila de tarefas pesadas. Hoje só o esqueleto da extração de lote —
a esteira de OCR entra aqui na fase 3.
"""
from celery import Celery

from .config import config

app = Celery("sistema1001", broker=config.redis_url, backend=config.redis_url)
app.conf.update(task_track_started=True, timezone="America/Sao_Paulo")


@app.task(name="extrair_lote")
def extrair_lote(lote_id: int, caminhos_pdf: list[str]) -> dict:
    """Lê os PDFs do lote e devolve a tabela de conferência.

    Receita validada no protótipo (ver a especificação):
      1. renderizar a 200 DPI em tons de cinza
      2. classificar a página: CRV | ATPV | CRLV-e | DUDA
      3. no CRLV-e, recortar o canto superior esquerdo (x 3-50%, y 5-30%),
         ampliar 2-3x e rodar OCR com --psm 4
      4. casar por RENAVAM contra a lista do formulário de agendamento
      5. o que não casar vai para revisão visual
      6. NUNCA inventar dado: campo ilegível vira "NÃO LOCALIZADO"

    Cuidado documentado: o CRV vem digitalizado girado 90° e não lê por OCR;
    o número do BIN no campo OBSERVAÇÕES e a PLACA ANTERIOR do CRLV-e são
    lidos como se fossem outras placas.
    """
    raise NotImplementedError("Fase 3 — ver seção 7 da especificação")
