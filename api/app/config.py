from pydantic_settings import BaseSettings


class Config(BaseSettings):
    database_url: str = "postgresql+psycopg://postgres:postgres@db:5432/sistema1001"
    redis_url: str = "redis://redis:6379/0"
    jwt_secret: str = "troque-isto-em-producao"
    jwt_expira_horas: int = 12
    # e-mail de saída (resumo de nota, comunicação de exigência)
    smtp_host: str = ""
    smtp_porta: int = 587
    smtp_usuario: str = ""
    smtp_senha: str = ""
    remetente: str = "contato.agilelegalizacoes@gmail.com"

    class Config:
        env_file = ".env"


config = Config()
