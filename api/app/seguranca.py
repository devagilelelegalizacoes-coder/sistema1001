from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
import bcrypt
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .config import config
from .db import get_db
from .models import Usuario

oauth2 = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

# bcrypt direto, sem passlib: passlib está sem manutenção e quebra com bcrypt >= 4.1.
# O limite de 72 bytes é do próprio algoritmo — truncar aqui é o comportamento padrão.
def hash_senha(senha: str) -> str:
    return bcrypt.hashpw(senha.encode()[:72], bcrypt.gensalt()).decode()


def conferir_senha(senha: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(senha.encode()[:72], hashed.encode())
    except ValueError:
        return False


def criar_token(usuario: Usuario) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=config.jwt_expira_horas)
    payload = {
        "sub": str(usuario.id),
        "papel": usuario.papel,
        "empresa_id": usuario.empresa_id,
        "exp": exp,
    }
    return jwt.encode(payload, config.jwt_secret, algorithm="HS256")


def usuario_atual(token: str | None = Depends(oauth2), db: Session = Depends(get_db)) -> Usuario:
    erro = HTTPException(status.HTTP_401_UNAUTHORIZED, "Não autenticado")
    if not token:
        raise erro
    try:
        dados = jwt.decode(token, config.jwt_secret, algorithms=["HS256"])
    except JWTError:
        raise erro
    usuario = db.get(Usuario, int(dados["sub"]))
    if not usuario or not usuario.ativo:
        raise erro
    return usuario


def exige_papel(*papeis: str):
    """Uso: Depends(exige_papel("admin", "operador"))"""
    def _checar(usuario: Usuario = Depends(usuario_atual)) -> Usuario:
        if usuario.papel not in papeis:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Sem permissão para esta operação")
        return usuario
    return _checar
