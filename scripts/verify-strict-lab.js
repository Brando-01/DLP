"use strict";
require("../lib/environment");
const http = require("node:http");
const https = require("node:https");
const tls = require("node:tls");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("../lib/environment");
async function reachable(host, port) {
  return new Promise(resolve => { const socket = net.connect({ host, port }); let done = false; const finish = value => { if (done) return; done = true; socket.destroy(); resolve(value); }; socket.once("connect", () => finish(true)); socket.once("error", () => finish(false)); socket.setTimeout(2000, () => finish(false)); });
}
function requestViaRelay(buffer, ca, options = {}) {
  const agent = new https.Agent();
  agent.createConnection = (_opts, done) => {
    const connect = http.request({ host: "127.0.0.1", port: options.port || 3002, method: "CONNECT", path: "sink.dlp.test:4201" });
    connect.setTimeout(5000, () => connect.destroy(new Error("Relay sin respuesta")));
    connect.once("error", done);
    connect.once("connect", (response, socket, head) => {
      if (response.statusCode !== 200) { socket.destroy(); return done(new Error("Túnel retenido por DLP")); }
      if (head.length) socket.unshift(head);
      socket.setTimeout(0);
      const secured = tls.connect({ socket, servername: "sink.dlp.test", ca });
      secured.once("error", done); secured.once("secureConnect", () => { secured.removeListener("error", done); done(null, secured); });
    });
    connect.end();
  };
  return new Promise((resolve, reject) => {
    const request = https.request("https://sink.dlp.test:4201/upload", { agent, method: "POST", headers: { "Content-Type": options.type || "text/plain", "X-DLP-File-Name": options.name || "prueba.txt", "Content-Length": buffer.length } }, response => {
      let size = 0; response.on("data", b => { size += b.length; if (size > 65536) response.destroy(); });
      response.once("end", () => resolve(response.statusCode)); response.once("error", reject);
    });
    request.setTimeout(65000, () => request.destroy(new Error("Inspección sin respuesta"))); request.once("error", reject); request.end(buffer);
  }).finally(() => agent.destroy());
}
async function main() {
  if (process.env.DLP_STRICT_LAB !== "1" || !process.env.DLP_DEVICE_ID) throw new Error("Ejecuta esta prueba en la VM inscrita y preparada para modo estricto.");
  const policy = JSON.parse(fs.readFileSync(path.join(ROOT, "datos-endpoint/strict-lab-policy.json")));
  const ca = fs.readFileSync(policy.caCertificate);
  const results = [];
  for (const port of [8080, 2525]) results.push({ test: `Canal alternativo ${port} cerrado`, passed: !await reachable(policy.gateway, port), evidence: "TCP_NEW_CONNECTION" });
  for (const port of [3100, 8081]) results.push({ test: `Conector ${port} disponible`, passed: await reachable(policy.gateway, port), evidence: "TCP_NEW_CONNECTION" });
  for (const [name, data, expected, type] of [["publico.txt", Buffer.from("Horario público de biblioteca"), 200, "text/plain"], ["sensible.txt", Buffer.from("DNI: 12345678"), 403, "text/plain"], ["vacio.txt", Buffer.alloc(0), 200, "text/plain"], ["opaco.bin", Buffer.from([0, 255, 0, 128]), 403, "application/octet-stream"]]) {
    try { const status = await requestViaRelay(data, ca, { name, type }); results.push({ test: name, expected, status, passed: status === expected, evidence: "HTTPS_THROUGH_LOCAL_RELAY_AND_STRICT_PROXY" }); }
    catch { results.push({ test: name, passed: false, evidence: "TRANSFER_INCOMPLETE" }); }
  }
  const report = { generatedAt: new Date().toISOString(), deviceId: process.env.DLP_DEVICE_ID, passed: results.every(r => r.passed), results, limitation: "Comprueba también recibos del receptor, auditoría de configuración, reinicio y aplicaciones reales. No acredita cobertura universal ni canales físicos." };
  fs.writeFileSync(path.join(ROOT, "datos-endpoint/strict-verification.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 1;
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { requestViaRelay, reachable };
