"""Prueba kernel real: dos namespaces propios; nunca cambia tablas de la red anfitriona."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("strict_egress", ROOT / "endpoint/linux/strict_egress.py")
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs)


def main():
    if os.geteuid() != 0:
        raise RuntimeError("Esta prueba requiere sudo y namespaces Linux")
    suffix = uuid.uuid4().hex[:10]; client, gateway = "dlpc-" + suffix, "dlpg-" + suffix
    created, server, results = [], None, []
    try:
        for name in (client, gateway):
            run("ip", "netns", "add", name); created.append(name)
        run("ip", "-n", client, "link", "add", "veth-c", "type", "veth", "peer", "name", "veth-g", "netns", gateway)
        for name, dev, address, v6 in ((client, "veth-c", "192.168.56.101/24", "fd00:56::101/64"), (gateway, "veth-g", "192.168.56.1/24", "fd00:56::1/64")):
            run("ip", "-n", name, "link", "set", "lo", "up"); run("ip", "-n", name, "link", "set", dev, "up")
            run("ip", "-n", name, "address", "add", address, "dev", dev)
            run("ip", "-n", name, "-6", "address", "add", v6, "dev", dev, "nodad")
        program = '''import socket,threading,time
def listen(family,host,port):
 s=socket.socket(family);s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind((host,port));s.listen()
 while True:
  c,_=s.accept();c.close()
for port in (3100,8081,8080,2525,443,22,21):threading.Thread(target=listen,args=(socket.AF_INET,"192.168.56.1",port),daemon=True).start()
threading.Thread(target=listen,args=(socket.AF_INET6,"fd00:56::1",443),daemon=True).start()
print("READY",flush=True)
time.sleep(120)
'''
        server = subprocess.Popen(["ip", "netns", "exec", gateway, sys.executable, "-u", "-c", program], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        assert server.stdout.readline().strip() == "READY"; time.sleep(.2)
        def reachable(port, uid=1000, host="192.168.56.1"):
            probe = f"import socket,sys\ns=socket.socket(socket.AF_INET6 if ':' in {host!r} else socket.AF_INET);s.settimeout(.5)\ntry:s.connect(({host!r},{port}));sys.exit(0)\nexcept OSError:sys.exit(1)"
            return subprocess.run(["ip", "netns", "exec", client, "setpriv", "--reuid=" + str(uid), "--regid=" + str(uid), "--clear-groups", sys.executable, "-c", probe], capture_output=True).returncode == 0
        for port in (3100, 8081, 8080, 2525, 443, 22, 21):
            assert reachable(port), "Receptor de control no disponible: " + str(port)
        assert reachable(443, host="fd00:56::1")
        with tempfile.TemporaryDirectory(prefix="dlp-nft-test-") as tmp:
            file = Path(tmp) / "rules.nft"; file.write_text(module.rules({"gateway": "192.168.56.1", "uid": 1000}, str(uuid.uuid4())))
            run("ip", "netns", "exec", client, "nft", "--check", "--file", str(file))
            run("ip", "netns", "exec", client, "nft", "--file", str(file))
            for port in (3100, 8081):
                assert reachable(port); results.append("Conector autorizado " + str(port))
            for port in (8080, 2525, 443, 22, 21):
                assert not reachable(port); results.append("Canal alternativo bloqueado " + str(port))
            assert not reachable(443, host="fd00:56::1"); results.append("Salida IPv6 directa bloqueada")
            assert not reachable(8081, uid=1001); results.append("Otro UID sin acceso al gateway")
            run("ip", "netns", "exec", client, "nft", "delete", "table", "inet", module.TABLE)
            assert reachable(443); results.append("Restauración de conectividad al retirar tabla propia")
        report = {"passed": True, "source": "REAL_KERNEL_TWO_ISOLATED_NETWORK_NAMESPACES", "tests": results, "vmInstallationTested": False}
        (ROOT / "output/evaluacion/resultado-nft-estricto.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False))
    finally:
        if server:
            server.terminate(); server.wait(timeout=5)
        for name in reversed(created):
            run("ip", "netns", "delete", name)


if __name__ == "__main__":
    main()
