"use strict";
require("../lib/environment");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const express = require("express");
const { ROOT } = require("../lib/environment");
const { CentralAudit } = require("./audit");
const { inspectBuffer } = require("../lib/inspection");
const { semanticClassifier } = require("../lib/semantic");
const { CASES, defaults, validatePolicy, destinationDecision, combine } = require("./policy");
const { writeJsonAtomic } = require("../endpoint/config");
const safeEqual = (a, b) => typeof a === "string" && typeof b === "string" && b.length >= 32 && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
function credentialsFromEnv() { return { admin: process.env.DLP_CONTROL_ADMIN_TOKEN, inspect: process.env.DLP_INSPECT_TOKEN, telemetry: process.env.DLP_TELEMETRY_TOKEN }; }
function safeDestination(value) {
  try { const url = new URL(value); return url.origin; } catch { return "correo / sistema local"; }
}
function createControl(options = {}) {
  const directory = options.directory || path.join(ROOT, "datos-control");
  const audit = options.audit || new CentralAudit(directory);
  const credentials = options.credentials || credentialsFromEnv();
  if (Object.values(credentials).length !== 3 || Object.values(credentials).some((t) => typeof t !== "string" || !/^[a-f0-9]{64}$/.test(t)) || new Set(Object.values(credentials)).size !== 3) throw new Error("Ejecuta npm.cmd run setup para generar credenciales centrales separadas");
  const policyFile = path.join(directory, "politica.json");
  let policy = fs.existsSync(policyFile) ? validatePolicy(JSON.parse(fs.readFileSync(policyFile, "utf8"))) : defaults();
  const inspect = options.inspect || ((buffer, name) => inspectBuffer(buffer, name, { semantic: true }));
  const tickets = new Map(), agents = new Map(), receipts = new Map(), telemetryIds = new Map();
  let concurrent = 0, windowAt = Date.now(), requests = new Map();
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (req.headers.origin && req.headers.origin !== `${req.secure ? "https" : "http"}://${req.headers.host}`) return res.status(403).json({ error: "Origen no autorizado" });
    next();
  });
  app.get("/healthz", (_req, res) => res.json({ service: "Control DLP", version: "3.0.0", ready: true }));
  app.use("/v1", (req, res, next) => {
    const permission = req.path.startsWith("/admin/") ? "admin" : req.path.startsWith("/telemetry") ? "telemetry" : "inspect";
    if (!safeEqual(req.headers["x-dlp-token"], credentials[permission])) return res.status(401).json({ error: "Credencial no válida para esta función" });
    if (Date.now() - windowAt > 60000) { requests = new Map(); windowAt = Date.now(); }
    const count = (requests.get(permission) || 0) + 1; requests.set(permission, count);
    if (count > 600) return res.status(429).json({ error: "Límite del control central" });
    next();
  });
  app.use(express.json({ limit: "16mb" }));
  app.get("/v1/config", (_req, res) => res.json({ blockedDomains: policy.blockedDomains, fragmentMode: policy.fragmentMode, maxBytes: 10 * 1024 * 1024 }));
  app.post("/v1/inspect", async (req, res) => {
    if (concurrent >= 2) return res.status(429).json({ error: "Inspecciones ocupadas; retener y reintentar" });
    concurrent += 1;
    try {
      const input = req.body;
      if (!input || !["web_proxy", "mail", "sync", "browser_file", "browser_paste", "browser_drop", "usb", "network_share", "clipboard", "print", "http_transfer"].includes(input.channel) || typeof input.destination !== "string" || input.destination.length > 2048 || !Array.isArray(input.parts) || input.parts.length > 20) throw new Error("Solicitud de inspección inválida");
      let total = 0;
      const parts = input.parts.map((part) => {
        if (!part || typeof part.name !== "string" || part.name.length > 200 || typeof part.base64 !== "string" || part.base64.length > 14 * 1024 * 1024 || part.base64.length % 4 || !/^[a-z0-9+/]*={0,2}$/i.test(part.base64)) throw new Error("Parte de documento no válida");
        const buffer = Buffer.from(part.base64, "base64"); total += buffer.length;
        if (total > 10 * 1024 * 1024) throw new Error("Carga superior a 10 MiB");
        return { name: path.basename(part.name), buffer };
      });
      const destination = destinationDecision(input, policy);
      const inspections = [];
      if (!destination) for (const part of parts) inspections.push({ file: part.name, ...await inspect(part.buffer, part.name) });
      const decision = destination || combine(inspections, input.channel, policy);
      const ticket = crypto.randomUUID();
      const event = { channel: input.channel, activity: "DECISION_PREVIA", device: String(input.device || "gateway").slice(0, 100), destination: safeDestination(input.destination), decision: decision.decision, cause: decision.cause, detected: decision.detected, prevented: null, evidence: "GATEWAY_POLICY_DECISION", files: inspections.map(({ file, sha256, classification, inspectionStatus, semantic, score, matches, formatMismatch }) => ({ file, sha256, classification, inspectionStatus, semanticStatus: semantic?.status, score, rules: matches.map((m) => m.id), formatMismatch })), ticket };
      audit.record(event);
      tickets.set(ticket, { event, allowed: decision.allowed, expires: Date.now() + 120000 });
      for (const [key, value] of tickets) if (value.expires < Date.now() || tickets.size > 2000) tickets.delete(key);
      res.json({ ...decision, ticket, inspections, noInspection: decision.cause === "NO_INSPECCIONABLE" });
    } finally { concurrent -= 1; }
  });
  app.post("/v1/receipts", (req, res) => {
    const { ticket, outcome, status } = req.body || {};
    const pending = tickets.get(ticket);
    if (!pending || pending.expires < Date.now() || !["CANCELLED", "RELEASED", "UPSTREAM_RESPONSE", "FAILED"].includes(outcome)) throw new Error("Recibo ausente, caducado o no válido");
    if (pending.allowed && outcome === "CANCELLED" || !pending.allowed && ["RELEASED", "UPSTREAM_RESPONSE"].includes(outcome)) throw new Error("Recibo incompatible con la decisión");
    if (status !== undefined && (!Number.isInteger(status) || status < 100 || status > 599)) throw new Error("Estado inválido");
    const event = audit.record({ ...pending.event, activity: "RESULTADO_GATEWAY", prevented: !pending.allowed && outcome === "CANCELLED", outcome, upstreamStatus: status, evidence: "AUTHENTICATED_CONNECTOR_RECEIPT" });
    tickets.delete(ticket); receipts.set(ticket, event); while (receipts.size > 2000) receipts.delete(receipts.keys().next().value);
    res.json({ recorded: true });
  });
  app.post("/v1/telemetry", (req, res) => {
    const input = req.body;
    if (!input || typeof input.device !== "string" || input.device.length > 100 || !Array.isArray(input.events) || input.events.length > 100) throw new Error("Telemetría inválida");
    agents.set(input.device, { device: input.device, lastSeen: new Date().toISOString(), coverage: String(input.coverage || "OBSERVACION").slice(0, 100) });
    while (agents.size > 1000) agents.delete(agents.keys().next().value);
    let accepted = 0;
    for (const item of input.events) {
      if (!item || typeof item !== "object") continue;
      const identity = item.id ? `${input.device}:${String(item.id).slice(0, 64)}` : null;
      if (identity && telemetryIds.has(identity)) continue;
      // Proyección explícita: nunca persistir texto libre, claves o el cuerpo de un evento arbitrario.
      const clean = { channel: "endpoint_telemetry", activity: String(item.activity || "OBSERVED").slice(0, 60), device: input.device, sourceEventId: String(item.id || "").slice(0, 64), sourceTime: String(item.timestamp || "").slice(0, 40), file: String(item.file || "").slice(0, 160), classification: String(item.classification || "NO_DETERMINADA").slice(0, 30), decision: ["PERMITIDO", "DETECTADO", "ALERTA", "BLOQUEADO", "ERROR", "NO_ANALIZABLE"].includes(item.decision) ? item.decision : "DETECTADO", prevented: false, reportedPrevented: item.prevented === true, evidence: "AGENT_REPORT_NOT_INDEPENDENT_PROOF", outcome: String(item.outcome || "OBSERVED").slice(0, 40) };
      for (const key of ["program", "destinationAddress", "destinationPort"]) if (typeof item[key] === "string") clean[key] = item[key].slice(0, key === "program" ? 250 : 80);
      if (Number.isInteger(item.ruleId) && item.ruleId >= 100000 && item.ruleId < 120000) clean.ruleId = item.ruleId;
      if (typeof item.channel === "string") clean.sourceChannel = item.channel.slice(0, 60);
      audit.record(clean);
      accepted += 1;
      if (identity) telemetryIds.set(identity, Date.now());
      while (telemetryIds.size > 10000) telemetryIds.delete(telemetryIds.keys().next().value);
    }
    res.json({ accepted });
  });
  app.get("/v1/admin/status", (_req, res) => res.json({ version: "3.0.0", classifier: semanticClassifier.status(), cases: CASES, agents: [...agents.values()], events: audit.recent(300), audit: audit.status(), policy, pendingDecisions: tickets.size }));
  app.put("/v1/admin/policy", (req, res) => { policy = validatePolicy(req.body); writeJsonAtomic(policyFile, policy); audit.record({ channel: "control", activity: "POLITICA_ACTUALIZADA", prevented: false, decision: "DETECTADO", evidence: "ADMIN_ACTION" }); res.json(policy); });
  app.use(express.static(path.join(__dirname, "ui")));
  app.use((error, _req, res, _next) => res.status(error.type === "entity.too.large" ? 413 : 400).json({ error: error.type === "entity.too.large" ? "Carga superior al límite" : String(error.message).slice(0, 150) }));
  return { app, audit, agents, tickets, receipts };
}
async function startControl(options = {}) {
  const control = createControl(options);
  const host = options.host || process.env.DLP_CONTROL_HOST || "127.0.0.1";
  let server;
  if (process.env.DLP_TLS_CERT && process.env.DLP_TLS_KEY) server = https.createServer({ cert: fs.readFileSync(process.env.DLP_TLS_CERT), key: fs.readFileSync(process.env.DLP_TLS_KEY) }, control.app);
  else {
    if (!["127.0.0.1", "localhost"].includes(host) && process.env.DLP_ALLOW_LAB_HTTP !== "1") throw new Error("Para publicar el control usa TLS o DLP_ALLOW_LAB_HTTP=1 exclusivamente en red aislada de datos ficticios");
    server = http.createServer(control.app);
  }
  server.requestTimeout = 60000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(options.port ?? Number(process.env.DLP_CONTROL_PORT || 3100), host, resolve); });
  return { ...control, server, stop: () => new Promise((resolve) => { server.close(resolve); server.closeIdleConnections(); }) };
}
if (require.main === module) startControl().then(({ server, stop }) => { console.log(`Control DLP en puerto ${server.address().port}; usa el token administrativo local de .env`); for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, stop); }).catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { createControl, startControl };
