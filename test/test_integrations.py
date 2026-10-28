import asyncio
import gzip
import json
import socket
import struct
import threading
import unittest
from email.message import EmailMessage
from integrations.content import parse_mail, http_parts, bounded_body, MAX_BYTES
from integrations.dns_guard import DnsPolicy, create_server


class ContentTests(unittest.TestCase):
    def test_mime_decodes_body_and_attachment(self):
        message = EmailMessage(); message["Subject"] = "Asunto ficticio"; message.set_content("DNI: 12345678", cte="base64")
        message.add_attachment(b"ficticio", maintype="application", subtype="octet-stream", filename="ejemplo.txt")
        parts = parse_mail(message.as_bytes())
        self.assertTrue(any(b"DNI: 12345678" in value for _, value in parts))
        self.assertTrue(any(name == "ejemplo.txt" for name, _ in parts))

    def test_http_form_decodes_and_binary_stays_binary(self):
        parts = http_parts(b"dni=DNI%3A+12345678", "application/x-www-form-urlencoded")
        self.assertIn(b"DNI: 12345678", parts[0][1])
        self.assertEqual(http_parts(b"PK\x03\x04", "application/octet-stream")[0][0], "documento.bin")

    def test_limits_and_expansion(self):
        self.assertEqual(bounded_body(gzip.compress(b"DNI: 12345678"), "gzip"), b"DNI: 12345678")
        with self.assertRaises(ValueError):
            bounded_body(gzip.compress(b"x" * (MAX_BYTES + 1)), "gzip")
        with self.assertRaises(ValueError):
            bounded_body(b"contenido", "desconocido")
        with self.assertRaises(ValueError):
            http_parts(b"{}", "multipart/form-data")

    def test_dns_restricts_channel_and_frequency(self):
        policy = DnsPolicy(["dlp.test"], rate=3)
        self.assertTrue(policy.decide("pc", "sink.dlp.test", ["sink", "dlp", "test"])[0])
        self.assertFalse(policy.decide("pc", "externo.test", ["externo", "test"])[0])
        self.assertFalse(policy.decide("pc", "a" * 50 + ".dlp.test", ["a" * 50, "dlp", "test"])[0])
        self.assertEqual(policy.decide("pc", "sink.dlp.test", ["sink", "dlp", "test"])[1], "DNS_FREQUENCY")

    def test_dns_block_sends_refused_without_upstream(self):
        server = create_server("127.0.0.1", 0, DnsPolicy(["dlp.test"]), ("127.0.0.1", 9))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            name = b"\x07externo\x04test\x00"
            packet = struct.pack("!6H", 123, 0x100, 1, 0, 0, 0) + name + struct.pack("!HH", 1, 1)
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as client:
                client.settimeout(2); client.sendto(packet, server.server_address); reply = client.recv(1024)
            self.assertEqual(struct.unpack("!H", reply[2:4])[0] & 15, 5)
        finally:
            server.shutdown(); server.server_close()


if __name__ == "__main__":
    unittest.main()
