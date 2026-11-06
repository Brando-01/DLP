"use strict";
// Proyección compartida: el central nunca conserva objetos libres del cliente.
const text = (v, n = 160) => typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]/g, "").slice(0, n) : "";
function sensorReport(input) {
  if (!input || typeof input !== "object") return null;
  const process = input.process || {}, browser = input.browser || {}, inventory = input.inventory || {};
  const count = v => Number.isInteger(v) && v >= 0 ? Math.min(v, 1000000) : 0;
  const processes = Array.isArray(process.processes) ? process.processes.slice(0, 50).filter(p => p && Number.isInteger(p.processId) && p.processId > 0 && typeof p.program === "string").map(p => ({ processId: p.processId, program: text(p.program) })) : [];
  return {
    process: { available: process.available === true, scope: text(process.scope, 40), intervalMs: count(process.intervalMs), sampledAt: text(process.sampledAt, 40), count: count(process.count), truncated: process.truncated === true, droppedEvents: count(process.droppedEvents), processes },
    browser: { activeClients: count(browser.activeClients), navigationClients: count(browser.navigationClients) },
    inventory: { roots: count(inventory.roots), files: count(inventory.files), semanticEnabled: inventory.semanticEnabled === true },
    inspectionBackend: ["central", "local"].includes(input.inspectionBackend) ? input.inspectionBackend : "unknown",
    universalInterception: false,
  };
}
module.exports = { sensorReport };
