"""Salida estricta SOLO en VM. Tabla nft propia, políticas de navegador y restauración."""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import uuid

STATE = Path("/var/lib/dlp-strict-lab")
TABLE = "dlp_strict_lab"
UNIT = Path("/etc/systemd/system/dlp-strict-lab.service")
CA = Path("/usr/local/share/ca-certificates/dlp-strict-lab.crt")


def run(*args, check=True):
    return subprocess.run(args, check=check, text=True, capture_output=True).stdout


def digest(data):
    return hashlib.sha256(data).hexdigest()


def rules(policy, owner):
    ip = str(ipaddress.IPv4Address(policy["gateway"]))
    uid = policy["uid"]
    if not ipaddress.ip_address(ip).is_private or not isinstance(uid, int) or uid <= 0:
        raise ValueError("Se requiere gateway privado y UID de usuario sin root")
    return f'''table inet {TABLE} {{
 comment "DLP owner={owner}"
 chain output {{ type filter hook output priority -10; policy drop;
  oifname "lo" accept
  meta skuid {uid} ip daddr {ip} tcp dport {{ 3100, 8081 }} accept
  meta skuid 0 udp sport 68 udp dport 67 accept
 }}
 chain input {{ type filter hook input priority -10; policy drop;
  iifname "lo" accept
  ct state established,related accept
  udp sport 67 udp dport 68 accept
 }}
 chain forward {{ type filter hook forward priority -10; policy drop; }}
}}
'''


def nft_state():
    result = subprocess.run(["nft", "-j", "list", "table", "inet", TABLE], text=True, capture_output=True)
    if result.returncode:
        return None
    value = json.loads(result.stdout)
    def clean(obj):
        if isinstance(obj, dict):
            return {k: clean(v) for k, v in obj.items() if k not in ("handle", "metainfo", "packets", "bytes")}
        if isinstance(obj, list):
            return [clean(v) for v in obj if not isinstance(v, dict) or "metainfo" not in v]
        return obj
    return clean(value)


def save(state):
    tmp = STATE / "state.tmp"
    tmp.write_text(json.dumps(state, indent=2)); tmp.chmod(0o600); tmp.replace(STATE / "state.json")


def put(file, data, state):
    file = Path(file)
    if file.is_symlink() or any(p.is_symlink() for p in file.parents):
        raise ValueError("No se modifican rutas enlazadas")
    prior = file.read_bytes() if file.exists() else None
    state["files"].append({"path": str(file), "before": prior.hex() if prior is not None else None, "applied": digest(data)})
    save(state)  # Respaldo anterior a cada mutación.
    file.parent.mkdir(parents=True, exist_ok=True); file.write_bytes(data); file.chmod(0o644)


def restore(state):
    if state.get("phase") == "RESTORED":
        return
    warnings = []
    actual = nft_state()
    if actual is not None:
        tables = [v.get("table", {}) for v in actual["nftables"]]
        if not any(v.get("comment") == "DLP owner=" + state["owner"] for v in tables):
            raise ValueError("La tabla no pertenece al respaldo; no se elimina")
        run("nft", "delete", "table", "inet", TABLE)
    if state.get("unitEnabled"):
        run("systemctl", "disable", "dlp-strict-lab.service")
    for item in reversed(state["files"]):
        file = Path(item["path"])
        if not file.exists():
            if item["before"] is not None:
                warnings.append("Archivo eliminado externamente: " + str(file))
            continue
        if file.is_symlink() or digest(file.read_bytes()) != item["applied"]:
            warnings.append("Archivo modificado externamente: " + str(file)); continue
        if item["before"] is None:
            file.unlink()
        else:
            file.write_bytes(bytes.fromhex(item["before"]))
    run("systemctl", "daemon-reload"); run("update-ca-certificates")
    if warnings:
        save({**state, "phase": "RESTORE_PARTIAL"})
        raise ValueError("; ".join(warnings))
    save({**state, "phase": "RESTORED"})


