"""DLP de red local Windows: módulo preparado para mitmproxy --mode local.

No se activa al importarlo. El coordinador exige una activación explícita y
consentimiento al procesamiento externo. No es un minifilter ni un kill switch.
"""
import asyncio
import json
import os
from pathlib import Path
import sys
import time
import urllib.parse
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mitmproxy import ctx, exceptions
from integrations.proxy_addon import DlpProxy
from integrations.client import DlpClient
from integrations.content import bounded_body, http_parts
from integrations.audit import record


class PcCapture(DlpProxy):
    def __init__(self, client=None):
        super().__init__(client)
        self.status_task = None

    def configure(self, updated):
        super().configure(updated)
        if os.environ.get("DLP_PC_CAPTURE_ACK") != "1":
            raise exceptions.OptionsError("PC: captura desactivada; falta activación explícita y aceptación del procesamiento externo")
        if ctx.options.ssl_insecure or ctx.options.tcp_hosts or ctx.options.udp_hosts or ctx.options.connection_strategy != "lazy":
            raise exceptions.OptionsError("PC: requiere TLS verificado, conexión lazy y no admite túneles TCP/UDP genéricos")

    async def decision(self, flow, parts, **metadata):
        url = urllib.parse.urlsplit(flow.request.pretty_url)
        origin = urllib.parse.urlunsplit((url.scheme, url.netloc, "/", "", ""))
        return await self.client.inspect("web_proxy", origin, parts, device=os.environ.get("DLP_DEVICE_ID", "PC"), pcCapture=True, **metadata)

    async def request(self, flow):
        if flow.response:
            return
        if flow.request.method == "CONNECT":
            await self.deny(flow, "PC: no se admite un túnel CONNECT dentro de otra conexión")
            return
        # La ruta también puede transportar datos. No se registra la ruta ni sus valores.
        try:
            if time.monotonic() > self.cache_until:
                self.config = await asyncio.to_thread(self.client.request, "/v1/config")
                if not isinstance(self.config, dict) or (self.config.get("capabilities") or {}).get("pcCaptureEnforce") is not True or (self.config.get("individualDevice") or {}).get("id") != os.environ.get("DLP_DEVICE_ID"):
                    raise RuntimeError("Central incompatible o identidad no individual")
                self.cache_until = time.monotonic() + 10
            data = bounded_body(flow.request.raw_content or b"", flow.request.headers.get("content-encoding", ""))
            filename = urllib.parse.unquote(flow.request.headers.get("x-dlp-file-name", "")) or urllib.parse.urlsplit(flow.request.pretty_url).path.rsplit("/", 1)[-1] or "documento.bin"
            parts = http_parts(data, flow.request.headers.get("content-type", ""), filename)
            url = urllib.parse.urlsplit(flow.request.pretty_url)
            query = urllib.parse.parse_qsl(url.query, keep_blank_values=True, max_num_fields=200, errors="strict")
            if query:
                parts.append(("consulta.txt", "\n".join(f"{k}: {v}" for k, v in query).encode()))
            # No enviar cookies/Authorization a Groq. Eso deja un límite explícito:
            # este filtro no demuestra ausencia de canales encubiertos en cabeceras.
            path = urllib.parse.unquote(url.path, errors="strict")
            if len(path) > 4096:
                raise ValueError("Ruta superior al límite")
            if path.strip("/"):
                parts.append(("ruta.txt", path.encode()))
            fragmented = any(k in flow.request.headers for k in ("content-range", "upload-offset", "upload-length")) or flow.request.headers.get("transfer-encoding", "").lower() not in ("", "chunked")
            unsupported = flow.request.headers.get("upgrade", "").lower() == "websocket" or flow.request.headers.get("content-type", "").split(";")[0].lower() == "application/dns-message" or flow.request.method not in ("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "PROPFIND", "MKCOL")
            result = await self.decision(flow, parts, fragmented=fragmented, unsupported=unsupported, outboundWrite=flow.request.method not in ("GET", "HEAD", "OPTIONS", "PROPFIND"))
            if result["allowed"]:
                flow.metadata["dlp_result"] = result
            else:
                await self.deny(flow, result["reason"], result)
        except Exception:
            # Un error inesperado del addon tampoco debe liberar la petición.
            await self.deny(flow, "PC: no se completó la inspección; transferencia retenida", code=503)

    def tcp_start(self, flow):
        flow.kill()
        record("pc_capture", "TCP_NO_INSPECCIONABLE", "BLOCKED_CAPTURED_CHANNEL", True)

    def udp_start(self, flow):
        flow.kill()
        record("pc_capture", "UDP_NO_INSPECCIONABLE", "BLOCKED_CAPTURED_CHANNEL", True)

    def dns_request(self, flow):
        # El piloto restringe DNS capturado. No se presenta como resolución de
        # uso diario ni como detector semántico de túneles DNS.
        flow.kill()
        record("pc_capture", "DNS_CAPTURADO_RESTRINGIDO", "BLOCKED_CAPTURED_CHANNEL", True)

    def _status(self, state):
        target = os.environ.get("DLP_PC_CAPTURE_STATUS")
        value = {"state": state, "pid": os.getpid(), "session": os.environ.get("DLP_PC_CAPTURE_SESSION", ""), "updatedAt": time.time(), "scope": os.environ.get("DLP_PC_CAPTURE_SCOPE", "UNKNOWN"), "universalProtection": False, "failClosedOnProcessExit": False}
        if target:
            file = Path(target); temporary = file.with_suffix(".tmp")
            temporary.write_text(json.dumps(value), encoding="utf-8"); temporary.replace(file)

    async def running(self):
        self._status("CAPTURE_RUNNING")
        self.status_task = asyncio.create_task(self.heartbeat())

    async def heartbeat(self):
        token = os.environ.get("DLP_TELEMETRY_TOKEN", "")
        client = DlpClient(token=token)
        while True:
            try:
                await asyncio.to_thread(client.request, "/v1/telemetry", {"device": os.environ["DLP_DEVICE_ID"], "platform": "win32", "hostname": os.environ.get("COMPUTERNAME", "PC"), "version": "3.0.0", "startMode": "WINDOWS_LOCAL_CAPTURE", "coverage": "HTTP(S) capturado mientras el proceso está activo; sin kill switch ni control universal", "events": []})
            except RuntimeError:
                pass
            self._status("CAPTURE_RUNNING")
            await asyncio.sleep(10)

    def done(self):
        if self.status_task:
            self.status_task.cancel()
        self._status("STOPPED")


addons = [PcCapture()]
