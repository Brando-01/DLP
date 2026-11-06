"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { parseEnv } = require("node:util");
const { ROOT } = require("../lib/environment");
const { enrollDevice } = require("./enroll-device");
async function installClient(file, options = {}) {
  const root = options.root || ROOT;
  if (!fs.existsSync(path.join(root, "node_modules/express"))) throw new Error("Ejecuta npm ci en el proyecto antes de instalar el cliente.");
  const invitation = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  if (invitation.schemaVersion !== 1 || !/^[a-f0-9-]{36}$/.test(invitation.deviceId || "")) throw new Error("Invitación inválida.");
  // No sustituir silenciosamente el agente manual que está usando el operador.
  const checkPort = options.checkPort || (async () => {
    try { const response = await fetch("http://127.0.0.1:3001/api/health", { signal: AbortSignal.timeout(1000) }); await response.body?.cancel(); return true; }
    catch (error) { return error.cause?.code !== "ECONNREFUSED"; }
  });
  if (await checkPort() && !fs.existsSync(path.join(root, "datos-endpoint/supervisor.json"))) throw new Error("Cierra con Ctrl+C el arranque manual de esta VM antes de instalar el inicio automático. No se consumió la invitación.");
  const configFile = path.join(root, ".env");
  const current = fs.existsSync(configFile) ? parseEnv(fs.readFileSync(configFile, "utf8")) : {};
  if (current.DLP_DEVICE_ID && current.DLP_DEVICE_ID !== invitation.deviceId) throw new Error("Este cliente ya tiene otra identidad; no se sustituye automáticamente.");
  const result = current.DLP_DEVICE_ID === invitation.deviceId ? { deviceId: current.DLP_DEVICE_ID, name: current.DLP_DEVICE_LABEL, alreadyEnrolled: true } : await enrollDevice(invitation, { ...options, root });
  const execute = options.execute || ((args) => execFileSync(process.execPath, args, { cwd: root, windowsHide: true, stdio: "inherit" }));
  execute([path.join(root, "scripts/client-autostart.js"), "install", "--start"]);
  return { ...result, automaticStartConfigured: true };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--invitation") { console.error("Uso: node scripts/install-client.js --invitation RUTA_AL_JSON_PRIVADO"); process.exitCode = 1; }
  else installClient(path.resolve(args[1])).then(result => console.log(`Cliente ${result.name || result.deviceId}: identidad individual e inicio automático configurados. Comprueba client:status y el reporte central.`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { installClient };
