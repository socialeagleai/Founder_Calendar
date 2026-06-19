"""Minimal SMTP email sending. When SMTP isn't configured the message is logged
instead of sent, so flows like password reset still work in development."""

import logging
import smtplib
from email.message import EmailMessage

from .config import settings

logger = logging.getLogger("uvicorn.error")


def send_email(to: str, subject: str, html: str, text: str | None = None) -> bool:
    """Send an HTML email. Returns True if actually sent, False if SMTP is not
    configured or sending failed (the caller should log a fallback link)."""
    if not settings.smtp_host:
        logger.warning("SMTP not configured — email to %s not sent (subject: %s)", to, subject)
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from or settings.smtp_user or "no-reply@founder-calendar"
    msg["To"] = to
    msg.set_content(text or "Please view this message in an HTML-capable client.")
    msg.add_alternative(html, subtype="html")

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
            if settings.smtp_tls:
                server.starttls()
            if settings.smtp_user:
                server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)
        return True
    except Exception as exc:  # noqa: BLE001 — never let email failure 500 a request
        logger.error("Failed to send email to %s: %s", to, exc)
        return False


def reset_password_email(name: str, link: str, expires_minutes: int) -> tuple[str, str]:
    """Returns (html, text) for a password-reset email."""
    text = (
        f"Hi {name},\n\n"
        f"We received a request to reset your Founder Calendar password.\n"
        f"Use this link (valid for {expires_minutes} minutes):\n{link}\n\n"
        f"If you didn't request this, you can safely ignore this email."
    )
    html = f"""\
<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
  <h2 style="color:#C4162A;margin:0 0 16px">Reset your password</h2>
  <p>Hi {name},</p>
  <p>We received a request to reset your Founder Calendar password.</p>
  <p style="margin:24px 0">
    <a href="{link}" style="background:#C4162A;color:#fff;text-decoration:none;
       padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">
      Reset password
    </a>
  </p>
  <p style="color:#666;font-size:13px">This link expires in {expires_minutes} minutes.
     If you didn't request a reset, you can safely ignore this email.</p>
  <p style="color:#999;font-size:12px;word-break:break-all">{link}</p>
</div>"""
    return html, text
