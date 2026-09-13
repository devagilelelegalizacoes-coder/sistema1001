from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Aviso, Usuario
from ..schemas import AvisoCriar, AvisoOut
from ..seguranca import usuario_atual

router = APIRouter(prefix="/avisos", tags=["avisos"])


@router.get("", response_model=list[AvisoOut])
def listar(apenas_nao_lidos: bool = False, db: Session = Depends(get_db),
           _: Usuario = Depends(usuario_atual)):
    q = select(Aviso).order_by(Aviso.criado_em.desc()).limit(100)
    if apenas_nao_lidos:
        q = q.where(Aviso.lido.is_(False))
    return db.scalars(q).all()


@router.post("", response_model=AvisoOut, status_code=201)
def criar(dados: AvisoCriar, db: Session = Depends(get_db),
          usuario: Usuario = Depends(usuario_atual)):
    aviso = Aviso(mensagem=dados.mensagem, tipo=dados.tipo,
                  processo_id=dados.processo_id, criado_por=usuario.nome)
    db.add(aviso)
    db.commit()
    db.refresh(aviso)
    return aviso


@router.post("/{aviso_id}/lido", response_model=AvisoOut)
def marcar_lido(aviso_id: int, db: Session = Depends(get_db),
                _: Usuario = Depends(usuario_atual)):
    aviso = db.get(Aviso, aviso_id)
    if not aviso:
        raise HTTPException(404, "Aviso não encontrado")
    aviso.lido = True
    db.commit()
    db.refresh(aviso)
    return aviso
