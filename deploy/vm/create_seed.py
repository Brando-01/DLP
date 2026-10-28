"""NoCloud de una VM nueva del proyecto, acceso solo mediante clave SSH local."""
import argparse
import io
import json
from pathlib import Path
import uuid
import pycdlib


def create(public_key, destination):
    key = Path(public_key).read_text(encoding="utf-8").strip()
    if not key.startswith("ssh-ed25519 ") or "\n" in key:
        raise ValueError("Clave SSH pública no válida")
    userdata = {"users": [{"name": "dlpadmin", "groups": "sudo", "shell": "/bin/bash", "sudo": ["ALL=(ALL) NOPASSWD:ALL"], "lock_passwd": True, "ssh_authorized_keys": [key]}], "ssh_pwauth": False, "disable_root": True, "package_update": True, "packages": ["docker.io", "docker-compose-v2", "ca-certificates", "curl", "unzip"], "runcmd": [["systemctl", "enable", "--now", "docker"], ["usermod", "-aG", "docker", "dlpadmin"]]}
    metadata = {"instance-id": "dlp-" + str(uuid.uuid4()), "local-hostname": "dlp-control"}
    iso = pycdlib.PyCdlib(); iso.new(interchange_level=3, joliet=3, rock_ridge="1.09", vol_ident="CIDATA")
    for name, value in [("user-data", "#cloud-config\n" + json.dumps(userdata)), ("meta-data", json.dumps(metadata))]:
        data = value.encode("utf-8")
        iso.add_fp(io.BytesIO(data), len(data), iso_path="/" + name.upper().replace("-", "_") + ".;1", rr_name=name, joliet_path="/" + name)
    iso.write(str(destination)); iso.close()


if __name__ == "__main__":
    args = argparse.ArgumentParser(); args.add_argument("--public-key", required=True); args.add_argument("--output", required=True)
    values = args.parse_args(); create(values.public_key, values.output)
    print("Disco de configuración creado con clave pública; no contiene claves privadas ni API key")
