"""Listener de laboratorio: identidad individual, solo receptor HTTPS y sin bypass TLS."""
import asyncio
import base64
import re
import urllib.parse
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mitmproxy import http
from integrations.client import DlpClient
from integrations.proxy_addon import DlpProxy


class StrictDlpProxy(DlpProxy):
    def __init__(self, client_factory=DlpClient):
        super().__init__()
        self.client_factory = client_factory
        self.connections = {}

    async def authenticate(self, flow):
        header = flow.request.headers.pop("proxy-authorization", "")
        identity = self.connections.get(flow.client_conn.id)
        if header:
            try:
                scheme, value = header.split(" ", 1)
                if scheme.lower() != "basic" or len(value) > 256:
                    raise ValueError()
                device, token = base64.b64decode(value, validate=True).decode("ascii").split(":", 1)
                if not re.fullmatch(r"[a-f0-9-]{36}", device) or not re.fullmatch(r"[a-f0-9]{64}", token):
                    raise ValueError()
                client = self.client_factory(token=token)
                config = await asyncio.to_thread(client.request, "/v1/config")
                if config.get("individualDevice", {}).get("id") != device:
                    raise ValueError()
                identity = (device, client)
                if len(self.connections) >= 1000:
                    self.connections.pop(next(iter(self.connections)))
                self.connections[flow.client_conn.id] = identity
            except (ValueError, UnicodeError, RuntimeError, AttributeError):
                self.connections.pop(flow.client_conn.id, None)
                identity = None
        if not identity:
            flow.response = http.Response.make(407, b"DLP: identidad individual requerida", {"Proxy-Authenticate": 'Basic realm="DLP laboratorio"', "Connection": "close"})
            return False
        flow.metadata["dlp_client"] = identity[1]
        flow.metadata["dlp_device"] = identity[0]
        return True

    async def http_connect(self, flow):
        if not await self.authenticate(flow):
            return
        if flow.request.host != "sink.dlp.test" or flow.request.port != 4201:
            await self.deny(flow, "Canal fuera del receptor autorizado")

    async def requestheaders(self, flow):
        if not await self.authenticate(flow):
            return
        target = urllib.parse.urlsplit(flow.request.pretty_url)
        if target.scheme != "https" or target.hostname != "sink.dlp.test" or target.port != 4201 or target.path not in ("/", "/upload") or target.query:
            await self.deny(flow, "Solo se admite el receptor HTTPS del laboratorio, sin rutas ni consultas arbitrarias")
            return
        # No retransmitir credenciales o cabeceras arbitrarias al receptor ficticio.
        for key in list(flow.request.headers.keys()):
            if key.lower() not in ("host", "content-type", "content-length", "content-encoding", "x-dlp-file-name", "content-range", "upload-offset", "upload-length", "transfer-encoding", "upgrade"):
                flow.request.headers.pop(key, None)
        await super().requestheaders(flow)

    async def decision(self, flow, parts, **metadata):
        return await self.client_for(flow).inspect("web_proxy", "https://sink.dlp.test:4201/", parts, device=flow.metadata["dlp_device"], strictLab=True, **metadata)

    def client_disconnected(self, client):
        self.connections.pop(client.id, None)

    def tcp_start(self, flow):
        # Nunca degradar un túnel no HTTP a un transporte TCP sin inspección.
        flow.kill()

    def udp_start(self, flow):
        flow.kill()


addons = [StrictDlpProxy()]
