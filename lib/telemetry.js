"use strict";
require("./environment");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
function forwardAudit(audit, directory) {
  if (process.env.DLP_FORWARD_EVENTS !== "1") return () => {};
  const base = process.env.DLP_CONTROL_URL || "http://127.0.0.1:3100";
  const url = new URL(base);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || !["http:", "https:"].includes(url.protocol) || url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname) && process.env.DLP_ALLOW_LAB_HTTP !== "1") throw new Error("Control remoto de telemetría no válido");
  const cursorFile = path.join(directory, "telemetria-cursor.json");
  let cursor = 0, running = false;
  try { const saved = JSON.parse(fs.readFileSync(cursorFile)); cursor = Number.isInteger(saved.cursor) && saved.cursor <= audit.events.length ? saved.cursor : 0; } catch {}
  const tick = async () => {
    if (running) return; running = true;
    try {
      const events = audit.events.slice(cursor, cursor + 50).map((event) => ({ ...event, destination: event.channel === "browser_navigation" ? event.origin : undefined }));
      const response = await fetch(`${url.origin}/v1/telemetry`, { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", "X-DLP-Token": process.env.DLP_TELEMETRY_TOKEN || "" }, body: JSON.stringify({ device: os.hostname(), coverage: "Agente local; controles configurados y observación posterior", events: events.map(({ id, timestamp, channel, activity, file, classification, decision, prevented, outcome, program, destinationAddress, destinationPort, destination }) => ({ id, timestamp, channel, activity, file, classification, decision, prevented, outcome, program, destinationAddress, destinationPort, destination })) }), signal: AbortSignal.timeout(5000) });
      await response.body?.cancel();
      if (response.ok) { cursor += events.length; fs.writeFileSync(cursorFile, JSON.stringify({ cursor }), { mode: 0o600 }); }
    } catch {} finally { running = false; }
  };
  const timer = setInterval(tick, 10000); timer.unref(); tick();
  return () => clearInterval(timer);
}
module.exports = { forwardAudit };
