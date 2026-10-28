"""E2E real HTTPS/SMTP con receptores aislados y motor local sin Groq."""
import asyncio
import datetime
import hashlib
import http.client
import http.server
import ipaddress
import json
import os
from pathlib import Path
import signal
import smtplib
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from email.message import EmailMessage
from aiosmtpd.controller import Controller
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from integrations.mail_filter import MailFilter
from integrations.client import DlpClient


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait(predicate, seconds=25):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        if predicate():
            return
        time.sleep(.1)
    raise AssertionError("Tiempo de espera agotado")


def make_cert(directory):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "DLP receptor ficticio")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(minutes=1)).not_valid_after(now + datetime.timedelta(days=2)).add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), critical=False).add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True).sign(key, hashes.SHA256())
    cert_path, key_path = directory / "receptor.pem", directory / "receptor.key"
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    return cert_path, key_path


def run():
    results, received_http, received_mail = [], [], []
    dav_files = {}
    proxy = None
    sink = mail_sink = mail_filter = None
    with tempfile.TemporaryDirectory(prefix="dlp-managed-network-") as temporary:
        directory = Path(temporary)
        try:
            class Handler(http.server.BaseHTTPRequestHandler):
                def do_PROPFIND(self):
                    self.rfile.read(int(self.headers.get("Content-Length", "0")))
                    if self.path not in ("/dav/", "/dav") and self.path not in dav_files:
                        self.send_response(404); self.send_header("Content-Length", "0"); self.end_headers(); return
                    resource = "<d:collection/>" if self.path in ("/dav/", "/dav") else ""
                    size = len(dav_files.get(self.path, b""))
                    data = f'<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>{self.path}</d:href><d:propstat><d:prop><d:resourcetype>{resource}</d:resourcetype><d:getcontentlength>{size}</d:getcontentlength><d:getlastmodified>Wed, 28 Oct 2026 00:00:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>'.encode()
                    self.send_response(207); self.send_header("Content-Type", "application/xml"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

                def do_MKCOL(self):
                    self.send_response(201); self.send_header("Content-Length", "0"); self.end_headers()

                def do_PUT(self):
                    data = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                    dav_files[self.path] = data
                    received_http.append({"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
                    self.send_response(201); self.send_header("Content-Length", "0"); self.end_headers()

                def do_POST(self):
                    content = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                    received_http.append({"sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)})
                    self.send_response(200)
                    self.send_header("Content-Length", "2")
                    self.end_headers()
                    self.wfile.write(b"OK")

                def log_message(self, *args):
                    pass

            sink = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            cert, key = make_cert(directory)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert, key)
            sink.socket = context.wrap_socket(sink.socket, server_side=True)
            threading.Thread(target=sink.serve_forever, daemon=True).start()
            proxy_port = free_port()
            log_path = directory / "proxy.log"
            with log_path.open("w", encoding="utf-8") as log:
                proxy = subprocess.Popen([sys.executable, "-c", "from mitmproxy.tools.main import mitmdump; mitmdump()", "--listen-host", "127.0.0.1", "--listen-port", str(proxy_port), "--set", f"confdir={directory / 'mitm'}", "--set", "connection_strategy=lazy", "--set", f"ssl_verify_upstream_trusted_ca={cert}", "--set", "body_size_limit=12m", "-s", str(ROOT / "integrations/proxy_addon.py"), "-q"], cwd=ROOT, env=os.environ.copy(), stdout=log, stderr=log, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

                def ready():
                    if proxy.poll() is not None:
                        raise RuntimeError("Proxy no inició: " + log_path.read_text(encoding="utf-8")[-1800:])
                    try:
                        with socket.create_connection(("127.0.0.1", proxy_port), timeout=.2):
                            return (directory / "mitm/mitmproxy-ca-cert.pem").exists()
                    except OSError:
                        return False

                wait(ready)
                client_context = ssl.create_default_context(cafile=str(directory / "mitm/mitmproxy-ca-cert.pem"))

                def upload(content, content_type="text/plain", headers=None):
                    conn = http.client.HTTPSConnection("127.0.0.1", proxy_port, context=client_context, timeout=55)
                    conn.set_tunnel("127.0.0.1", sink.server_port)
                    conn.request("POST", "/upload", content, {"Content-Type": content_type, **(headers or {})})
                    response = conn.getresponse()
                    status = response.status
                    response.read()
                    conn.close()
                    return status

                def check_web(label, data, allowed, content_type="text/plain", headers=None):
                    before = len(received_http)
                    status = upload(data, content_type, headers)
                    if allowed:
                        assert status == 200, (label, status)
                        assert len(received_http) == before + 1
                        assert received_http[-1]["sha256"] == hashlib.sha256(data).hexdigest()
                    else:
                        assert status in (403, 413, 503), (label, status)
                        assert len(received_http) == before, label
                    results.append({"case": label, "allowed": allowed, "status": status, "destinationVerified": True, "evidence": "REAL_HTTPS_MITMPROXY_AND_INDEPENDENT_RECEIVER"})

                check_web("CU-06 texto público", b"Horario de biblioteca", True)
                check_web("CU-06 DNI en cuerpo", b"DNI: 12345678", False)
                check_web("CU-12 base64", b"RE5JOiAxMjM0NTY3OApSZWdpc3RybyBwcml2YWRvIGZpY3RpY2lv", False)
                check_web("CU-12 fragmento Content-Range", b"DNI: ", False, headers={"Content-Range": "bytes 0-4/20"})
                fixture_dir = Path(os.environ["DLP_E2E_FIXTURES"])
                boundary = "DLP-test-boundary"
                for name, allowed in [("publico.xlsx", True), ("privado.xlsx", False), ("renombrado.jpg", False)]:
                    data = (fixture_dir / name).read_bytes()
                    multipart = f'--{boundary}\r\nContent-Disposition: form-data; name="archivo"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode() + data + f"\r\n--{boundary}--\r\n".encode()
                    check_web("CU-05 " + name, multipart, allowed, f"multipart/form-data; boundary={boundary}")
                # Archivo ZIP real no soportado. El motor no lo convierte en contenido público.
                import io, zipfile
                archive = io.BytesIO()
                with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as z:
                    z.writestr("ficticio.txt", "DNI: 12345678")
                check_web("CU-11 contenedor no inspeccionable", archive.getvalue(), False, "application/octet-stream", {"X-DLP-File-Name": "contenedor.zip"})

                class MailSink:
                    async def handle_DATA(self, server, session, envelope):
                        received_mail.append(hashlib.sha256(envelope.original_content).hexdigest())
                        return "250 2.0.0 Receptor ficticio"

                sink_port, filter_port = free_port(), free_port()
                mail_sink = Controller(MailSink(), hostname="127.0.0.1", port=sink_port, decode_data=False)
                mail_sink.start()
                os.environ["DLP_MAIL_RELAY_PORT"] = str(sink_port)
                os.environ["DLP_MAIL_RELAY_HOST"] = "127.0.0.1"
                mail_filter = Controller(MailFilter(), hostname="127.0.0.1", port=filter_port, decode_data=False)
                mail_filter.start()

                def check_mail(label, body, allowed, attachment=None, recipient="destino@dlp.test"):
                    msg = EmailMessage()
                    msg["From"] = "laboratorio@dlp.test"
                    msg["To"] = recipient
                    msg["Subject"] = "Prueba ficticia DLP"
                    msg.set_content(body, cte="base64")
                    if attachment:
                        msg.add_attachment((fixture_dir / attachment).read_bytes(), maintype="application", subtype="octet-stream", filename=attachment)
                    before = len(received_mail)
                    try:
                        with smtplib.SMTP("127.0.0.1", filter_port, timeout=55) as smtp:
                            smtp.send_message(msg)
                        accepted = True
                    except smtplib.SMTPDataError as error:
                        assert error.smtp_code == 550
                        accepted = False
                    assert accepted == allowed, label
                    assert len(received_mail) == before + int(allowed), label
                    results.append({"case": label, "allowed": allowed, "destinationVerified": True, "evidence": "REAL_SMTP_FILTER_AND_INDEPENDENT_SMTP_RECEIVER"})

                check_mail("CU-04 cuerpo público MIME base64", "Horario de atención público", True)
                check_mail("CU-04 cuerpo sensible MIME base64", "DNI: 12345678", False)
                check_mail("CU-03 adjunto público XLSX", "Documento de prueba", True, "publico.xlsx")
                check_mail("CU-03 adjunto sensible XLSX", "Documento de prueba", False, "privado.xlsx")
                check_mail("CU-03 destino no autorizado", "Horario público", False, recipient="destino@externo.test")
                # El fallo del motor se comprueba a través del SMTP real; no se envían bytes al receptor.
                original_client = mail_filter.handler.client
                mail_filter.handler.client = DlpClient(url=f"http://127.0.0.1:{free_port()}")
                msg = EmailMessage(); msg["From"] = "a@dlp.test"; msg["To"] = "b@dlp.test"; msg.set_content("Horario público")
                before = len(received_mail)
                with smtplib.SMTP("127.0.0.1", filter_port, timeout=55) as smtp:
                    try:
                        smtp.send_message(msg)
                        raise AssertionError("El fallo del motor no retuvo el mensaje")
                    except smtplib.SMTPDataError as error:
                        assert error.smtp_code == 451
                assert len(received_mail) == before
                mail_filter.handler.client = original_client
                results.append({"case": "SMTP motor desconectado", "allowed": False, "destinationVerified": True, "evidence": "REAL_SMTP_TEMPORARY_FAILURE"})

                rclone = Path(os.environ.get("DLP_RCLONE", "ruta-no-configurada"))
                if rclone.is_file():
                    for name, allowed in [("publico.txt", True), ("privado.txt", False)]:
                        args = [str(rclone), "copyto", str(fixture_dir / name), ":webdav:" + name, "--webdav-url", f"https://127.0.0.1:{sink.server_port}/dav/", "--webdav-vendor", "other", "--http-proxy", f"http://127.0.0.1:{proxy_port}", "--ca-cert", str(directory / "mitm/mitmproxy-ca-cert.pem"), "--retries", "1", "--low-level-retries", "1", "--timeout", "20s", "--contimeout", "5s", "--log-level", "ERROR"]
                        result = subprocess.run(args, cwd=ROOT, env={**os.environ, "NO_PROXY": "", "no_proxy": ""}, capture_output=True, text=True, timeout=45, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                        if allowed:
                            assert result.returncode == 0, result.stderr[-2000:]
                            assert dav_files.get("/dav/" + name) == (fixture_dir / name).read_bytes(), "rclone no entregó el archivo por el proxy"
                        else:
                            assert result.returncode != 0, "rclone no informó rechazo"
                            assert "/dav/" + name not in dav_files
                            assert "403" in result.stderr, result.stderr[-2000:]
                        results.append({"case": "CU-07 rclone WebDAV " + name, "allowed": allowed, "destinationVerified": True, "evidence": "REAL_RCLONE_WEBDAV_HTTPS_PROXY_AND_RECEIVER"})

            return {"generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "tests": len(results), "groqLiveTested": False, "classification": "RULES_ONLY_FOR_NETWORK_VERIFICATION", "tlsInspection": True, "postfixTested": False, "rcloneTested": any("rclone WebDAV" in item["case"] for item in results), "results": results}
        finally:
            if mail_filter:
                mail_filter.stop()
            if mail_sink:
                mail_sink.stop()
            if proxy and proxy.poll() is None:
                proxy.terminate()
                try:
                    proxy.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proxy.kill(); proxy.wait(timeout=5)
            if sink:
                sink.shutdown(); sink.server_close()


if __name__ == "__main__":
    result = run()
    output = Path(os.environ["DLP_E2E_OUTPUT"])
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"tests": result["tests"], "tlsInspection": True, "groqLiveTested": False}))
