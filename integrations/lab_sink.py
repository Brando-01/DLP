"""Destino independiente HTTPS/WebDAV y SMTP; acepta datos ficticios sin clasificarlos."""
import datetime
import email.utils
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import signal
import ssl
import threading
import time
import urllib.parse
import uuid
from xml.sax.saxutils import escape
from aiosmtpd.controller import Controller


def serve():
    directory = Path(os.environ.get("DLP_SINK_DIR", "laboratorio/recepciones")).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    webroot = directory / "webdav"; webroot.mkdir(exist_ok=True)
    lock = threading.Lock()

    def receipt(channel, file, data):
        record = {"timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(), "channel": channel, "file": file, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        with lock:
            with (directory / "recepciones.jsonl").open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(record) + "\n")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, status, data=b"", content_type="text/plain"):
            self.send_response(status); self.send_header("Content-Length", str(len(data))); self.send_header("Content-Type", content_type); self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)

        def target(self):
            name = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path).removeprefix("/dav").lstrip("/")
            target = (webroot / name).resolve()
            if not target.is_relative_to(webroot):
                raise ValueError("Ruta fuera del receptor")
            return target

        def body(self):
            value = self.headers.get("Content-Length", "0")
            if not value.isdigit() or int(value) > 12 * 1024 * 1024:
                raise ValueError("Carga demasiado grande")
            return self.rfile.read(int(value))

        def do_POST(self):
            try:
                data = self.body(); name = str(uuid.uuid4()) + ".bin"; (directory / name).write_bytes(data); receipt("http", name, data); self.reply(200, b"Recibido")
            except ValueError:
                self.reply(400)

        def do_PUT(self):
            try:
                target = self.target(); data = self.body()
                if not target.parent.is_dir():
                    return self.reply(409)
                target.write_bytes(data); receipt("webdav", str(target.relative_to(webroot)), data); self.reply(201)
            except (ValueError, OSError):
                self.reply(400)

        def do_MKCOL(self):
            try:
                target = self.target()
                if target.exists():
                    return self.reply(405)
                target.mkdir(); self.reply(201)
            except (ValueError, OSError):
                self.reply(409)

        def do_PROPFIND(self):
            try:
                self.body(); target = self.target()
                if not target.exists():
                    return self.reply(404)
                entries = [target] + (list(target.iterdir()) if target.is_dir() and self.headers.get("Depth") != "0" else [])
                rows = []
                for item in entries[:1000]:
                    url = "/dav/" + urllib.parse.quote(item.relative_to(webroot).as_posix().removeprefix("."), safe="/")
                    if item.is_dir() and not url.endswith("/"):
                        url += "/"
                    resource = "<d:collection/>" if item.is_dir() else ""
                    rows.append(f'<d:response><d:href>{escape(url)}</d:href><d:propstat><d:prop><d:resourcetype>{resource}</d:resourcetype><d:getcontentlength>{item.stat().st_size if item.is_file() else 0}</d:getcontentlength><d:getlastmodified>{email.utils.formatdate(item.stat().st_mtime, usegmt=True)}</d:getlastmodified><d:getetag>"{item.stat().st_mtime_ns}"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>')
                self.reply(207, ('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">' + "".join(rows) + '</d:multistatus>').encode(), "application/xml; charset=utf-8")
            except (ValueError, OSError):
                self.reply(400)

        def do_GET(self):
            try:
                target = self.target()
                if target.is_file():
                    self.reply(200, target.read_bytes(), "application/octet-stream")
                else:
                    self.reply(200, b"Receptor ficticio DLP. HTTPS, WebDAV /dav/ y SMTP.")
            except ValueError:
                self.reply(400)

        def do_HEAD(self):
            self.do_GET()

        def do_OPTIONS(self):
            self.send_response(200); self.send_header("DAV", "1"); self.send_header("Allow", "GET,HEAD,OPTIONS,PROPFIND,MKCOL,PUT,POST"); self.send_header("Content-Length", "0"); self.end_headers()

    class MailSink:
        async def handle_DATA(self, server, session, envelope):
            name = str(uuid.uuid4()) + ".eml"
            (directory / name).write_bytes(envelope.original_content); receipt("smtp", name, envelope.original_content)
            return "250 2.0.0 Receptor de laboratorio acepto el mensaje"

    host = os.environ.get("DLP_SINK_BIND", "127.0.0.1")
    web = ThreadingHTTPServer((host, int(os.environ.get("DLP_SINK_PORT", "4201"))), Handler)
    certs = Path(os.environ.get("DLP_LAB_CERTS", "datos-control/certs-private"))
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); context.load_cert_chain(certs / "receiver.pem", certs / "receiver.key")
    web.socket = context.wrap_socket(web.socket, server_side=True)
    smtp = Controller(MailSink(), hostname=host, port=int(os.environ.get("DLP_SMTP_SINK_PORT", "2526")), data_size_limit=12 * 1024 * 1024, decode_data=False)
    smtp.start(); threading.Thread(target=web.serve_forever, daemon=True).start()
    done = threading.Event()
    for name in ("SIGINT", "SIGTERM"):
        signal.signal(getattr(signal, name), lambda *_: done.set())
    print("Receptores independientes HTTPS/WebDAV y SMTP iniciados", flush=True)
    try:
        done.wait()
    finally:
        smtp.stop(); web.shutdown(); web.server_close()


if __name__ == "__main__":
    serve()
