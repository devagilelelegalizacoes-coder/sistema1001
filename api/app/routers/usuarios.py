from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Usuario
from ..schemas import UsuarioAtualizar, UsuarioCriar, UsuarioOut
from ..seguranca import exige_papel, hash_senha, usuario_atual

PAPEIS_VALIDOS = {"admin", "operador", "despachante", "cliente"}

# cadastro de usuário e troca de papel é coisa de admin — o próprio usuário
# só enxerga a si mesmo em /auth/eu
router = APIRouter(prefix="/usuarios", tags=["usuarios"],
                   dependencies=[Depends(exige_papel("admin"))])


@router.get("", response_model=list[UsuarioOut])
def listar(db: Session = Depends(get_db)):
    return db.scalars(select(Usuario).order_by(Usuario.nome)).all()


@router.post("", response_model=UsuarioOut, status_code=201)
def criar(dados: UsuarioCriar, db: Session = Depends(get_db)):
    if dados.papel not in PAPEIS_VALIDOS:
        raise HTTPException(400, f"Papel inválido. Use um de: {', '.join(sorted(PAPEIS_VALIDOS))}")
    if db.scalar(select(Usuario).where(Usuario.email == dados.email)):
        raise HTTPException(409, "Já existe um usuário com este e-mail")
    usuario = Usuario(
        nome=dados.nome, email=dados.email, senha_hash=hash_senha(dados.senha),
        papel=dados.papel, empresa_id=dados.empresa_id, matricula=dados.matricula,
    )
    db.add(usuario)
    db.commit()
    db.refresh(usuario)
    return usuario


@router.patch("/{usuario_id}", response_model=UsuarioOut)
def atualizar(usuario_id: int, dados: UsuarioAtualizar, db: Session = Depends(get_db),
              usuario_logado: Usuario = Depends(usuario_atual)):
    usuario = db.get(Usuario, usuario_id)
    if not usuario:
        raise HTTPException(404, "Usuário não encontrado")
    campos = dados.model_dump(exclude_unset=True, exclude={"senha"})
    if "papel" in campos and campos["papel"] not in PAPEIS_VALIDOS:
        raise HTTPException(400, f"Papel inválido. Use um de: {', '.join(sorted(PAPEIS_VALIDOS))}")
    if usuario.id == usuario_logado.id and campos.get("ativo") is False:
        raise HTTPException(400, "Você não pode desativar a própria conta")
    for campo, valor in campos.items():
        setattr(usuario, campo, valor)
    if dados.senha:
        usuario.senha_hash = hash_senha(dados.senha)
    db.commit()
    db.refresh(usuario)
    return usuario
