"use strict";
process.env.DLP_LLM_MODE = "off"; process.env.GROQ_API_KEY = ""; process.env.DLP_FORWARD_EVENTS = "0";
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { temporary } = require("../test/helpers/fixtures.cjs");
const { startControl } = require("../control/server");
const { defaults } = require("../control/policy");
const { StrictRelay } = require("../endpoint/strict-relay");
async function run() {
  const tmp = await temporary(); let control, relay;
  try {
    const credentials = Object.fromEntries(["admin", "inspect", "telemetry"].map(k => [k, crypto.randomBytes(32).toString("hex")]));
    const policy = defaults(); policy.policies.web_proxy.mode = "audit";
    await fs.writeFile(path.join(tmp.root, "politica.json"), JSON.stringify(policy));
    control = await startControl({ directory: tmp.root, credentials, port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${control.server.address().port}`;
    const invite = control.devices.invite({ name: "VM-STRICT-TEST", platform: "linux", serverUrl: base, allowLabHttp: true });
    const identity = control.devices.enroll({ ...invite.invitation, hostname: "ficticio", platform: "linux", version: "3" });
    const socket = net.createServer(); socket.listen(0, "127.0.0.1"); await new Promise(r => socket.once("listening", r)); const proxyPort = socket.address().port; await new Promise(r => socket.close(r));
    relay = new StrictRelay({ enabled: true, gateway: "127.0.0.1", token: identity.inspectToken, deviceId: identity.deviceId, port: 0, proxyPort }); await relay.start();
    const python = process.env.DLP_PYTHON || path.resolve(process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
    const child = spawn(python, [path.resolve("evaluacion/strict-network.py")], { stdio: "inherit", windowsHide: true, env: { ...process.env, DLP_TEST_NODE: process.execPath, DLP_ALLOW_LAB_HTTP: "1", DLP_CONTROL_URL: base, DLP_INSPECT_TOKEN: credentials.inspect, DLP_TEST_ADMIN_TOKEN: credentials.admin, DLP_TEST_DEVICE: identity.deviceId, DLP_TEST_RELAY_PORT: String(relay.info.port), DLP_TEST_PROXY_PORT: String(proxyPort) } });
    await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error("Falló E2E estricto: " + code))); });
    const own = control.audit.events.filter(e => e.device === identity.deviceId);
    if (!own.some(e => e.prevented === true) || !own.some(e => e.decision === "PERMITIDO") || !control.audit.status().chainValid) throw new Error("Faltan recibos separados y auditoría íntegra");
    console.log("Identidad individual y recibos centrales verificados; sin instalar políticas en el anfitrión.");
  } finally { await relay?.stop(); await control?.stop(); await tmp.cleanup(); }
}
if (require.main === module) run().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { run };
