"use strict";
process.env.DLP_LLM_MODE = "off";
process.env.DLP_FORWARD_EVENTS = "0";
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { startControl } = require("../control/server");
const { temporary, xlsxBuffer, docxBuffer } = require("../test/helpers/fixtures.cjs");
const { defaults } = require("../control/policy");
async function run() {
  const tmp = await temporary(); let control;
  const pcFilter = process.argv.includes("--pc-filter");
  const output = path.resolve(__dirname, pcFilter ? "../output/evaluacion/resultado-captura-pc-filtro.json" : "../output/evaluacion/resultado-red-administrada.json");
  const python = process.env.DLP_PYTHON || path.resolve(__dirname, process.platform === "win32" ? "../.venv/Scripts/python.exe" : "../.venv/bin/python");
  try {
    const fixtures = path.join(tmp.root, "muestras"); await fs.mkdir(fixtures);
    await fs.writeFile(path.join(fixtures, "publico.xlsx"), await xlsxBuffer([["curso", "aula"], ["Redes", 301]]));
    await fs.writeFile(path.join(fixtures, "privado.xlsx"), await xlsxBuffer([["DNI", "tarjeta"], ["12345678", "4111111111111111"]]));
    await fs.writeFile(path.join(fixtures, "renombrado.jpg"), await docxBuffer("DNI: 12345678"));
    await fs.writeFile(path.join(fixtures, "publico.txt"), "Horario público del laboratorio");
    await fs.writeFile(path.join(fixtures, "privado.txt"), "DNI: 12345678");
    const credentials = Object.fromEntries(["admin", "inspect", "telemetry"].map((key) => [key, crypto.randomBytes(32).toString("hex")]));
    const directory = path.join(tmp.root, "control"); await fs.mkdir(directory);
    if (pcFilter) {
      const policy = defaults(); policy.policies.web_proxy.mode = "audit";
      await fs.writeFile(path.join(directory, "politica.json"), JSON.stringify(policy));
    }
    control = await startControl({ directory, credentials, port: 0, host: "127.0.0.1" });
    const controlUrl = `http://127.0.0.1:${control.server.address().port}`;
    let identity;
    if (pcFilter) {
      const { invitation } = control.devices.invite({ name: "PC-FILTRO-FICTICIO", platform: "win32", serverUrl: controlUrl, allowLabHttp: true });
      identity = control.devices.enroll({ ...invitation, platform: "win32", hostname: "fixture", version: "3" });
    }
    await fs.mkdir(path.dirname(output), { recursive: true });
    const child = spawn(python, [path.resolve(__dirname, "managed-network.py")], { cwd: path.resolve(__dirname, ".."), windowsHide: true, stdio: "inherit", env: { ...process.env, DLP_CONTROL_URL: controlUrl, DLP_ALLOW_LAB_HTTP: "1", DLP_INSPECT_TOKEN: identity?.inspectToken || credentials.inspect, DLP_DEVICE_ID: identity?.deviceId || "fixture", DLP_TELEMETRY_TOKEN: identity?.telemetryToken || credentials.telemetry, DLP_PC_CAPTURE_ACK: pcFilter ? "1" : "0", DLP_E2E_PC_FILTER: pcFilter ? "1" : "0", DLP_PC_CAPTURE_STATUS: "", DLP_CONNECTOR_LOG: path.join(tmp.root, "recibos.jsonl"), DLP_E2E_FIXTURES: fixtures, DLP_E2E_OUTPUT: output, DLP_RCLONE: process.env.DLP_RCLONE || path.resolve(__dirname, "../tmp/tools/rclone-1.75.2/rclone-v1.75.2-windows-amd64/rclone.exe") } });
    await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Prueba de red finalizó con código ${code}`))); });
    if (!control.audit.status().chainValid) throw new Error("Cadena de auditoría inválida");
    console.log(pcFilter ? "Filtro PC verificado con proxy explícito temporal y datos ficticios. No se probó ni activó captura nativa/WinDivert. Resultado: output/evaluacion/resultado-captura-pc-filtro.json" : "Filtros HTTPS/SMTP verificados contra receptores independientes. Resultado: output/evaluacion/resultado-red-administrada.json");
  } finally { await control?.stop(); await tmp.cleanup(); }
}
if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
