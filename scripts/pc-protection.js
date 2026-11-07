"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { parseEnv } = require("node:util");
const { spawn, execFileSync } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const ROOT = path.resolve(__dirname, "..");
function locations(root = ROOT) {
  const directory = path.join(root, "datos-endpoint", "captura-pc");
  return { directory, profile: path.join(directory, "perfil.json"), credentials: path.join(directory, "credenciales.json"), manager: path.join(directory, "coordinador.json"), stop: path.join(directory, "detener.json"), status: path.join(directory, "estado.json") };
}
function save(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); const temporary = file + "." + crypto.randomUUID() + ".tmp"; fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(temporary, file); }
function environment(root) { const file = path.join(root, ".env"); return fs.existsSync(file) ? parseEnv(fs.readFileSync(file, "utf8")) : {}; }
function controlURL(value) {
  const url = new URL(value || "http://127.0.0.1:3100");
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || !["http:", "https:"].includes(url.protocol)) throw new Error("Dirección central inválida.");
  return url.origin;
}
const CASES = [
  ["CU-01", "USB", "CONTROL_DEL_CANAL_SEPARADO", "System-Controls.ps1; bloqueo general de escritura. No hay minifilter selectivo."],
  ["CU-02", "Copia local no autorizada", "DETECCION_POSTERIOR", "CopyMonitor correlaciona archivos después de copiar; no impide toda copia nativa."],
  ["CU-03", "Correo con adjunto", "FILTRO_SMTP_EXISTENTE", "Solo correo que llega al filtro. Captura local no implementa SMTP/STARTTLS transparente."],
  ["CU-04", "Correo en cuerpo", "FILTRO_SMTP_EXISTENTE", "El filtro MIME inspecciona el correo mediado; otras rutas requieren validación."],
  ["CU-05", "Subida HTTPS", "FILTRO_IMPLEMENTADO_CAPTURA_NATIVA_PENDIENTE", "Retener petición completa; reglas/Groq y recibo. Requiere CA confiable y tráfico capturado."],
  ["CU-06", "Texto a web", "FILTRO_IMPLEMENTADO_CAPTURA_NATIVA_PENDIENTE", "Cuerpo, consulta y ruta; no demuestra ausencia de canales encubiertos en cabeceras."],
  ["CU-07", "rclone", "WEBDAV_MEDIADO_EXISTENTE", "Otros backends requieren prueba; TCP no HTTP capturado se restringe como canal."],
  ["CU-08", "SFTP/SCP", "RESTRICCION_CANAL_CAPTURADO", "No lee SSH cifrado. No se acredita bloqueo si el tráfico elude la captura."],
  ["CU-09", "FTP", "RESTRICCION_CANAL_CAPTURADO", "No se ofrece clasificación transparente de FTP; Suricata sigue siendo detección separada."],
  ["CU-10", "DNS", "RESTRICCION_DNS_CAPTURADO", "El piloto deniega DNS capturado; resolución normal de toda la PC todavía pendiente."],
  ["CU-11", "Archivo cifrado", "RETENCION_POR_NO_INSPECCION", "No inspeccionable en el canal HTTP; no significa que se haya descifrado."],
  ["CU-12", "Evasión de formato", "MOTOR_EXISTENTE", "Firma real, base64 y límites. Sin cobertura garantizada de cualquier transformación."],
].map(([id, name, state, limitation]) => ({ id, name, state, limitation }));
function prepare(options = {}) {
  const root = options.root || ROOT, p = locations(root), env = environment(root);
  if (fs.existsSync(p.profile)) return { prepared: true, preservedExistingProfile: true, captureActivated: false, profile: p.profile };
  const value = { schemaVersion: 1, purpose: "WINDOWS_LOCAL_CAPTURE_PILOT", host: options.hostname || os.hostname(), controlUrl: controlURL(env.DLP_CONTROL_URL), deviceName: "PC-" + (options.hostname || os.hostname()), mode: "PREPARED_NOT_ACTIVE", defaultScope: "SINGLE_PID", allAppsReady: false, externalProcessingAcknowledged: false, failClosedOnProcessExit: false, nativeFileMinifilter: false, cases: CASES };
  save(p.profile, value);
  return { prepared: true, captureActivated: false, certificateInstalled: false, firewallChanged: false, profile: p.profile, allAppsReady: false };
}
function active(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== "ESRCH"; } }
function plan(options = {}) {
  const root = options.root || ROOT, p = locations(root);
  const profile = fs.existsSync(p.profile) ? JSON.parse(fs.readFileSync(p.profile, "utf8")) : null;
  let manager, status;
  try { manager = JSON.parse(fs.readFileSync(p.manager, "utf8")); } catch {}
  try { status = JSON.parse(fs.readFileSync(p.status, "utf8")); } catch {}
  const coordinatorRunning = Boolean(manager && Number.isInteger(manager.pid) && manager.pid > 0 && active(manager.pid));
  const fresh = coordinatorRunning && status?.session === manager.nonce && Number.isFinite(status.updatedAt) && Date.now() / 1000 - status.updatedAt < 30 && Date.now() / 1000 >= status.updatedAt;
  const result = { prepared: Boolean(profile), coordinatorRunning, captureState: coordinatorRunning ? fresh ? status.state : "STARTING_OR_STALE_NOT_VERIFIED" : "NOT_ACTIVE", allAppsReady: false, universalProtection: false, failClosedOnProcessExit: false, nativeCaptureValidated: false, cases: CASES, missing: ["Prueba nativa del redirector en Windows", "Kill switch independiente del proceso de captura", "DNS de uso diario y validación por protocolo", "Minifilter para copias/lecturas nativas selectivas", "Pruebas de cada aplicación, reinicio y evasiones", "Evaluación FP/FN con corpus etiquetado"] };
  if ((options.platform || process.platform) === "win32") {
    const execute = options.execute || ((file, args) => execFileSync(file, args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }));
    try { result.windows = JSON.parse(execute("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "endpoint/windows/Capture-Readiness.ps1"), "-ProjectDirectory", root]).replace(/^\uFEFF/, "")); }
    catch { result.windows = { readiness: "UNAVAILABLE", driverStarted: false }; }
  }
  return result;
}
async function credentials(root, profile) {
  const p = locations(root), env = environment(root);
  let result;
  if (fs.existsSync(p.credentials)) result = JSON.parse(fs.readFileSync(p.credentials, "utf8"));
  else if (env.DLP_DEVICE_ID && env.DLP_INSPECT_TOKEN && env.DLP_TELEMETRY_TOKEN) result = { deviceId: env.DLP_DEVICE_ID, inspectToken: env.DLP_INSPECT_TOKEN, telemetryToken: env.DLP_TELEMETRY_TOKEN };
  else {
    if (!env.DLP_CONTROL_ADMIN_TOKEN) throw new Error("Falta inscripción individual para esta PC.");
    const created = await fetch(profile.controlUrl + "/v1/admin/devices", { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", "X-DLP-Token": env.DLP_CONTROL_ADMIN_TOKEN }, body: JSON.stringify({ name: profile.deviceName, platform: "win32", serverUrl: profile.controlUrl }), signal: AbortSignal.timeout(10000) });
    if (!created.ok) throw new Error("El central no permite preparar la identidad PC.");
    const { invitation } = await created.json();
    const enrolled = await fetch(profile.controlUrl + "/v1/enroll", { method: "POST", redirect: "error", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...invitation, hostname: os.hostname(), platform: "win32", version: "3.0.0" }), signal: AbortSignal.timeout(10000) });
    if (!enrolled.ok) throw new Error("No se completó la inscripción PC; no se activó la captura.");
    result = await enrolled.json();
  }
  if (!/^[a-f0-9-]{36}$/.test(result.deviceId || "") || ![result.inspectToken, result.telemetryToken].every(t => /^[a-f0-9]{64}$/.test(t || ""))) throw new Error("Identidad PC no válida.");
  save(p.credentials, result); return result;
}
function childEnvironment(identity, profile, p, inherited = process.env) {
  const env = Object.fromEntries(Object.entries(inherited).filter(([k]) => !/^(DLP_|GROQ_|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$|NO_PROXY$)/i.test(k) && !/TOKEN|PASSWORD|API_KEY|SECRET/i.test(k)));
  return { ...env, DLP_CONTROL_URL: profile.controlUrl, DLP_ALLOW_LAB_HTTP: new URL(profile.controlUrl).protocol === "http:" ? "1" : "0", DLP_DEVICE_ID: identity.deviceId, DLP_INSPECT_TOKEN: identity.inspectToken, DLP_TELEMETRY_TOKEN: identity.telemetryToken, DLP_PC_CAPTURE_ACK: "1", DLP_PC_CAPTURE_STATUS: p.status, DLP_CONNECTOR_LOG: path.join(p.directory, "recibos-locales.jsonl") };
}
async function start(args, options = {}) {
  // Se rechaza antes de escribir, inscribir o abrir un driver.
  if (args.includes("--all-apps")) throw new Error("ALL_PC_NOT_VALIDATED: falta validar DNS, kill switch y controles nativos. Solo está preparado el piloto por PID.");
  const pidAt = args.indexOf("--pid"), target = Number(args[pidAt + 1]);
  if (!args.includes("--ack-data-processing") || pidAt < 0 || !Number.isInteger(target) || target <= 0 || args.length !== 3) throw new Error("Para un piloto futuro: pc:start -- --pid PID --ack-data-processing. Puede enviar contenido real a Groq.");
  if ((options.platform || process.platform) !== "win32") throw new Error("Este piloto nativo requiere Windows.");
  const root = options.root || ROOT, p = locations(root), readiness = plan({ root, ...options });
  if (!readiness.prepared || !readiness.windows?.administrator || readiness.windows.binaries?.length !== 3 || readiness.windows.binaries.some(b => !b.present || b.signature !== "Valid")) throw new Error("Se requiere perfil preparado, administrador y binarios con firma válida. No se inició la captura.");
  const profile = JSON.parse(fs.readFileSync(p.profile, "utf8"));
  if (profile.host !== os.hostname() || profile.purpose !== "WINDOWS_LOCAL_CAPTURE_PILOT") throw new Error("Perfil de otra PC o versión incompatible.");
  if (!active(target) || target === process.pid) throw new Error("PID objetivo no válido.");
  if (fs.existsSync(p.manager)) throw new Error("Ya hay un coordinador o registro pendiente. Revisa pc:status antes de continuar.");
  const python = path.join(root, ".venv/Scripts/python.exe");
  if (!fs.existsSync(python)) throw new Error("Falta el entorno Python de filtros.");
  const identity = await credentials(root, profile), nonce = crypto.randomBytes(24).toString("hex");
  const response = await fetch(profile.controlUrl + "/v1/config", { redirect: "error", headers: { "X-DLP-Token": identity.inspectToken }, signal: AbortSignal.timeout(10000) });
  const config = response.ok ? await response.json() : null;
  if (!config?.capabilities?.pcCaptureEnforce || config.individualDevice?.id !== identity.deviceId) throw new Error("Actualiza el central: no acredita inspección PC obligatoria con identidad individual. No se abrió el driver.");
  save(p.manager, { pid: process.pid, nonce, startedAt: new Date().toISOString() });
  const env = childEnvironment(identity, profile, p); env.DLP_PC_CAPTURE_SCOPE = "SINGLE_PID:" + target; env.DLP_PC_CAPTURE_SESSION = nonce;
  let child, stopping = false, exited = false; const stop = () => { stopping = true; };
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
  try {
    child = spawn(python, ["-c", "from mitmproxy.tools.main import mitmdump; mitmdump()", "--mode", "local:" + target, "--set", "confdir=" + path.join(p.directory, "ca-private"), "--set", "connection_strategy=lazy", "--set", "body_size_limit=12m", "--set", "rawtcp=false", "-s", path.join(root, "integrations/pc_capture.py"), "-q"], { cwd: root, env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    child.stderr.on("data", () => console.error("El capturador escribió un diagnóstico; consulta pc:status. No se imprime tráfico ni credenciales."));
    child.once("error", () => { exited = true; }); child.once("exit", () => { exited = true; });
    console.log("Piloto solicitado para un PID. No acredita captura activa hasta pc:status. Al detenerse no hay kill switch; la red normal puede continuar.");
    while (!stopping && !exited) {
      try { if (JSON.parse(fs.readFileSync(p.stop, "utf8")).nonce === nonce) stopping = true; } catch {}
      await delay(500);
    }
    if (exited && !stopping) throw new Error("El capturador finalizó; no se acredita protección activa. Consulta pc:status.");
  } finally {
    if (child?.pid && !exited && child.exitCode === null) { const own = child; await new Promise(r => { own.once("exit", r); own.kill(); }); }
    for (const signal of ["SIGINT", "SIGTERM"]) process.removeListener(signal, stop);
    try { if (JSON.parse(fs.readFileSync(p.manager, "utf8")).nonce === nonce) fs.unlinkSync(p.manager); } catch {}
    try { if (JSON.parse(fs.readFileSync(p.stop, "utf8")).nonce === nonce) fs.unlinkSync(p.stop); } catch {}
  }
}
async function stop(root = ROOT) {
  const p = locations(root); if (!fs.existsSync(p.manager)) return { stopped: true, alreadyStopped: true };
  const manager = JSON.parse(fs.readFileSync(p.manager, "utf8"));
  if (!Number.isInteger(manager.pid) || !active(manager.pid)) throw new Error("Registro de coordinador pendiente; no se finalizaron procesos ajenos.");
  save(p.stop, { nonce: manager.nonce });
  for (let i = 0; i < 40; i++) { if (!fs.existsSync(p.manager)) return { stopped: true }; await delay(250); }
  throw new Error("No se confirmó la parada; no se mataron procesos por PID.");
}
async function main(args = process.argv.slice(2)) {
  const action = args[0] || "plan";
  if (action === "start") return start(args.slice(1));
  if (args.length > 1) throw new Error("Argumentos no admitidos.");
  if (action === "prepare") console.log(JSON.stringify(prepare(), null, 2));
  else if (["plan", "status"].includes(action)) console.log(JSON.stringify(plan(), null, 2));
  else if (action === "stop") console.log(JSON.stringify(await stop(), null, 2));
  else throw new Error("Acción no admitida.");
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { prepare, plan, start, stop, locations, childEnvironment, CASES };
