"""Cliente del motor. No persiste contenido ni credenciales en sus errores."""
import asyncio
import base64
import json
import os
import ssl
import urllib.parse
import urllib.request


class DlpClient:
    def __init__(self, url=None, token=None):
        self.url = (url or os.environ.get("DLP_CONTROL_URL", "http://127.0.0.1:3100")).rstrip("/")
        self.token = token or os.environ.get("DLP_INSPECT_TOKEN", "")
        parsed = urllib.parse.urlsplit(self.url)
        if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path or parsed.scheme not in ("http", "https"):
            raise ValueError("Dirección del control no válida")
        if parsed.scheme == "http" and parsed.hostname not in ("127.0.0.1", "localhost") and os.environ.get("DLP_ALLOW_LAB_HTTP") != "1":
            raise ValueError("El control remoto requiere HTTPS o una red de laboratorio explícita")
        ca = os.environ.get("DLP_CONTROL_CA")
        context = ssl.create_default_context(cafile=ca) if ca else ssl.create_default_context()
        # No heredar un proxy del equipo: evita bucles de inspección del propio motor.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                raise ValueError("El control no puede redirigir credenciales")
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=context), NoRedirect())

    def request(self, route, data=None):
        if len(self.token) != 64 or any(c not in "0123456789abcdef" for c in self.token):
            raise RuntimeError("Falta el token del conector")
        payload = json.dumps(data).encode() if data is not None else None
        request = urllib.request.Request(self.url + route, data=payload, headers={"X-DLP-Token": self.token, "Content-Type": "application/json"})
        try:
            with self.opener.open(request, timeout=55) as response:
                body = response.read(1024 * 1024 + 1)
                if len(body) > 1024 * 1024:
                    raise ValueError("Respuesta demasiado grande")
                return json.loads(body)
        except Exception as error:
            raise RuntimeError("Control DLP no disponible o respuesta no válida") from None

    async def inspect(self, channel, destination, parts, **metadata):
        if sum(len(content) for _, content in parts) > 10 * 1024 * 1024 or len(parts) > 20:
            raise ValueError("Límite de inspección excedido")
        data = {"channel": channel, "destination": destination, "parts": [{"name": name, "base64": base64.b64encode(content).decode("ascii")} for name, content in parts], **metadata}
        result = await asyncio.to_thread(self.request, "/v1/inspect", data)
        if not isinstance(result.get("allowed"), bool) or not isinstance(result.get("ticket"), str):
            raise RuntimeError("Respuesta DLP sin decisión válida")
        return result

    async def receipt(self, result, outcome, status=None):
        value = {"ticket": result["ticket"], "outcome": outcome}
        if status is not None:
            value["status"] = status
        return await asyncio.to_thread(self.request, "/v1/receipts", value)
