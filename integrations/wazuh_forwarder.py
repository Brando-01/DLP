"""Proyecta alertas DLP de Wazuh al panel, sin reenviar mensajes ni documentos."""
import json
import os
from pathlib import Path
import socket
import time
from integrations.client import DlpClient


def project(event):
    rule = event.get("rule", {})
    try:
        ident = int(rule.get("id", 0))
    except ValueError:
        return None
    if not 100200 <= ident <= 100299:
        return None
    return {"id": str(event.get("id", "")), "timestamp": str(event.get("timestamp", "")), "channel": "wazuh", "activity": "WAZUH_" + str(ident), "decision": "ALERTA" if int(rule.get("level", 0)) >= 7 else "DETECTADO", "prevented": False, "outcome": "CORRELATED_ALERT", "ruleId": ident}


def main():
    client = DlpClient(token=os.environ.get("DLP_TELEMETRY_TOKEN", ""))
    file = Path(os.environ.get("DLP_WAZUH_ALERTS", "/var/ossec/logs/alerts/alerts.json"))
    offset, previous_inode = 0, None
    pending = []
    while True:
        try:
            stat = file.stat()
            if stat.st_ino != previous_inode or stat.st_size < offset:
                previous_inode = stat.st_ino; offset = 0
            with file.open("r", encoding="utf-8") as stream:
                stream.seek(offset)
                # Aplicar contrapresion: conservar el cursor si el control no responde.
                for _ in range(min(100, max(0, 1000 - len(pending)))):
                    line = stream.readline()
                    if not line:
                        break
                    if not line.endswith("\n"):
                        break
                    event = project(json.loads(line))
                    if event:
                        pending.append(event)
                    offset = stream.tell()
            if pending:
                client.request("/v1/telemetry", {"device": "wazuh-manager", "coverage": "Alertas correlacionadas; no equivalen a prevención", "events": pending[:100]})
                del pending[:100]
        except (OSError, ValueError, RuntimeError):
            pass
        time.sleep(3)


if __name__ == "__main__":
    main()
