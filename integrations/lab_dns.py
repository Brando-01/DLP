"""DNS autoritativo ficticio para *.dlp.test, sin reenvio a Internet."""
import os
import socket
import socketserver
import struct
from integrations.dns_guard import question


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        data, output = self.request
        try:
            ident, flags, name, labels, kind, cls, raw = question(data)
            if not name.endswith(".dlp.test"):
                reply = struct.pack("!6H", ident, 0x8183, 1, 0, 0, 0) + raw
            elif kind == 1:
                address = socket.inet_aton(os.environ.get("DLP_LAB_DNS_ADDRESS", "127.0.0.1"))
                reply = struct.pack("!6H", ident, 0x8580, 1, 1, 0, 0) + raw + b"\xc0\x0c" + struct.pack("!HHIH", 1, 1, 60, 4) + address
            else:
                reply = struct.pack("!6H", ident, 0x8580, 1, 0, 0, 0) + raw
            output.sendto(reply, self.client_address)
        except (ValueError, UnicodeError, OSError):
            pass


if __name__ == "__main__":
    server = socketserver.ThreadingUDPServer((os.environ.get("DLP_DNS_BIND", "127.0.0.1"), int(os.environ.get("DLP_DNS_UPSTREAM_PORT", "5353"))), Handler)
    print("DNS ficticio del laboratorio iniciado", flush=True)
    server.serve_forever()
