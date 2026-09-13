import smtplib
from email.message import EmailMessage

from .config import config


def enviar_email(para: str, assunto: str, corpo: str) -> None:
    """Envio simples por SMTP. Sem SMTP configurado, só registra no log —
    assim o ambiente de desenvolvimento não dispara e-mail de verdade."""
    if not config.smtp_host:
        print(f"[email:simulado] para={para} assunto={assunto}\n{corpo}\n")
        return
    msg = EmailMessage()
    msg["From"] = config.remetente
    msg["To"] = para
    msg["Subject"] = assunto
    msg.set_content(corpo)
    with smtplib.SMTP(config.smtp_host, config.smtp_porta) as s:
        s.starttls()
        if config.smtp_usuario:
            s.login(config.smtp_usuario, config.smtp_senha)
        s.send_message(msg)
