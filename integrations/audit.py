"""Evidencia local minima cuando el control central no responde; nunca guarda contenido."""
import json
import os
from pathlib import Path
import threading
import time

_lock = threading.Lock()


def record(channel, activity, outcome, prevented=False):
    event = {"timestamp": time.time(), "channel": channel, "activity": activity,
             "decision": "BLOQUEADO" if prevented else "ERROR", "prevented": prevented,
             "outcome": outcome, "evidence": "LOCAL_CONNECTOR_RECEIPT"}
    file = os.environ.get("DLP_CONNECTOR_LOG")
    try:
        with _lock:
            if file:
                path = Path(file); path.parent.mkdir(parents=True, exist_ok=True)
                if path.exists() and path.stat().st_size > 5 * 1024 * 1024:
                    path.replace(path.with_suffix(path.suffix + ".1"))
                with path.open("a", encoding="utf-8") as stream:
                    stream.write(json.dumps(event) + "\n")
            else:
                print(json.dumps(event), flush=True)
    except OSError:
        print("DLP: no se pudo persistir el recibo local", flush=True)
