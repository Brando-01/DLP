import asyncio
import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from mitmproxy import exceptions
from integrations.pc_capture import PcCapture


class Client:
    async def inspect(self, channel, destination, parts, **metadata):
        self.received = (channel, destination, parts, metadata)
        return {"allowed": True, "ticket": "ficticio"}


class PcCaptureTests(unittest.TestCase):
    def test_no_activation_without_ack_and_rejects_tunnels(self):
        options = SimpleNamespace(stream_large_bodies=None, ignore_hosts=[], ssl_insecure=False, tcp_hosts=[], udp_hosts=[], connection_strategy="lazy")
        with patch("integrations.pc_capture.ctx.options", options, create=True), patch.dict(os.environ, {"DLP_PC_CAPTURE_ACK": "0"}):
            with self.assertRaises(exceptions.OptionsError):
                PcCapture(Client()).configure(set())
        options.ssl_insecure = True
        with patch("integrations.pc_capture.ctx.options", options, create=True), patch.dict(os.environ, {"DLP_PC_CAPTURE_ACK": "1"}):
            with self.assertRaises(exceptions.OptionsError):
                PcCapture(Client()).configure(set())

    def test_network_channels_are_denied_not_claimed_classified(self):
        capture = PcCapture(Client())
        for method in (capture.tcp_start, capture.udp_start, capture.dns_request):
            flow = SimpleNamespace(kill=lambda: None)
            with patch.object(flow, "kill") as kill, patch("integrations.pc_capture.record") as record:
                method(flow)
                kill.assert_called_once()
                self.assertEqual(record.call_args.args[2], "BLOCKED_CAPTURED_CHANNEL")

    def test_destination_redaction_and_individual_metadata(self):
        client = Client(); capture = PcCapture(client)
        flow = SimpleNamespace(request=SimpleNamespace(pretty_url="https://ficticio.test/ruta?dato=NO_AUDITAR"))
        with patch.dict(os.environ, {"DLP_DEVICE_ID": "PC-FICTICIA"}):
            asyncio.run(capture.decision(flow, [("ficticio.txt", b"publico")]))
        self.assertEqual(client.received[1], "https://ficticio.test/")
        self.assertTrue(client.received[3]["pcCapture"])

    def test_invalid_or_unavailable_central_retains_instead_of_forwarding(self):
        for config in ([], {"capabilities": None, "individualDevice": None}, {"capabilities": "invalid"}):
            client = SimpleNamespace(request=lambda route: config)
            flow = SimpleNamespace(response=None, request=SimpleNamespace(method="POST"))
            with patch("integrations.proxy_addon.record"):
                asyncio.run(PcCapture(client).request(flow))
            self.assertEqual(flow.response.status_code, 503)


if __name__ == "__main__":
    unittest.main()
