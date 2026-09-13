from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Usuario
from ..schemas import Login, Token
from ..seguranca import conferir_senha, criar_token, usuario_atual

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=Token)
def login(dados: Login, db: Session = Depends(get_db)):
    usuario = db.scalar(select(Usuario).where(Usuario.email == dados.email))
    if not usuario or not usuario.ativo or not conferir_senha(dados.senha, usuario.senha_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "E-mail ou senha incorretos")
    return Token(access_token=criar_token(usuario), nome=usuario.nome, papel=usuario.papel)


@router.get("/eu")
def eu(usuario: Usuario = Depends(usuario_atual)):
    return {"id": usuario.id, "nome": usuario.nome, "papel": usuario.papel,
            "empresa_id": usuario.empresa_id}