def main():
    parser = argparse.ArgumentParser(); parser.add_argument("action", choices=["plan", "apply", "audit", "restore"]); parser.add_argument("--policy")
    args = parser.parse_args()
    policy = json.loads(Path(args.policy).read_text()) if args.policy else json.loads((STATE / "state.json").read_text())["policy"]
    if policy.get("schemaVersion") != 1 or policy.get("strictLab") is not True or policy.get("host") != socket.gethostname():
        raise ValueError("La política no corresponde a esta VM")
    source = rules(policy, "00000000-0000-4000-8000-000000000000")
    if args.action == "plan":
        print(json.dumps({"applied": False, "rules": source, "scope": "VM, IPv4/IPv6 y reenvío; solo loopback, UID del agente al central/proxy y DHCP", "nativeSensitiveOnly": False})); return
    if os.geteuid() != 0:
        raise ValueError("Esta operación requiere sudo dentro de la VM")
    model = Path("/sys/class/dmi/id/product_name").read_text().strip()
    if not any(x.lower() in model.lower() for x in ("VirtualBox", "Virtual Machine", "VMware", "KVM")):
        raise ValueError("Solo se permite en una VM identificada; no en el anfitrión")
    if not shutil.which("nft") or not shutil.which("update-ca-certificates"):
        raise ValueError("Instala nftables y ca-certificates ANTES de activar")
    for directory in (STATE.parent, STATE):
        if directory.is_symlink():
            raise ValueError("Directorio de estado enlazado")
    STATE.mkdir(mode=0o700, exist_ok=True)
    if STATE.stat().st_uid != 0 or STATE.stat().st_mode & 0o022:
        raise ValueError("El estado debe pertenecer a root y no admitir escritura ajena")
    statefile = STATE / "state.json"
    if args.action in ("audit", "restore"):
        if not statefile.exists():
            print(json.dumps({"state": "NOT_APPLIED", "configurationVerified": False})); return
        state = json.loads(statefile.read_text())
        if state["host"] != socket.gethostname():
            raise ValueError("Respaldo de otro equipo")
        if args.action == "restore":
            restore(state); print(json.dumps({"restored": True})); return
        actual = nft_state()
        findings = []
        if state["phase"] != "APPLIED" or actual != state.get("nftState"):
            findings.append("Tabla nft ausente o modificada")
        for item in state["files"]:
            file = Path(item["path"])
            if not file.exists() or file.is_symlink() or digest(file.read_bytes()) != item["applied"]:
                findings.append("Archivo alterado: " + str(file))
        if subprocess.run(["systemctl", "is-enabled", "--quiet", "dlp-strict-lab.service"]).returncode:
            findings.append("Persistencia no habilitada")
        print(json.dumps({"configurationVerified": not findings, "findings": findings, "networkTestsRequired": True, "nativeSensitiveOnly": False})); return
    if statefile.exists() and json.loads(statefile.read_text())["phase"] != "RESTORED":
        raise ValueError("Restaura el perfil anterior antes de aplicar")
    if nft_state() is not None or UNIT.exists() or CA.exists():
        raise ValueError("Hay una tabla/unidad/CA previa; no se sustituye")
    addresses = json.loads(run("ip", "-j", "address"))
    if any(a.get("local") == policy["gateway"] for n in addresses for a in n.get("addr_info", [])):
        raise ValueError("Gateway no puede ser una dirección de este equipo")
    for host, port in ((policy["gateway"], 3100), (policy["gateway"], 8081), ("127.0.0.1", 3002)):
        with socket.create_connection((host, port), timeout=3):
            pass
    ca = Path(policy["caCertificate"]).read_bytes()
    if b"PRIVATE KEY" in ca or b"BEGIN CERTIFICATE" not in ca:
        raise ValueError("Se requiere CA pública")
    owner = str(uuid.uuid4()); rulefile = STATE / "rules.nft"
    rulefile.write_text(rules(policy, owner)); rulefile.chmod(0o600)
    run("nft", "--check", "--file", str(rulefile))
    state = {"schemaVersion": 1, "host": socket.gethostname(), "owner": owner, "phase": "PREPARING", "files": [], "unitEnabled": False, "policy": policy}
    save(state)
    try:
        put(STATE / "restore.py", Path(__file__).read_bytes(), state)
        put(CA, ca, state); run("update-ca-certificates")
        proxy = "127.0.0.1:3002"
        chromium = {"ProxyMode": "fixed_servers", "ProxyServer": proxy, "ProxyBypassList": "localhost;127.0.0.1", "QuicAllowed": False, "DnsOverHttpsMode": "off"}
        for file in ("/etc/opt/chrome/policies/managed/dlp-strict.json", "/etc/chromium/policies/managed/dlp-strict.json"):
            if Path(file).exists():
                raise ValueError("Política de navegador existente; no se sustituye")
            put(file, json.dumps(chromium).encode(), state)
        for firefox in (Path("/usr/lib/firefox-esr"), Path("/usr/lib/firefox")):
            if not firefox.is_dir():
                continue
            file = firefox / "distribution/policies.json"
            existing = json.loads(file.read_text()) if file.exists() else {"policies": {}}
            existing["policies"].update({"Proxy": {"Mode": "manual", "Locked": True, "HTTPProxy": proxy, "SSLProxy": proxy, "UseHTTPProxyForAllProtocols": True, "Passthrough": "localhost,127.0.0.1"}, "DNSOverHTTPS": {"Enabled": False, "Locked": True}, "Certificates": {"Install": [str(CA)]}})
            put(file, json.dumps(existing).encode(), state)
        unit = f"[Unit]\nDescription=DLP strict laboratory egress\nBefore=network-pre.target\nWants=network-pre.target\nDefaultDependencies=no\nAfter=local-fs.target\n[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStart=/usr/sbin/nft -f {rulefile}\n[Install]\nWantedBy=multi-user.target\n"
        put(UNIT, unit.encode(), state); run("systemctl", "daemon-reload")
        state["unitEnabled"] = True; save(state); run("systemctl", "enable", "dlp-strict-lab.service")
        run("nft", "--file", str(rulefile)); state["nftState"] = nft_state(); state["phase"] = "APPLIED"; save(state)
        print(json.dumps({"applied": True, "networkTestsRequired": True, "nativeSensitiveOnly": False}))
    except Exception:
        restore(state)
        raise


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("DLP estricto: " + str(error), file=sys.stderr); sys.exit(1)
