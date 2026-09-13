from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import config

engine = create_engine(config.database_url, pool_pre_ping=True, future=True)
Sessao = sessionmaker(bind=engine, autoflush=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db():
    db = Sessao()
    try:
        yield db
    finally:
        db.close()
