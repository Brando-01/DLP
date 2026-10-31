"use strict";
const { protectionStatus, auditProtection, protectionDirectory } = require("./protection");

const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const express = require("express");
const { EndpointRuntime } = require("./runtime");
const { PROJECT } = require("./config");

const tokenMatches = (actual, expected) => typeof actual === "string" && Buffer.byteLength(actual) === Buffer.byteLength(expected) && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
const extensionOrigin = (origin) => /^chrome-extension:\/\/[a-p]{32}$/.test(origin || "") || /^moz-extension:\/\/[a-z0-9-]{20,60}$/i.test(origin || "");

function createEndpointApp(runtime) {
  const app = express();
  app.disable("x-powered-by");
  let concurrent = 0;
  let rateWindow = Date.now(), requests = 0;
  app.use((req, res, next) => {
    const host = req.headers.host || "";
    if (!/^(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(host)) return res.status(403).json({ error: "El agente solo acepta nombres locales explícitos" });
    const origin = req.headers.origin;
    const ownOrigin = `http://${host}`;
    const browserRoute = req.path.startsWith("/api/browser/");
    if (origin && origin !== ownOrigin) {
      if (!browserRoute || !extensionOrigin(origin)) return res.status(403).json({ error: "Origen no autorizado" });
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-DLP-Token");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (req.method === "OPTIONS") return browserRoute ? res.sendStatus(204) : res.sendStatus(403);
    next();
  });
  app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "Agente DLP local", version: "3.0.0" }));
  app.get("/api/bootstrap", (req, res) => {
    if (req.headers["sec-fetch-site"] === "cross-site" || extensionOrigin(req.headers.origin)) return res.sendStatus(403);
    res.json({ token: runtime.credentials.admin, version: "3.0.0" });
  });
  app.use("/api", (req, res, next) => {
    const isBrowser = req.path.startsWith("/browser/");
    if (!tokenMatches(req.headers["x-dlp-token"], isBrowser ? runtime.credentials.browser : runtime.credentials.admin)) return res.status(401).json({ error: "Token local no válido" });
    if (Date.now() - rateWindow > 60000) { rateWindow = Date.now(); requests = 0; }
    if (++requests > 300) return res.status(429).json({ error: "Límite de solicitudes; vuelve a intentarlo en un minuto" });
    next();
  });
  app.use(express.json({ limit: "15mb" }));
  app.get("/api/status", (_req, res) => res.json(runtime.status()));
  app.get("/api/protection", (_req, res) => res.json(protectionStatus(protectionDirectory())));
  let protectionAuditing = false;
  app.post("/api/protection/audit", async (_req, res) => {
    if (protectionAuditing) return res.status(429).json({ error: "Auditoría en curso" });
    protectionAuditing = true;
    try { res.json(await auditProtection(protectionDirectory())); }
    finally { protectionAuditing = false; }
  });
  app.get("/api/config", (_req, res) => res.json(runtime.config));
  app.put("/api/config", async (req, res) => res.json(await runtime.updateConfig(req.body)));
  app.get("/api/files", (_req, res) => res.json([...runtime.inventory.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))));
  app.get("/api/events", (_req, res) => res.json(runtime.audit.recent(300)));
  app.get("/api/live", (_req, res) => res.json({ serverTime: new Date().toISOString(), browserClients: runtime.browserObserver.status(), windows: runtime.bridge.info, watchRoots: runtime.config.watchRoots, events: runtime.audit.recent(120) }));
  app.get("/api/audit/integrity", (_req, res) => res.json(runtime.audit.status()));
  app.get("/api/events.csv", (_req, res) => {
    const columns = ["timestamp", "channel", "activity", "file", "classification", "decision", "outcome", "prevented", "evidence"];
    const cell = (value) => { let text = String(value ?? ""); if (/^[=+@-]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; };
    const csv = [columns.map(cell).join(","), ...runtime.audit.events.map((event) => columns.map((key) => cell(event[key])).join(","))].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="eventos-dlp.csv"');
    res.send("\uFEFF" + csv);
  });
  app.get("/api/pairing", (_req, res) => res.json({ browserToken: runtime.credentials.browser, agentUrl: "http://127.0.0.1:3001", instruction: "Introduce este token en las opciones del complemento. No lo publiques ni lo subas al repositorio." }));
  app.get("/api/report", (_req, res) => {
    const file = path.join(PROJECT, "output", "pdf", "Informe_DLP_Administrado_v3.pdf");
    if (!fs.existsSync(file)) return res.status(404).json({ error: "El informe administrado todavía no está generado" });
    res.download(file);
  });
  app.post("/api/scan", (_req, res) => {
    runtime.scan(true).catch((error) => runtime.operationalError("ESCANEO_MANUAL", error));
    res.status(202).json({ started: true });
  });
  app.post("/api/shutdown", (_req, res) => { res.json({ stopping: true }); setImmediate(() => runtime.emit("exit-request")); });
  const inspectLimit = (fn) => async (req, res, next) => {
    if (concurrent >= 2) return res.status(429).json({ error: "Hay dos documentos en análisis; vuelve a intentarlo" });
    concurrent += 1;
    try { await fn(req, res); } catch (error) { next(error); } finally { concurrent -= 1; }
  };
  app.post("/api/transfer", inspectLimit(async (req, res) => {
    const result = await runtime.transfer(req.body || {});
    res.status(result.outcome === "PREVENTED" ? 403 : result.outcome === "FAILED" ? 422 : 200).json(result);
  }));
  app.get("/api/browser/config", (_req, res) => res.json(runtime.browserConfig()));
  app.post("/api/browser/heartbeat", (req, res) => res.json(runtime.browserObserver.heartbeat(req.body)));
  app.post("/api/browser/navigation", (req, res) => res.json(runtime.browserObserver.navigation(req.body)));
  app.post("/api/browser/inspect", inspectLimit(async (req, res) => res.json(await runtime.inspectBrowser(req.body || {}))));
  app.post("/api/browser/result", async (req, res) => res.json(await runtime.completeBrowser(req.body || {})));
  app.use(express.static(path.join(__dirname, "ui"), { etag: false, maxAge: 0 }));
  app.use((error, _req, res, _next) => {
    const status = error.type === "entity.too.large" ? 413 : 400;
    res.status(status).json({ error: status === 413 ? "Solicitud demasiado grande" : String(error.message || "Solicitud no válida").slice(0, 180) });
  });
  return app;
}

async function startEndpoint(options = {}) {
  const runtime = options.runtime || new EndpointRuntime(options);
  const app = createEndpointApp(runtime);
  const server = http.createServer(app);
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  const port = options.port ?? Number(process.env.DLP_AGENT_PORT || 3001);
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  let stopping;
  const stop = () => {
    if (!stopping) stopping = (async () => { await runtime.stop(); await new Promise((resolve) => server.close(() => resolve())); })();
    return stopping;
  };
  runtime.once("exit-request", () => stop().catch(() => {}));
  runtime.start().catch((error) => runtime.operationalError("ARRANQUE", error));
  return { app, runtime, server, stop };
}

if (require.main === module) {
  startEndpoint().then((service) => {
    console.log(`Agente DLP: http://127.0.0.1:${service.server.address().port}`);
    console.log("Protección según carpetas y canales configurados. Estado y cobertura en el panel.");
    let stopping = false;
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { if (stopping) return; stopping = true; await service.stop(); });
  }).catch((error) => { console.error(`No se inició el agente: ${error.message}`); process.exitCode = 1; });
}

module.exports = { createEndpointApp, startEndpoint, tokenMatches };
