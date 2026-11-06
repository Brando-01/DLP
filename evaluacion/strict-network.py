"""TLS real con relay Node, proxy estricto, central temporal y receptor independiente."""
import base64
import hashlib
import http.client
import http.server
import json
import os
from pathlib import Path
import runpy
import ssl
import socket
import subprocess
import sys
import tempfile
import threading
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
helpers = runpy.run_path(str(ROOT / "evaluacion/managed-network.py"), run_name="dlp_helpers")


def run():
    received, results = [], []
    with tempfile.TemporaryDirectory(prefix="dlp-strict-network-") as tmp:
        directory = Path(tmp)
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                data = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                received.append({"sha256": hashlib.sha256(data).hexdigest(), "headers": dict(self.headers)})
                self.send_response(200); self.send_header("Content-Length", "2"); self.end_headers(); self.wfile.write(b"OK")
            def log_message(self, *args):
                pass
        sink = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cert, key = helpers["make_cert"](directory)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); context.load_cert_chain(cert, key)
        sink.socket = context.wrap_socket(sink.socket, server_side=True)
        threading.Thread(target=sink.serve_forever, daemon=True).start()
        addon = directory / "route_test.py"
        addon.write_text(f'''import sys
sys.path.insert(0, {str(ROOT)!r})
from integrations.strict_proxy import StrictDlpProxy
class RouteFixture:
    def server_connect(self, data):
        if data.server.address == ("sink.dlp.test", 4201):
            data.server.address = ("127.0.0.1", {sink.server_port})
addons=[StrictDlpProxy(), RouteFixture()]
''')
        proxy_port = int(os.environ["DLP_TEST_PROXY_PORT"])
        log = (directory / "proxy.log").open("w")
        proxy = subprocess.Popen([sys.executable, "-c", "from mitmproxy.tools.main import mitmdump; mitmdump()", "--listen-host", "127.0.0.1", "--listen-port", str(proxy_port), "--set", f"confdir={directory / 'mitm'}", "--set", "connection_strategy=lazy", "--set", f"ssl_verify_upstream_trusted_ca={cert}", "-s", str(addon), "-q"], cwd=ROOT, stdout=log, stderr=log, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            def ready():
                if proxy.poll() is not None:
                    return True
                try:
                    with socket.create_connection(("127.0.0.1", proxy_port), timeout=.2):
                        return (directory / "mitm/mitmproxy-ca-cert.pem").exists()
                except OSError:
                    return False
            helpers["wait"](ready)
            if proxy.poll() is not None:
                raise AssertionError("No inició el proxy estricto")
            ca = ssl.create_default_context(cafile=str(directory / "mitm/mitmproxy-ca-cert.pem"))
            def check(label, data, expected, path="/upload", headers=None):
                before = len(received)
                conn = http.client.HTTPSConnection("127.0.0.1", int(os.environ["DLP_TEST_RELAY_PORT"]), context=ca, timeout=30)
                conn.set_tunnel("sink.dlp.test", 4201)
                try:
                    conn.request("POST", path, data, {"Content-Type": "text/plain", **(headers or {})})
                    response = conn.getresponse(); status = response.status; response.read()
                finally:
                    conn.close()
                assert status == expected, (label, status, expected)
                assert len(received) == before + int(expected == 200), label
                if expected == 200:
                    assert received[-1]["sha256"] == hashlib.sha256(data).hexdigest()
                    assert not any(k.lower() in ("proxy-authorization", "authorization", "cookie") for k in received[-1]["headers"])
                results.append(label)
            check("Publico entregado por relay sin extensión", b"Horario publico", 200, headers={"Cookie": "NO_RETRANSMITIR"})
            check("Sensible retenido aunque politica general este en auditoria", b"DNI: 12345678", 403)
            check("Vacio permitido", b"", 200)
            check("Fragmentado retenido", b"DNI: ", 403, headers={"Content-Range": "bytes 0-4/20"})
            check("WebSocket retenido", b"", 403, headers={"Upgrade": "websocket"})
            check("Consulta arbitraria retenida", b"", 403, path="/upload?dato=ejemplo")
            check("Ruta arbitraria retenida", b"", 403, path="/no-permitido")
            node_code = f"const {{requestViaRelay}}=require({json.dumps(str(ROOT / 'scripts/verify-strict-lab.js'))});requestViaRelay(Buffer.from('Horario publico'),require('node:fs').readFileSync({json.dumps(str(directory / 'mitm/mitmproxy-ca-cert.pem'))}),{{port:Number(process.env.DLP_TEST_RELAY_PORT)}}).then(s=>{{console.log(s);process.exitCode=s===200?0:1}}).catch(()=>{{process.exitCode=1}})"
            node = subprocess.run([os.environ.get("DLP_TEST_NODE", "node"), "-e", node_code], cwd=ROOT, capture_output=True, text=True, timeout=20)
            assert node.returncode == 0 and node.stdout.strip() == "200", "Verificador Node no entrego la muestra publica"
            results.append("Verificador Node transmite por TLS con CA validada")
            # Credencial compartida o ausente no abre ni siquiera CONNECT.
            for label, authorization in [("Sin credencial", None), ("Credencial compartida rechazada", base64.b64encode((os.environ["DLP_TEST_DEVICE"] + ":" + os.environ["DLP_INSPECT_TOKEN"]).encode()).decode())]:
                conn = http.client.HTTPConnection("127.0.0.1", proxy_port, timeout=5)
                conn.request("CONNECT", "sink.dlp.test:4201", headers={"Proxy-Authorization": "Basic " + authorization} if authorization else {})
                response = conn.getresponse(); assert response.status == 407, label; response.read(); conn.close(); results.append(label)
            # Revocar el equipo impide nuevos túneles aun con la credencial antes válida.
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            request = urllib.request.Request(os.environ["DLP_CONTROL_URL"] + "/v1/admin/devices/" + os.environ["DLP_TEST_DEVICE"] + "/revoke", data=b"{}", headers={"X-DLP-Token": os.environ["DLP_TEST_ADMIN_TOKEN"], "Content-Type": "application/json"})
            opener.open(request, timeout=5).close()
            conn = http.client.HTTPSConnection("127.0.0.1", int(os.environ["DLP_TEST_RELAY_PORT"]), context=ca, timeout=5); conn.set_tunnel("sink.dlp.test", 4201)
            try:
                conn.request("POST", "/upload", b"Horario publico")
                raise AssertionError("La revocacion no retuvo el tunel")
            except OSError:
                results.append("Revocacion retiene nuevos tuneles")
            finally:
                conn.close()
            report = {"passed": True, "tests": results, "evidence": "REAL_TLS_NODE_RELAY_STRICT_MITMPROXY_AND_RECEIVER", "groqLiveTested": False, "vmFirewallTested": False}
            (ROOT / "output/evaluacion/resultado-estricto.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps(report, ensure_ascii=False))
        except Exception:
            log.flush(); print((directory / "proxy.log").read_text()[-2500:], file=sys.stderr)
            raise
        finally:
            proxy.terminate(); proxy.wait(timeout=15); log.close(); sink.shutdown(); sink.server_close()


if __name__ == "__main__":
    run()
