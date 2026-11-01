"use strict";
require("../lib/environment");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);
const { setTimeout: delay } = require("node:timers/promises");
const { ROOT } = require("../lib/environment");
const { startEndpoint } = require("../endpoint/server");
const { createDemoSite } = require("../endpoint/demo-site");
const { createReceiver } = require("../endpoint/receiver");
const { auditProtection, protectionDirectory, protectionStatus } = require("../endpoint/protection");
const { loggedCommand } = require("./logged-command");

async function available(port) {
  if (port === 0) return;
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`Puerto ${port} ocupado. Cierra el agente/demo anterior desde su terminal; no se detendrán otros procesos automáticamente.`)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}
async function listen(app, port) {
  const server = app.listen(port, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  return server;
}
async function wslAction(action, root = ROOT, signal, log = console.log) {
  const secrets = Object.entries(process.env).filter(([key]) => /TOKEN|PASSWORD|API_KEY|SECRET/i.test(key)).map(([, value]) => value);
  await loggedCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "deploy/wsl/Lab-WSL.ps1"), "-Action", action], { cwd: root, signal, log, secrets, label: `WSL ${action}`, timeout: action === "Stop" ? 30000 : 45 * 60 * 1000 });
}
async function centralStatus() {
  const url = new URL(process.env.DLP_CONTROL_URL || "http://127.0.0.1:3100");
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || !["http:", "https:"].includes(url.protocol)) throw new Error("Dirección central inválida");
  if (url.protocol === "http:" && !["127.0.0.1", "localhost"].includes(url.hostname) && process.env.DLP_ALLOW_LAB_HTTP !== "1") throw new Error("El control remoto requiere TLS o una red de laboratorio explícita");
  const response = await fetch(url.origin + "/v1/config", { redirect: "error", headers: { "X-DLP-Token": process.env.DLP_INSPECT_TOKEN || "" }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error("El central no acepta las credenciales de esta instalación; sincroniza el .env correcto."); }
  const status = await response.json();
  if (!Number.isInteger(status.maxBytes)) throw new Error("Respuesta central no válida");
  return { url: url.origin, inspectorReady: true };
}
async function defaultBackend(root, log, signal) {
  const local = ["127.0.0.1", "localhost"].includes(new URL(process.env.DLP_CONTROL_URL || "http://127.0.0.1:3100").hostname);
  if (!local) return { ...await centralStatus(), stop: async () => {} };
  if (process.platform !== "win32") throw new Error("Este arranque local usa Windows + DLP-Control-WSL. Para otro equipo configura un control remoto.");
  let prior = false;
  try { await centralStatus(); prior = true; } catch {}
  try {
    log("Preparando el backend WSL: sincronización, construcción y arranque de proxy, SMTP, DNS y sensores de red. Puede tardar varios minutos.");
    await wslAction("Sync", root, signal, log);
    await wslAction("ExportCA", root, signal, log);
    const status = await centralStatus();
    const pending = new Set([8080, 2525]);
    const deadline = Date.now() + 60000;
    while (pending.size && Date.now() < deadline) {
      signal?.throwIfAborted();
      for (const port of pending) {
        const ready = await new Promise(resolve => {
          const socket = net.createConnection({ host: "127.0.0.1", port });
          let settled = false;
          const finish = ok => { if (!settled) { settled = true; socket.destroy(); resolve(ok); } };
          socket.once("connect", () => finish(true)); socket.once("error", () => finish(false)); socket.setTimeout(1000, () => finish(false));
        });
        if (ready) pending.delete(port);
      }
      if (pending.size) await delay(500, undefined, { signal });
    }
    if (pending.size) throw new Error("No están accesibles los conectores locales: " + [...pending].join(", "));
    return { ...status, stop: async () => { if (!prior) await wslAction("Stop", root, undefined, log); } };
  } catch (error) {
    if (!prior) { try { await wslAction("Stop", root, undefined, log); } catch {} }
    throw new Error(`No se pudo preparar el backend WSL. ${String(error.message).slice(0, 1800)}`);
  }
}
async function runAll(options = {}) {
  const root = options.root || ROOT, log = options.log || console.log;
  const signal = options.signal;
  signal?.throwIfAborted();
  const ports = { agent: 3001, site: 4200, receiver: 4100, ...options.ports };
  for (const port of Object.values(ports)) await available(port);
  // Solo lectura. Ningún camino del lanzador aplica firewall, CA o USB.
  const readProtection = options.readProtection || (async () => {
    try { return await auditProtection(protectionDirectory()); }
    catch { return protectionStatus(protectionDirectory()); }
  });
  const protection = await readProtection();
  if (options.requireSystemControls && !protection.configurationVerified) throw new Error("PROTECCIÓN INCOMPLETA: no hay un perfil de salida exclusiva verificado. No se iniciaron servicios. Revisa Protection.ps1 Plan y la guía de activación; requiere gateway separado y prueba aislada.");
  if (options.prepare) await options.prepare();
  else {
    await require("./setup").setup(root);
    const prepared = require("node:util").parseEnv(fs.readFileSync(path.join(root, ".env"), "utf8"));
    const automatic = new Set(["DLP_CONTROL_ADMIN_TOKEN", "DLP_INSPECT_TOKEN", "DLP_TELEMETRY_TOKEN", "DLP_LAB_PASSWORD", "DLP_WAZUH_ENROLLMENT_PASSWORD"]);
    for (const [key, value] of Object.entries(prepared)) if (process.env[key] === undefined || automatic.has(key) && process.env[key] === "") process.env[key] = value;
    if (process.env.DLP_INSPECTION_BACKEND !== "central") throw new Error("El arranque integrado requiere DLP_INSPECTION_BACKEND=central en .env. La demo queda en npm start -- --demo.");
    await execute(process.execPath, [path.join(root, "extension/build.js")], { cwd: root, windowsHide: true, signal, timeout: 30000 });
  }
  let backend, endpoint, siteServer, receiverServer, stopping;
  const stop = () => stopping ||= (async () => {
    const operations = [];
    if (siteServer) operations.push(new Promise(r => { siteServer.close(r); siteServer.closeAllConnections(); }));
    if (receiverServer) operations.push(new Promise(r => { receiverServer.close(r); receiverServer.closeAllConnections(); }));
    if (endpoint) operations.push(endpoint.stop());
    await Promise.allSettled(operations);
    await backend?.stop();
  })();
  try {
    signal?.throwIfAborted();
    backend = await (options.startBackend || defaultBackend)(root, log, signal);
    signal?.throwIfAborted();
    siteServer = await listen(createDemoSite(path.join(root, "laboratorio/sitio-independiente")).app, ports.site);
    signal?.throwIfAborted();
    receiverServer = await listen(createReceiver(path.join(root, "laboratorio/receptor-http")).app, ports.receiver);
    signal?.throwIfAborted();
    endpoint = await (options.startEndpoint || startEndpoint)({ port: ports.agent, dataDirectory: path.join(root, "datos-endpoint") });
    signal?.throwIfAborted();
    endpoint.runtime.session = { mode: "INTEGRATED", centralUrl: backend.url, siteUrl: `http://127.0.0.1:${siteServer.address().port}`, receiverUrl: `http://127.0.0.1:${receiverServer.address().port}/upload`, systemConfigurationVerified: protection.configurationVerified, nativeSensitiveOnly: false, startedAt: new Date().toISOString() };
    endpoint.runtime.once("exit-request", () => stop().catch(e => log(e.message)));
    log(`DLP integrado: http://127.0.0.1:${endpoint.server.address().port} · central ${backend.url} · prueba web ${endpoint.runtime.session.siteUrl}`);
    log(protection.configurationVerified ? "Perfil de red configurado: valida su efecto real. No hay filtrado selectivo universal de aplicaciones nativas." : protection.nativeApplications?.configurationVerified ? "COBERTURA INCOMPLETA: hay reglas nativas comprobadas para EXE/paquetes, pero falta probar su efecto. Los navegadores sin extensión ni proxy obligatorio conservan salida." : "COBERTURA INCOMPLETA: WhatsApp/Discord y navegadores sin extensión o proxy obligatorio pueden enviar sin inspección. No hay restricciones del sistema verificadas.");
    log("Ctrl+C cierra los servicios locales y el backend iniciado aquí. No cambia restricciones de Windows ni las restaura.");
    return { endpoint, siteServer, receiverServer, backend, stop };
  } catch (error) { await stop(); throw error; }
}
async function main(args = process.argv.slice(2), options = {}) {
  if (args.some(a => !["--demo", "--require-system-controls"].includes(a)) || args.includes("--demo") && args.includes("--require-system-controls")) throw new Error("Opciones: npm start; npm start -- --demo; npm start -- --require-system-controls");
  if (args.includes("--demo")) { await require("./setup").setup(ROOT); options.signal?.throwIfAborted(); return require("./demo").startDemo(); }
  return runAll({ ...options, requireSystemControls: args.includes("--require-system-controls") });
}
module.exports = { runAll, main, centralStatus };
