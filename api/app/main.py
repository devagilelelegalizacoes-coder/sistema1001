from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import auth, avisos, notas, processos, relatorios

app = FastAPI(
    title="Sistema 1001",
    description="Controle de processos da AUTO VIAÇÃO 1001 — Agile Legalizações",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # em produção: só o domínio do front
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(processos.router)
app.include_router(notas.router)
app.include_router(avisos.router)
app.include_router(relatorios.router)


@app.get("/saude", tags=["infra"])
def saude():
    return {"ok": True}
