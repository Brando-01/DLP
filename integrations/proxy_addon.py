"""mitmdump -s integrations/proxy_addon.py --set connection_strategy=lazy"""
import asyncio
import os
import sys
import time
import urllib.parse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mitmproxy import http, ctx, exceptions
from integrations.client import DlpClient
from integrations.content import bounded_body, http_parts, MAX_BYTES
from integrations.audit import record


class DlpProxy:
    def __init__(self, client=None):
        self.client = client or DlpClient()
        self.cache_until = 0
        self.config = {}

    def configure(self, updated):
        if ctx.options.stream_large_bodies or ctx.options.ignore_hosts:
            raise exceptions.OptionsError("DLP requiere cuerpos retenidos y no admite ignore_hosts")

    async def decision(self, flow, parts, **metadata):
        # Sin consultas ni credenciales en destino/auditoría. Los parámetros se inspeccionan como contenido.
        target = urllib.parse.urlsplit(flow.request.pretty_url)
        destination = urllib.parse.urlunsplit((target.scheme, target.netloc, "/", "", ""))
        return await self.client.inspect("web_proxy", destination, parts, device=str(flow.client_conn.peername[0]) if flow.client_conn.peername else "proxy", **metadata)

    async def deny(self, flow, reason, result=None, code=403):
        flow.response = http.Response.make(code, f"DLP: operación retenida. {reason}".encode("utf-8"), {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"})
        record("web_proxy", "RESULTADO_CONECTOR_LOCAL", "CANCELLED" if code == 403 else "RETAINED_INSPECTION_FAILURE", True)
        if result:
            try:
                await self.client.receipt(result, "CANCELLED")
            except RuntimeError:
                ctx.log.warn("DLP: bloqueo local aplicado; recibo central pendiente")

    async def requestheaders(self, flow):
        flow.request.stream = False
        value = flow.request.headers.get("content-length")
        if value and (not value.isdigit() or int(value) > MAX_BYTES):
            await self.deny(flow, "La carga supera el límite de inspección")

    async def request(self, flow):
        if flow.response:
            return
        try:
            # Impide liberar el cuerpo si hay un fallo de política o del motor.
            if time.monotonic() > self.cache_until:
                self.config = await asyncio.to_thread(self.client.request, "/v1/config")
                self.cache_until = time.monotonic() + 10
            data = bounded_body(flow.request.raw_content or b"", flow.request.headers.get("content-encoding", ""))
            filename = urllib.parse.unquote(flow.request.headers.get("x-dlp-file-name", "")) or urllib.parse.urlsplit(flow.request.pretty_url).path.split("/")[-1] or "documento.bin"
            parts = http_parts(data, flow.request.headers.get("content-type", ""), filename)
            query = urllib.parse.urlsplit(flow.request.pretty_url).query
            if query:
                fields = urllib.parse.parse_qsl(query, keep_blank_values=True, max_num_fields=200, errors="strict")
                parts.append(("consulta.txt", "\n".join(f"{key}: {value}" for key, value in fields).encode()))
            fragmented = "content-range" in flow.request.headers or flow.request.headers.get("upload-offset") is not None or flow.request.headers.get("upload-length") is not None or flow.request.headers.get("transfer-encoding", "").lower() not in ("", "chunked")
            unsupported = flow.request.headers.get("upgrade", "").lower() == "websocket" or flow.request.headers.get("content-type", "").split(";")[0].lower() == "application/dns-message" or flow.request.method not in ("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "PROPFIND", "MKCOL")
            result = await self.decision(flow, parts, fragmented=fragmented, unsupported=unsupported)
            if not result["allowed"]:
                await self.deny(flow, result["reason"], result)
            else:
                flow.metadata["dlp_result"] = result
        except (ValueError, UnicodeError, RuntimeError):
            await self.deny(flow, "No se pudo completar la inspección", code=503)

    async def response(self, flow):
        result = flow.metadata.pop("dlp_result", None)
        if result:
            try:
                await self.client.receipt(result, "UPSTREAM_RESPONSE", flow.response.status_code)
            except RuntimeError:
                ctx.log.warn("DLP: respuesta del destino observada; falta registrar el recibo")

    async def error(self, flow):
        result = flow.metadata.pop("dlp_result", None)
        if result:
            try:
                await self.client.receipt(result, "FAILED")
            except RuntimeError:
                pass


addons = [DlpProxy()]
