"use strict";
require("../lib/environment");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { ROOT } = require("../lib/environment");

function paths(root) {
  const directory = path.join(root, "datos-endpoint");
  return { directory, lock: path.join(directory, "supervisor.json"), request: path.join(directory, "supervisor-detener.json"), log: path.join(directory, "supervisor.log") };
}
function active(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function requestStop(root = ROOT) {
  const p = paths(root); if (!fs.existsSync(p.lock)) return { stopped: true };
  const lock = JSON.parse(fs.readFileSync(p.lock, "utf8"));
  if (!active(lock.pid)) { fs.unlinkSync(p.lock); return { stopped: true }; }
  fs.writeFileSync(p.request, JSON.stringify({ nonce: lock.nonce }), { mode: 0o600 });
  for (let i = 0; i < 100; i++) { if (!fs.existsSync(p.lock)) return { stopped: true }; await delay(100); }
  throw new Error("El supervisor no terminó. No se finalizaron procesos ajenos; revisa supervisor.log.");
}
async function supervise(options = {}) {
  const root = options.root || ROOT, p = paths(root), interval = options.interval || 2000;
  fs.mkdirSync(p.directory, { recursive: true });
  if (fs.existsSync(p.lock)) {
    const prior = JSON.parse(fs.readFileSync(p.lock, "utf8"));
    if (active(prior.pid)) return { alreadyRunning: true };
    fs.unlinkSync(p.lock);
  }
  const nonce = crypto.randomBytes(24).toString("hex");
  fs.writeFileSync(p.lock, JSON.stringify({ pid: process.pid, nonce, mode: options.mode || "SUPERVISED", startedAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
  const log = text => {
    if (fs.existsSync(p.log) && fs.statSync(p.log).size > 1024 * 1024) fs.writeFileSync(p.log, "Registro anterior truncado por límite de tamaño.\n");
    fs.appendFileSync(p.log, new Date().toISOString() + " " + text + "\n", { mode: 0o600 });
  };
  let child, stopping = false, owned = false, failures = 0, nextStart = 0, healthRetries = 0;
  const stop = () => { stopping = true; };
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
  const port = options.port || Number(process.env.DLP_AGENT_PORT || 3001), base = `http://127.0.0.1:${port}`;
  const health = async () => { try { const r = await fetch(base + "/api/health", { signal: AbortSignal.timeout(1000) }); return r.ok ? await r.json() : { foreign: true }; } catch (error) {
    if (error.cause?.code === "ECONNREFUSED") return null;
    if (["ECONNRESET", "UND_ERR_SOCKET", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(error.cause?.code) || error.name === "TimeoutError") return { retry: true };
    return { foreign: true };
  } };
  const installation = () => {
    try { const credentials = JSON.parse(fs.readFileSync(path.join(p.directory, "credenciales.json"), "utf8")); return crypto.createHash("sha256").update(credentials.browser).digest("hex").slice(0, 32); } catch { return null; }
  };
  try {
    log("Supervisor iniciado; solo gestiona el agente de esta instalación.");
    while (!stopping) {
      if (fs.existsSync(p.request)) {
        try { if (JSON.parse(fs.readFileSync(p.request, "utf8")).nonce === nonce) { stopping = true; fs.unlinkSync(p.request); break; } } catch {}
      }
      const current = await health();
      // Un socket que se cierra durante el reinicio no prueba que el puerto sea ajeno.
      // Esperar sin lanzar ni cerrar procesos hasta obtener identidad o conexión rechazada.
      if (current?.retry) {
        if (++healthRetries > 5) throw new Error("No se pudo identificar el servicio del puerto tras cinco reintentos; no se gestionaron procesos ajenos.");
        await delay(interval); continue;
      }
      healthRetries = 0;
      if (current && (current.service !== "Agente DLP local" || !installation() || current.installationId !== installation())) throw new Error("El puerto está ocupado por otro agente o una versión anterior. Cierra su terminal antes de iniciar el supervisor.");
      if (!current && !child && Date.now() >= nextStart) {
        child = spawn(process.execPath, [options.entry || path.join(root, "endpoint/server.js")], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DLP_AGENT_PORT: String(port), DLP_AGENT_START_MODE: options.mode || "SUPERVISED" } });
        owned = true;
        child.stdout.on("data", bytes => log(String(bytes).trim().slice(0, 4000)));
        child.stderr.on("data", () => log("El agente escribió un diagnóstico. Para fallos de arranque ejecuta npm run client:diagnose. No se copia contenido sensible al registro del supervisor."));
        child.on("error", () => log("No se pudo ejecutar el agente."));
        child.on("exit", code => { child = null; failures += 1; nextStart = Date.now() + Math.min(60000, interval * failures); log(`Agente finalizado (${code}); reinicio supervisado pendiente.`); });
        log("Proceso del agente iniciado.");
      }
      if (current) failures = 0;
      await delay(interval);
    }
  } finally {
    if (owned && child) {
      const current = await health();
      if (current?.installationId === installation()) {
        try {
          const credentials = JSON.parse(fs.readFileSync(path.join(p.directory, "credenciales.json"), "utf8"));
          const r = await fetch(base + "/api/shutdown", { method: "POST", headers: { "X-DLP-Token": credentials.admin }, signal: AbortSignal.timeout(2000) }); await r.body?.cancel();
        } catch {}
      }
      for (let i = 0; i < 30 && child; i++) await delay(100);
      if (child) { const ownChild = child; if (ownChild.exitCode === null) await new Promise(resolve => { ownChild.once("exit", resolve); ownChild.kill(); }); }
    }
    for (const signal of ["SIGINT", "SIGTERM"]) process.removeListener(signal, stop);
    if (fs.existsSync(p.lock) && JSON.parse(fs.readFileSync(p.lock, "utf8")).nonce === nonce) fs.unlinkSync(p.lock);
    log("Supervisor detenido.");
  }
  return { stopped: true };
}
if (require.main === module) {
  const stop = process.argv.includes("--stop");
  const mode = process.argv.find(v => v.startsWith("--mode="))?.slice(7);
  (stop ? requestStop() : supervise({ mode })).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { supervise, requestStop, paths };
