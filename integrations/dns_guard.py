"""Resolver de laboratorio: canal DNS autorizado, límites y alertas sin texto exfiltrado."""
from collections import defaultdict, deque
import hashlib
import json
import os
from pathlib import Path
import socket
import socketserver
import struct
import threading
import time


def question(packet):
    if len(packet) < 17 or len(packet) > 1232:
        raise ValueError("DNS fuera de límites")
    ident, flags, count, _, _, _ = struct.unpack("!6H", packet[:12])
    if count != 1 or flags & 0x8000 or flags & 0x7800:
        raise ValueError("Consulta DNS no admitida")
    offset, labels = 12, []
    while offset < len(packet):
        size = packet[offset]; offset += 1
        if size == 0:
            break
        if size > 63 or offset + size > len(packet) or len(labels) > 20:
            raise ValueError("Nombre DNS inválido")
        labels.append(packet[offset:offset + size].decode("ascii", "strict").lower()); offset += size
    if not labels or offset + 4 > len(packet):
        raise ValueError("Pregunta DNS incompleta")
    kind, cls = struct.unpack("!HH", packet[offset:offset + 4])
    return ident, flags, ".".join(labels), labels, kind, cls, packet[12:offset + 4]


class DnsPolicy:
    def __init__(self, domains=None, rate=40, log=None):
        self.domains = domains or ["dlp.test"]
        self.rate, self.log = rate, log
        self.requests = defaultdict(deque)
        self.lock = threading.Lock()

    def decide(self, source, name, labels):
        now = time.monotonic()
        with self.lock:
            for key in list(self.requests):
                if not self.requests[key] or self.requests[key][-1] < now - 60:
                    del self.requests[key]
            if len(self.requests) > 1000 and source not in self.requests:
                return False, "CAPACITY"
            values = self.requests[source]
            while values and values[0] < now - 60:
                values.popleft()
            if len(values) <= self.rate:
                values.append(now)
            if len(values) > self.rate:
                return False, "DNS_FREQUENCY"
        if any(len(label) > 40 for label in labels):
            return False, "DNS_LONG_LABEL"
        if not any(name == domain or name.endswith("." + domain) for domain in self.domains):
            return False, "DNS_UNAUTHORIZED_DOMAIN"
        return True, "DNS_ALLOWED"

    def record(self, source, name, allowed, cause):
        event = {"channel": "dns", "activity": "DNS_QUERY_POLICY", "srcip": source, "decision": "PERMITIDO" if allowed else "BLOQUEADO", "prevented": not allowed, "cause": cause, "nameHash": hashlib.sha256(name.encode()).hexdigest(), "evidence": "DNS_RESOLVER_REQUEST_NOT_FORWARDED" if not allowed else "DNS_RESOLVER_FORWARD", "timestamp": time.time()}
        if self.log:
            with self.lock:
                with Path(self.log).open("a", encoding="utf-8") as stream:
                    stream.write(json.dumps(event) + "\n")


def create_server(host, port, policy, upstream=("127.0.0.1", 5353)):
    class Handler(socketserver.BaseRequestHandler):
        def handle(self):
            packet, output = self.request
            try:
                ident, flags, name, labels, kind, cls, raw_question = question(packet)
                allowed, cause = policy.decide(self.client_address[0], name, labels)
                if kind not in (1, 28) or cls != 1:
                    allowed, cause = False, "DNS_QUERY_TYPE"
                policy.record(self.client_address[0], name, allowed, cause)
                if not allowed:
                    output.sendto(struct.pack("!6H", ident, 0x8000 | (flags & 0x100) | 5, 1, 0, 0, 0) + raw_question, self.client_address)
                    return
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as remote:
                    remote.settimeout(2)
                    remote.connect(upstream)
                    remote.send(packet)
                    reply = remote.recv(4096)
                    if reply[:2] != packet[:2]:
                        raise ValueError("Respuesta DNS sin correspondencia")
                    output.sendto(reply, self.client_address)
            except (ValueError, UnicodeError, OSError):
                if len(packet) >= 2:
                    output.sendto(packet[:2] + struct.pack("!5H", 0x8002, 0, 0, 0, 0), self.client_address)

    class Server(socketserver.ThreadingUDPServer):
        daemon_threads = True
    return Server((host, port), Handler)


if __name__ == "__main__":
    log = os.environ.get("DLP_DNS_LOG", "")
    if log:
        Path(log).parent.mkdir(parents=True, exist_ok=True)
    policy = DnsPolicy(os.environ.get("DLP_DNS_DOMAINS", "dlp.test").split(","), int(os.environ.get("DLP_DNS_RATE", "40")), log or None)
    server = create_server(os.environ.get("DLP_DNS_BIND", "127.0.0.1"), int(os.environ.get("DLP_DNS_PORT", "5300")), policy, (os.environ.get("DLP_DNS_UPSTREAM", "127.0.0.1"), int(os.environ.get("DLP_DNS_UPSTREAM_PORT", "5353"))))
    print("DNS DLP de laboratorio iniciado", flush=True)
    server.serve_forever()
