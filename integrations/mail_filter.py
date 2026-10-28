"""Servidor SMTP de inspección previa. No es un relay público de correo."""
import asyncio
import os
import signal
import smtplib
import ssl
from aiosmtpd.controller import Controller
from integrations.client import DlpClient
from integrations.content import parse_mail, MAX_BYTES
from integrations.audit import record


class MailFilter:
    def __init__(self, client=None, relay=None):
        self.client = client or DlpClient()
        self.relay = relay or self.forward

    def forward(self, sender, recipients, data):
        host = os.environ.get("DLP_MAIL_RELAY_HOST", "127.0.0.1")
        port = int(os.environ.get("DLP_MAIL_RELAY_PORT", "2526"))
        with smtplib.SMTP(host, port, timeout=20) as smtp:
            if os.environ.get("DLP_MAIL_RELAY_STARTTLS") == "1":
                smtp.starttls(context=ssl.create_default_context())
            username = os.environ.get("DLP_MAIL_RELAY_USER")
            if username:
                if os.environ.get("DLP_MAIL_RELAY_STARTTLS") != "1":
                    raise RuntimeError("Autenticación SMTP requiere STARTTLS")
                smtp.login(username, os.environ.get("DLP_MAIL_RELAY_PASSWORD", ""))
            refused = smtp.sendmail(sender, recipients, data)
            if refused:
                raise RuntimeError("Receptor no aceptó todos los destinatarios")

    async def handle_DATA(self, server, session, envelope):
        try:
            parts = parse_mail(envelope.original_content)
            result = await self.client.inspect("mail", "smtp://relay", parts, recipients=envelope.rcpt_tos, device=str(session.peer[0]))
        except ValueError:
            try:
                result = await self.client.inspect("mail", "smtp://relay", [], recipients=envelope.rcpt_tos, device=str(session.peer[0]), unsupported=True)
            except RuntimeError:
                record("mail", "RESULTADO_CONECTOR_LOCAL", "TEMPFAIL_CLASSIFIER", True)
                return "451 4.3.0 Clasificador no disponible; mensaje retenido para reintento"
        except RuntimeError:
            record("mail", "RESULTADO_CONECTOR_LOCAL", "TEMPFAIL_CLASSIFIER", True)
            return "451 4.3.0 Clasificador no disponible; mensaje retenido para reintento"
        if not result["allowed"]:
            record("mail", "RESULTADO_CONECTOR_LOCAL", "CANCELLED", True)
            try:
                await self.client.receipt(result, "CANCELLED")
            except RuntimeError:
                pass
            return "550 5.7.1 DLP: mensaje bloqueado por contenido, destino o falta de inspeccion"
        try:
            await asyncio.to_thread(self.relay, envelope.mail_from, envelope.rcpt_tos, envelope.original_content)
        except Exception:
            try:
                await self.client.receipt(result, "FAILED")
            except RuntimeError:
                pass
            return "451 4.3.0 Receptor no disponible; reintentar"
        # Un fallo de registro tras aceptación del destino no puede deshacer el envío.
        try:
            await self.client.receipt(result, "UPSTREAM_RESPONSE", 250)
        except RuntimeError:
            print("DLP: destino aceptó el mensaje; recibo central pendiente", flush=True)
        return "250 2.0.0 Mensaje inspeccionado y aceptado por el receptor"


def main():
    controller = Controller(MailFilter(), hostname=os.environ.get("DLP_MAIL_BIND", "127.0.0.1"), port=int(os.environ.get("DLP_MAIL_PORT", "2525")), data_size_limit=MAX_BYTES, decode_data=False, enable_SMTPUTF8=True)
    controller.start()
    print("Filtro SMTP DLP iniciado. Solo clientes de laboratorio autorizados.", flush=True)
    import threading
    done = threading.Event()
    for name in ("SIGTERM", "SIGINT"):
        signal.signal(getattr(signal, name), lambda *_: done.set())
    try:
        done.wait()
    finally:
        controller.stop()


if __name__ == "__main__":
    main()
