"use strict";
require("./environment");
const os = require("node:os");
const crypto = require("node:crypto");
const { inspectBuffer } = require("./inspection");
function centralURL() {
  const value = new URL(process.env.DLP_CONTROL_URL || "http://127.0.0.1:3100");
  if (value.username || value.password || value.pathname !== "/" || value.search || value.hash || !["http:", "https:"].includes(value.protocol) || value.protocol === "http:" && !["127.0.0.1", "localhost"].includes(value.hostname) && process.env.DLP_ALLOW_LAB_HTTP !== "1") throw new Error("Dirección del clasificador central no válida");
  return value.origin;
}
async function managedInspection(buffer, name, channel, destination) {
  if (process.env.DLP_INSPECTION_BACKEND !== "central") return inspectBuffer(buffer, name, { semantic: true });
  try {
    const response = await fetch(`${centralURL()}/v1/inspect`, { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", "X-DLP-Token": process.env.DLP_INSPECT_TOKEN || "" }, body: JSON.stringify({ channel, destination: destination || `endpoint://${channel}`, device: os.hostname(), parts: [{ name, base64: buffer.toString("base64") }] }), signal: AbortSignal.timeout(55000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(); }
    const result = await response.json();
    if (result.allowed === false && typeof result.ticket === "string" && !result.inspections?.length && ["DESTINATION", "NO_INSPECCIONABLE"].includes(result.cause)) return { inspectionStatus: "UNANALYZABLE", classification: "NO_ANALIZABLE", score: 0, matches: [], reason: result.reason, centralPolicy: { allowed: false, decision: result.decision, reason: result.reason }, centralTicket: result.ticket };
    const inspection = result.inspections?.[0];
    if (!inspection || typeof result.allowed !== "boolean" || typeof result.ticket !== "string" || !Array.isArray(inspection.matches) || !["COMPLETE", "PARTIAL", "UNANALYZABLE"].includes(inspection.inspectionStatus) || !Number.isInteger(inspection.score) || inspection.score < 0 || inspection.sha256 !== crypto.createHash("sha256").update(buffer).digest("hex")) throw new Error();
    return { ...inspection, centralPolicy: { allowed: result.allowed, decision: result.decision, reason: result.reason }, centralTicket: result.ticket };
  } catch {
    return { inspectionStatus: "UNANALYZABLE", classification: "NO_ANALIZABLE", score: 0, matches: [], semantic: { required: true, status: "CENTRAL_UNAVAILABLE" }, reason: "El clasificador central no está disponible; operación pendiente" };
  }
}
async function reportCentral(inspection, outcome) {
  if (!inspection.centralTicket) return true;
  try {
    const response = await fetch(`${centralURL()}/v1/receipts`, { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", "X-DLP-Token": process.env.DLP_INSPECT_TOKEN || "" }, body: JSON.stringify({ ticket: inspection.centralTicket, outcome }), signal: AbortSignal.timeout(5000) });
    await response.body?.cancel(); return response.ok;
  } catch { return false; }
}
module.exports = { managedInspection, reportCentral };
