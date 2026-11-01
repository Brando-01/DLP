"use strict";
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { StringDecoder } = require("node:string_decoder");
const execute = promisify(execFile);

// Muestra el avance sin publicar las credenciales de la instalación.
async function loggedCommand(command, args, options = {}) {
  const { log = console.log, label = "Proceso", heartbeatMs = 15000, secrets = [], ...execOptions } = options;
  const values = [...new Set(secrets.filter(v => typeof v === "string" && v.length >= 4))].sort((a, b) => b.length - a.length);
  const redact = value => values.reduce((text, secret) => text.split(secret).join("[OCULTO]"), value);
  const started = Date.now(); let last = "Esperando salida del proceso", tail = [];
  const pending = execute(command, args, { windowsHide: true, timeout: 45 * 60 * 1000, maxBuffer: 8 * 1024 * 1024, ...execOptions });
  const flushers = [];
  for (const stream of [pending.child.stdout, pending.child.stderr]) {
    const decoder = new StringDecoder("utf8"); let buffer = "";
    const emit = line => {
      const safe = redact(line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim());
      if (!safe) return;
      last = safe.slice(0, 500); tail.push(last); tail = tail.slice(-8);
      log(`[${label}] ${last}`);
    };
    stream.on("data", chunk => {
      buffer += decoder.write(chunk);
      const lines = buffer.split(/[\r\n]+/); buffer = lines.pop();
      for (const line of lines) emit(line);
      // Salidas sin salto de línea se conservan hasta el cierre, con memoria acotada.
      if (buffer.length > 65536) buffer = buffer.slice(-32768);
    });
    flushers.push(() => { buffer += decoder.end(); if (buffer) emit(buffer); buffer = ""; });
  }
  const heartbeat = setInterval(() => log(`[${label}] Sigue en ejecución (${Math.floor((Date.now() - started) / 1000)} s). Último avance: ${last}`), heartbeatMs);
  heartbeat.unref();
  try { await pending; }
  catch (error) {
    for (const flush of flushers) flush();
    if (execOptions.signal?.aborted) throw error;
    const reason = error.killed ? "Se alcanzó el tiempo límite" : `El proceso terminó con código ${error.code ?? "desconocido"}`;
    throw new Error(`${label}: ${reason}. ${tail.slice(-3).join(" | ")}`, { cause: error });
  } finally { clearInterval(heartbeat); for (const flush of flushers) flush(); }
}
module.exports = { loggedCommand };
