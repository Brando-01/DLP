"use strict";
const http = require("node:http");
const net = require("node:net");

// Relay explícito en loopback. No descifra TLS: el proxy central retiene e inspecciona.
class StrictRelay {
  constructor(options = {}) {
    this.enabled = options.enabled ?? process.env.DLP_STRICT_LAB === "1";
    this.gateway = options.gateway || process.env.DLP_STRICT_GATEWAY;
    this.token = options.token || process.env.DLP_INSPECT_TOKEN;
    this.deviceId = options.deviceId || process.env.DLP_DEVICE_ID;
    this.port = options.port ?? 3002; this.proxyPort = options.proxyPort || 8081;
    this.record = options.record || (() => {}); this.sockets = new Set();
    this.info = { enabled: this.enabled, available: false, port: this.port, scope: "LAB_SINK_ONLY" };
  }
  async start() {
    if (!this.enabled || this.server) return;
    if (net.isIP(this.gateway) !== 4 || !/^[a-f0-9]{64}$/.test(this.token || "") || !/^[a-f0-9-]{36}$/.test(this.deviceId || "")) throw new Error("Relay estricto: falta configuración individual.");
    const reject = (socket, status = 403) => socket.end(`HTTP/1.1 ${status} DLP retenido\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
    this.server = http.createServer((_req, res) => { res.writeHead(403); res.end("DLP laboratorio: solo HTTPS al receptor autorizado."); });
    this.server.on("connection", socket => { this.sockets.add(socket); socket.on("close", () => this.sockets.delete(socket)); socket.setTimeout(120000, () => socket.destroy()); if (this.sockets.size > 32) socket.destroy(); });
    this.server.on("connect", (req, socket, head) => {
      if (req.url !== "sink.dlp.test:4201") {
        let destination;
        try { const url = new URL("https://" + req.url); if (!url.username && !url.password && url.host === req.url) destination = url.origin; } catch {}
        this.record({ channel: "strict_network", activity: "DESTINO_NO_AUTORIZADO", destination, decision: "BLOQUEADO", prevented: true, outcome: "CANCELLED_BY_LOCAL_RELAY", evidence: "LOCAL_RELAY_REPORT" });
        return reject(socket);
      }
      const upstream = net.connect({ host: this.gateway, port: this.proxyPort });
      this.sockets.add(upstream); upstream.once("close", () => this.sockets.delete(upstream));
      upstream.setTimeout(120000, () => upstream.destroy());
      socket.once("error", () => upstream.destroy()); socket.once("close", () => upstream.destroy());
      upstream.once("error", () => reject(socket, 503)); upstream.once("close", () => socket.destroy());
      upstream.once("connect", () => {
        const authorization = Buffer.from(`${this.deviceId}:${this.token}`).toString("base64");
        upstream.write(`CONNECT sink.dlp.test:4201 HTTP/1.1\r\nHost: sink.dlp.test:4201\r\nProxy-Authorization: Basic ${authorization}\r\n\r\n`);
      });
      let headers = Buffer.alloc(0);
      const read = chunk => {
        headers = Buffer.concat([headers, chunk]); const end = headers.indexOf("\r\n\r\n");
        if (headers.length > 16384) { upstream.destroy(); return reject(socket, 503); }
        if (end < 0) return;
        upstream.removeListener("data", read);
        if (!/^HTTP\/1\.[01] 200\b/.test(headers.toString("ascii", 0, end))) { reject(socket, 503); upstream.destroy(); return; }
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (headers.length > end + 4) socket.write(headers.subarray(end + 4));
        if (head.length) upstream.write(head);
        socket.pipe(upstream); upstream.pipe(socket);
      };
      upstream.on("data", read);
    });
    await new Promise((resolve, reject) => { this.server.once("error", reject); this.server.listen(this.port, "127.0.0.1", resolve); });
    this.info.available = true; this.info.port = this.server.address().port;
  }
  async stop() { this.info.available = false; for (const s of this.sockets) s.destroy(); if (this.server) await new Promise(r => this.server.close(r)); this.server = null; }
}
module.exports = { StrictRelay };
