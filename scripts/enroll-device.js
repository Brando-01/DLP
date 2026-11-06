"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { parseEnv } = require("node:util");
const { ROOT } = require("../lib/environment");
const { writeJsonAtomic } = require("../endpoint/config");

async function enrollDevice(invitation, options = {}) {
  const root = options.root || ROOT, platform = options.platform || process.platform;
  if (invitation.schemaVersion !== 1 || !/^[a-f0-9-]{36}$/.test(invitation.deviceId || "") || !/^[a-f0-9]{64}$/.test(invitation.token || "")) throw new Error("Archivo de invitación inválido.");
  const url = new URL(invitation.serverUrl);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || !["http:", "https:"].includes(url.protocol)) throw new Error("Dirección central inválida.");
  if (url.protocol === "http:" && invitation.allowLabHttp !== true) throw new Error("HTTP no autorizado por la invitación de laboratorio.");
  if (Date.parse(invitation.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(invitation.expiresAt))) throw new Error("La invitación ha caducado. Crea una nueva desde el central.");
  const file = path.join(root, ".env"), temp = file + ".inscripcion.tmp";
  if (fs.existsSync(temp)) throw new Error("Existe una escritura de inscripción pendiente; revisa el archivo temporal antes de reintentar.");
  const prior = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const values = prior ? parseEnv(prior) : {};
  // Comprobar permiso de escritura antes de consumir la invitación de un solo uso.
  fs.writeFileSync(temp, "", { flag: "wx", mode: 0o600 });
  try {
    const response = await (options.fetch || fetch)(url.origin + "/v1/enroll", { method: "POST", redirect: "error", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: invitation.deviceId, token: invitation.token, platform, hostname: options.hostname || os.hostname(), version: "3.0.0" }), signal: AbortSignal.timeout(10000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`El central rechazó la inscripción (HTTP ${response.status}). Revisa caducidad, plataforma y si ya se utilizó.`); }
    const result = await response.json();
    if (result.deviceId !== invitation.deviceId || ![result.inspectToken, result.telemetryToken].every(v => /^[a-f0-9]{64}$/.test(v || "")) || result.inspectToken === result.telemetryToken) throw new Error("Respuesta de inscripción inválida; no se guardó.");
    Object.assign(values, { DLP_DEVICE_ID: result.deviceId, DLP_DEVICE_LABEL: result.name, DLP_CONTROL_URL: url.origin, DLP_INSPECTION_BACKEND: "central", DLP_CONTROL_EMBEDDED: "0", DLP_LLM_MODE: "off", DLP_FORWARD_EVENTS: "1", DLP_INSPECT_TOKEN: result.inspectToken, DLP_TELEMETRY_TOKEN: result.telemetryToken, DLP_ALLOW_LAB_HTTP: url.protocol === "http:" ? "1" : "0" });
    // Nunca instalar la clave del proveedor ni el ADMIN del servidor en un cliente.
    delete values.GROQ_API_KEY; delete values.DLP_CONTROL_ADMIN_TOKEN;
    if (prior) writeJsonAtomic(path.join(root, "datos-endpoint", "instalacion", "entorno-anterior-" + Date.now() + "-" + crypto.randomUUID() + ".json"), { content: prior });
    fs.writeFileSync(temp, Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(String(value))}`).join("\n") + "\n", { mode: 0o600 });
    fs.renameSync(temp, file);
    return { deviceId: result.deviceId, name: result.name, serverUrl: url.origin };
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
async function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== "--invitation") throw new Error("Uso: node scripts/enroll-device.js --invitation RUTA_AL_JSON_PRIVADO");
  const invitation = JSON.parse(fs.readFileSync(path.resolve(args[1]), "utf8").replace(/^\uFEFF/, ""));
  const result = await enrollDevice(invitation);
  console.log(`Equipo inscrito: ${result.name} (${result.deviceId}). Central: ${result.serverUrl}. Reinicia el agente para cargar su identidad. No se imprimieron credenciales.`);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { enrollDevice };
