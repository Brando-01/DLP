"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { PROJECT, loadState, validateConfig, writeJsonAtomic, isWithin, suggestedRoots } = require("./config");
const { AuditLog } = require("../lib/audit");
const { inspectBuffer, extractText, MAX_FILE_BYTES } = require("../lib/inspection");
const { analyzeContent, rules } = require("../lib/classifier");
const { decide } = require("../lib/policy");
const { WindowsBridge } = require("./windows-bridge");
const { semanticClassifier } = require("../lib/semantic");
const { forwardAudit } = require("../lib/telemetry");
const { CopyMonitor } = require("./copy-monitor");
const { managedInspection, reportCentral, classifyAtRest } = require("../lib/managed-inspection");
const { BrowserObserver } = require("./browser-observer");

const EXCLUDED = new Set(["node_modules", ".git", ".cache", "appdata", "windows", "program files", "program files (x86)", "datos-endpoint", "logs", "recibidos", "tmp", "$recycle.bin", "system volume information"]);
const fileId = (file) => crypto.createHash("sha256").update(process.platform === "win32" ? file.toLowerCase() : file).digest("hex").slice(0, 24);
const INSPECTABLE = new Set([".txt", ".csv", ".json", ".md", ".log", ".xml", ".yaml", ".yml", ".ini", ".conf", ".sql", ".js", ".ts", ".py", ".ps1", ".html", ".pdf", ".docx", ".xlsx"]);

class EndpointRuntime extends EventEmitter {
  constructor(options = {}) {
    super();
    this.dataDirectory = path.resolve(options.dataDirectory || process.env.DLP_ENDPOINT_DATA_DIR || path.join(PROJECT, "datos-endpoint"));
    const state = loadState(this.dataDirectory, options.config || {});
    this.config = state.config;
    this.credentials = state.credentials;
    this.configFile = state.file;
    this.audit = new AuditLog(this.dataDirectory);
    this.browserObserver = new BrowserObserver(this);
    this.inventory = new Map();
    this.watchers = [];
    this.tickets = new Map();
    this.scanState = { running: false, completedAt: null, examined: 0, skipped: 0, inaccessible: 0, capped: false, roots: [] };
    this.bridge = options.bridge || new WindowsBridge({ enabled: options.native !== false && process.env.DLP_DISABLE_NATIVE !== "1" });
    this.adapters = options.adapters || {};
    this.classifyAtRest = options.classifyAtRest || classifyAtRest;
    this.startedAt = null;
    this.stopping = false;
    this.lastNotification = 0;
    this.bridge.on("sensor", (message) => this.handleNative(message).catch((error) => this.operationalError("SENSOR", error)));
    let configured = false;
    this.bridge.on("status", () => {
      if (!configured) { configured = true; this.configureBridge(); }
    });
    this.bridge.on("diagnostic", (message) => this.operationalError("SENSOR", new Error(message)));
  }

  async start() {
    if (this.startedAt) return;
    this.startedAt = new Date().toISOString();
    const demoRoot = path.join(PROJECT, "laboratorio", "protegidos");
    if (this.config.watchRoots.includes(demoRoot)) {
      await fsp.mkdir(demoRoot, { recursive: true });
      const samples = {
        "publico.txt": "Horario público de atención. Biblioteca: lunes a viernes.\n",
        "alerta.txt": "Contacto ficticio: ana@universidad.edu.pe\n",
        "confidencial.json": '{"codigo_estudiante":"20261234","nota_final":18}\n',
        "identidad.txt": "Registro ficticio de prueba. DNI: 12345678\n",
        "sin_etiqueta.txt": "Estudiante ficticia: Rosa Pérez. Su calificación final fue 17 sobre 20.\n",
      };
      for (const [name, content] of Object.entries(samples)) {
        try { await fsp.writeFile(path.join(demoRoot, name), content, { flag: "wx" }); } catch (error) { if (error.code !== "EEXIST") throw error; }
      }
    }
    this.bridge.start();
    this.stopTelemetry = forwardAudit(this.audit, this.dataDirectory);
    this.installWatchers();
    await this.scan();
    this.copyMonitor = new CopyMonitor(this); this.copyMonitor.start();
    this.scanTimer = setInterval(() => this.scan().catch((e) => this.operationalError("ESCANEO", e)), this.config.scanIntervalSeconds * 1000);
    this.scanTimer.unref();
    this.audit.record({ channel: "agent", activity: "AGENTE_INICIADO", decision: "DETECTADO", prevented: false, detected: false, evidence: "PROCESS", watchRoots: this.config.watchRoots });
  }

  configureBridge() {
    if (!this.bridge.info.available) return;
    this.bridge.request("configure", { clipboardMonitor: this.config.clipboardMonitor, printingMonitor: true }).catch((e) => this.operationalError("CONFIGURAR_SENSOR", e));
  }

  operationalError(activity, error) {
    const message = String(error.message || error).slice(0, 180);
    try { this.audit.record({ channel: "agent", activity, decision: "ERROR", prevented: false, message, evidence: "OPERATIONAL_ERROR" }); } catch {}
    this.emit("operational-error", message);
  }

  ignore(file) {
    if (isWithin(file, this.dataDirectory)) return true;
    const root = this.config.watchRoots.filter((p) => isWithin(file, p)).sort((a, b) => b.length - a.length)[0];
    const relative = root ? path.relative(root, file) : file;
    return relative.split(/[\\/]/).some((piece) => EXCLUDED.has(piece.toLowerCase()));
  }

  installWatchers() {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    for (const root of this.config.watchRoots) {
      try {
        const watcher = fs.watch(root, { recursive: true }, (_type, name) => {
          if (name && this.ignore(path.join(root, String(name)))) return;
          clearTimeout(this.debounce);
          this.debounce = setTimeout(() => this.scan().catch((e) => this.operationalError("VIGILANCIA", e)), 700);
        });
        watcher.on("error", (error) => this.operationalError("VIGILANCIA", error));
        this.watchers.push(watcher);
      } catch (error) { this.operationalError("CARPETA_NO_VIGILADA", error); }
    }
  }

  async scan(force = false) {
    if (this.scanState.running || this.stopping) return this.scanState;
    this.scanState = { running: true, startedAt: new Date().toISOString(), completedAt: null, examined: 0, skipped: 0, inaccessible: 0, capped: false, roots: [] };
    const seen = new Set();
    let semanticBudget = this.config.semanticFilesPerScan;
    const semanticEnabled = this.config.inventorySemantic && process.env.DLP_LLM_MODE === "hybrid";
    const walk = async (directory) => {
      if (this.stopping || this.scanState.capped || this.ignore(directory)) return;
      let entries;
      try { entries = await fsp.readdir(directory, { withFileTypes: true }); }
      catch { this.scanState.inaccessible += 1; return; }
      for (const entry of entries) {
        if (this.stopping || this.scanState.capped) break;
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink() || this.ignore(file)) { this.scanState.skipped += 1; continue; }
        if (entry.isDirectory()) await walk(file);
        else if (entry.isFile()) {
          if (seen.size >= this.config.maxFiles) { this.scanState.capped = true; break; }
          const id = fileId(file);
          seen.add(id);
          try {
            const stat = await fsp.stat(file);
            const previous = this.inventory.get(id);
            const semanticPending = semanticEnabled && previous && previous.score < 3 && previous.inspectionStatus === "COMPLETE" && previous.semantic?.status !== "COMPLETE" && previous.semantic?.status !== "BYPASSED_LOCAL_BLOCK" && Date.now() >= (previous.semanticRetryAt || 0);
            if (!force && previous && previous.size === stat.size && previous.mtimeMs === stat.mtimeMs && !semanticPending && previous.inventorySemanticEnabled === semanticEnabled) continue;
            let inspection;
            if (stat.size > MAX_FILE_BYTES) inspection = { inspectionStatus: "UNANALYZABLE", classification: "NO_ANALIZABLE", score: 0, matches: [], reason: "Archivo superior a 10 MiB", size: stat.size, sha256: null };
            else {
              const snapshot = await this.readSnapshot(file);
              inspection = await inspectBuffer(snapshot.buffer, entry.name);
              if (semanticEnabled && inspection.inspectionStatus === "COMPLETE" && inspection.score < 3) {
                if (semanticBudget > 0) {
                  semanticBudget -= 1;
                  const semanticInspection = await this.classifyAtRest(snapshot.buffer, entry.name);
                  // Una respuesta pendiente nunca borra los indicadores de las reglas locales.
                  inspection = { ...inspection, ...semanticInspection };
                } else inspection.semantic = { required: true, status: "QUEUED" };
              }
            }
            if (inspection.semantic?.required && inspection.semantic.status !== "COMPLETE" && inspection.score === 0) inspection.classification = "PENDIENTE";
            const semanticRetryAt = inspection.semantic?.required && inspection.semantic.status !== "COMPLETE" && inspection.semantic.status !== "QUEUED" ? Date.now() + 15 * 60 * 1000 : 0;
            const item = { id, path: file, name: entry.name, ...inspection, inventorySemanticEnabled: semanticEnabled, semanticRetryAt, mtimeMs: stat.mtimeMs, scannedAt: new Date().toISOString() };
            this.inventory.set(id, item);
            this.scanState.examined += 1;
            if (!previous || previous.sha256 !== item.sha256 || previous.mtimeMs !== item.mtimeMs || previous.semantic?.status !== item.semantic?.status || previous.classification !== item.classification) {
              this.audit.record({ channel: "filesystem", activity: "CLASIFICAR_ARCHIVO", decision: inspection.score > 0 ? "DETECTADO" : inspection.inspectionStatus !== "COMPLETE" || inspection.semantic?.required && inspection.semantic.status !== "COMPLETE" ? "NO_ANALIZABLE" : "PERMITIDO", file: entry.name, sourcePath: file, classification: inspection.classification, score: inspection.score, matches: inspection.matches, inspectionStatus: inspection.inspectionStatus, semanticStatus: inspection.semantic?.status, detected: inspection.score > 0, prevented: false, evidence: "FILE_SENSOR", sha256: inspection.sha256 });
            }
          } catch { this.scanState.inaccessible += 1; }
        }
      }
    };
    try {
      for (const root of this.config.watchRoots) {
        const available = fs.existsSync(root);
        this.scanState.roots.push({ path: root, available });
        if (available) await walk(root);
      }
      if (!this.scanState.capped && this.scanState.inaccessible === 0) for (const id of this.inventory.keys()) if (!seen.has(id)) this.inventory.delete(id);
      writeJsonAtomic(path.join(this.dataDirectory, "inventario.json"), [...this.inventory.values()]);
    } finally { this.scanState.running = false; this.scanState.completedAt = new Date().toISOString(); }
    return this.scanState;
  }

  async readSnapshot(file, allowUnscoped = false) {
    const real = await fsp.realpath(file);
    if (!allowUnscoped) {
      let inScope = false;
      for (const root of this.config.watchRoots) {
        try { if (isWithin(real, await fsp.realpath(root))) { inScope = true; break; } } catch {}
      }
      if (!inScope) throw new Error("El archivo está fuera de las carpetas protegidas");
    }
    const stat = await fsp.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Se requiere un archivo regular, sin enlace simbólico");
    const handle = await fsp.open(real, "r");
    try {
      const meta = await handle.stat();
      if (!meta.isFile() || meta.size > MAX_FILE_BYTES) throw new Error("Archivo no admitido o superior a 10 MiB");
      const data = Buffer.alloc(Math.min(meta.size + 1, MAX_FILE_BYTES + 1));
      let offset = 0;
      while (offset < data.length) {
        const result = await handle.read(data, offset, data.length - offset, offset);
        if (!result.bytesRead) break;
        offset += result.bytesRead;
      }
      if (offset > meta.size || offset > MAX_FILE_BYTES) throw new Error("El archivo cambió durante su lectura");
      return { buffer: data.subarray(0, offset), path: real };
    } finally { await handle.close(); }
  }

  async updateConfig(input) {
    const config = validateConfig(input);
    writeJsonAtomic(this.configFile, config);
    this.config = config;
    this.copyMonitor?.stop();
    if (this.startedAt) { this.copyMonitor = new CopyMonitor(this); this.copyMonitor.start(); }
    this.installWatchers();
    this.configureBridge();
    clearInterval(this.scanTimer);
    if (this.startedAt) { this.scanTimer = setInterval(() => this.scan().catch((e) => this.operationalError("ESCANEO", e)), config.scanIntervalSeconds * 1000); this.scanTimer.unref(); }
    this.audit.record({ channel: "agent", activity: "CONFIGURACION_ACTUALIZADA", decision: "DETECTADO", detected: false, prevented: false, evidence: "ADMIN_ACTION" });
    return this.config;
  }

  browserConfig() {
    return { domains: this.config.browserDomains, failClosed: this.config.browserFailClosed, maxFileBytes: MAX_FILE_BYTES, coverage: "Interacciones manuales soportadas por el complemento; no cubre todas las APIs de carga ni aplicaciones ajenas al navegador." };
  }

  async inspectBrowser(input) {
    if (!["browser_file", "browser_paste", "browser_drop"].includes(input.channel)) throw new Error("Canal de navegador no válido");
    let buffer;
    const fileName = String(input.fileName || "portapapeles.txt").slice(0, 160);
    if (typeof input.base64 === "string") {
      if (input.base64.length > 14 * 1024 * 1024 || input.base64.length % 4 !== 0 || !/^[a-z0-9+/]*={0,2}$/i.test(input.base64)) throw new Error("Archivo codificado no válido");
      buffer = Buffer.from(input.base64, "base64");
    } else if (typeof input.text === "string" && input.text.length <= 1000000) buffer = Buffer.from(input.text, "utf8");
    else throw new Error("No se recibió contenido analizable");
    let origin = "desconocido";
    try { const url = new URL(input.url); if (!["http:", "https:"].includes(url.protocol)) throw new Error(); origin = url.origin; } catch { throw new Error("Origen web no válido"); }
    const inspection = await managedInspection(buffer, fileName, input.channel, origin);
    const policy = decide(inspection, input.channel, this.config.policies);
    const ticket = crypto.randomUUID();
    this.tickets.set(ticket, { expires: Date.now() + 120000, channel: input.channel, fileName, inspection, policy, origin });
    for (const [key, entry] of this.tickets) if (entry.expires < Date.now() || this.tickets.size > 1000) this.tickets.delete(key);
    this.audit.record({ channel: input.channel, activity: "DECIDIR_INTERACCION_WEB", file: fileName, origin, ...inspection, ...policy, prevented: null, evidence: "BROWSER_POLICY_DECISION", ticket });
    return { ...inspection, ...policy, ticket };
  }

  async completeBrowser(input) {
    const pending = this.tickets.get(input.ticket);
    if (!pending || pending.expires < Date.now()) throw new Error("Decisión de navegador ausente o caducada");
    if (!["CANCELLED", "RELEASED", "FAILED"].includes(input.outcome)) throw new Error("Resultado de navegador no válido");
    this.tickets.delete(input.ticket);
    const prevented = !pending.policy.allowed && input.outcome === "CANCELLED";
    const event = this.audit.record({ channel: pending.channel, activity: "RESULTADO_INTERACCION_WEB", file: pending.fileName, origin: pending.origin, classification: pending.inspection.classification, score: pending.inspection.score, matches: pending.inspection.matches, ...pending.policy, prevented, outcome: input.outcome, evidence: "BROWSER_CLIENT_REPORT", ticket: input.ticket });
    await reportCentral(pending.inspection, input.outcome);
    return { recorded: true, id: event.id, prevented };
  }

  async transfer(input) {
    const item = this.inventory.get(input.fileId);
    if (!item) throw new Error("Selecciona un archivo del inventario");
    const target = this.config.targets.find((t) => t.id === input.targetId);
    if (!target && !["clipboard", "print"].includes(input.channel)) throw new Error("Destino no configurado");
    const channel = target ? target.channel : input.channel;
    const snapshot = await this.readSnapshot(item.path);
    const inspection = await managedInspection(snapshot.buffer, item.name, channel, target?.url || `endpoint://${channel}`);
    const policy = decide(inspection, channel, this.config.policies);
    const operationId = crypto.randomUUID();
    const fields = { operationId, channel, activity: "TRANSFERENCIA_CONTROLADA", file: item.name, sourcePath: snapshot.path, destination: target ? target.name : channel === "print" ? String(input.printer || "").slice(0, 100) : "Portapapeles Windows", ...inspection, ...policy, evidence: target?.lab ? "LAB_CONTROLLED_OPERATION" : "CONTROLLED_OPERATION" };
    if (!policy.allowed) {
      const event = this.audit.record({ ...fields, outcome: "PREVENTED", prevented: true });
      this.notify(`Bloqueo DLP en ${channel}: ${item.name}`);
      await reportCentral(inspection, "CANCELLED");
      return { ...event, message: "Operación detenida antes de escribir, enviar o imprimir el contenido" };
    }
    this.audit.record({ ...fields, outcome: "PREPARED", prevented: false });
    try {
      let receipt;
      if (target && ["usb", "network_share"].includes(channel)) {
        if (!target.lab && channel === "usb") {
          const drive = this.bridge.info.drives.find((d) => d.type === "Removable" && d.ready && isWithin(target.path, d.root));
          if (!drive) throw new Error("No se verificó una unidad USB extraíble preparada para este destino");
        }
        await fsp.mkdir(target.path, { recursive: true });
        const realTarget = await fsp.realpath(target.path);
        if (!target.lab && channel === "usb" && !this.bridge.info.drives.some((d) => d.type === "Removable" && d.ready && isWithin(realTarget, d.root))) throw new Error("El destino resuelto no pertenece a una unidad USB verificada");
        if (!target.lab && channel === "network_share" && !/^\\\\[^\\]+\\[^\\]+/.test(realTarget)) throw new Error("El destino resuelto no es una ruta UNC");
        const safe = path.basename(item.name).replace(/[^\p{L}\p{N}._-]/gu, "_").slice(0, 120);
        const destination = path.join(realTarget, `${operationId}-${safe || "archivo"}`);
        await fsp.writeFile(destination, snapshot.buffer, { flag: "wx" });
        receipt = { storedPath: destination, bytes: snapshot.buffer.length, verifiedDestination: target.lab ? "DIRECTORIO_DE_LABORATORIO" : channel === "usb" ? "USB_VERIFICADO_POR_SENSOR" : "RUTA_UNC" };
      } else if (channel === "http_transfer") {
        const send = this.adapters.http || fetch;
        const response = await send(target.url, { method: "POST", body: snapshot.buffer, redirect: "error", signal: AbortSignal.timeout(12000), headers: { "Content-Type": "application/octet-stream", "X-DLP-File-Name": encodeURIComponent(item.name), "X-DLP-SHA256": inspection.sha256 } });
        await response.body?.cancel();
        if (!response.ok) throw new Error(`El receptor HTTP respondió ${response.status}`);
        receipt = { httpStatus: response.status, bytes: snapshot.buffer.length };
      } else if (channel === "clipboard" || channel === "print") {
        const extracted = await extractText(snapshot.buffer, item.name);
        if (extracted.status !== "COMPLETE") throw new Error("El contenido no se pudo extraer completamente");
        if (channel === "clipboard") receipt = await this.bridge.request("writeClipboard", { text: extracted.text });
        else {
          const printer = String(input.printer || "");
          const outputPath = printer === "Microsoft Print to PDF" ? path.join(PROJECT, "laboratorio", "impresiones", `${operationId}.pdf`) : undefined;
          if (outputPath) await fsp.mkdir(path.dirname(outputPath), { recursive: true });
          receipt = await this.bridge.request("print", { text: extracted.text, printer, outputPath }, 60000);
          if (outputPath && receipt.submitted) {
            const started = Date.now();
            while (Date.now() - started < 15000) {
              const output = await fsp.stat(outputPath).catch(() => null);
              if (output && output.size > 0) { receipt.outputFileVerified = true; break; }
              await new Promise((resolve) => setTimeout(resolve, 150));
            }
            if (!receipt.outputFileVerified) throw new Error("Trabajo enviado, pero no se pudo verificar el PDF de salida; revisa la cola de impresión");
          }
        }
      }
      const event = this.audit.record({ ...fields, outcome: "COMPLETED", prevented: false, receipt });
      await reportCentral(inspection, "UPSTREAM_RESPONSE");
      return { ...event, message: policy.decision === "ALERTA" ? "Operación realizada con alerta" : "Operación realizada" };
    } catch (error) {
      const event = this.audit.record({ ...fields, decision: "ERROR", outcome: "FAILED", prevented: false, message: String(error.message).slice(0, 180) });
      await reportCentral(inspection, "FAILED");
      return event;
    }
  }

  async handleNative(message) {
    if (message.type === "process-observed") {
      this.audit.record({ channel: "process_observed", activity: message.phase === "START" ? "PROCESO_INICIADO" : "PROCESO_FINALIZADO", program: String(message.program || "").slice(0, 160), processId: Number(message.processId), decision: "DETECTADO", detected: false, prevented: false, outcome: "OBSERVED", evidence: "PERIODIC_PROCESS_SNAPSHOT" });
      return;
    }
    if (message.type === "exit-request") { this.emit("exit-request"); return; }
    if (message.type === "sysmon-observed") {
      const program = String(message.program || "").slice(0, 250);
      this.audit.record({ channel: "sysmon", activity: /[\\/]rclone\.exe$/i.test(program) ? "RCLONE_OBSERVADO" : "ACTIVIDAD_SISTEMA_OBSERVADA", decision: "DETECTADO", detected: false, prevented: false, nativeEventId: Number(message.eventId), nativeRecordId: Number(message.recordId), program, destinationAddress: String(message.destinationAddress || "").slice(0, 80), destinationPort: String(message.destinationPort || "").slice(0, 10), file: message.targetFile ? path.basename(String(message.targetFile)) : undefined, dnsNameHash: message.dnsNameHash, evidence: "SYSMON_EVENT_AFTER_ACTIVITY", outcome: "OBSERVED" });
      return;
    }
    if (message.type === "print-observed") {
      this.audit.record({ channel: "print_observed", activity: "TRABAJO_DE_IMPRESION_OBSERVADO", decision: "DETECTADO", classification: "NO_DETERMINADA", detected: false, prevented: false, printer: String(message.printer).slice(0, 100), file: String(message.document || "").slice(0, 160), evidence: "AFTER_SUBMISSION", outcome: "OBSERVED" });
      return;
    }
    if (message.type !== "clipboard" || !this.config.clipboardMonitor) return;
    let inspection;
    if (message.kind === "text") {
      inspection = { ...analyzeContent(String(message.text || "").slice(0, 200000)), inspectionStatus: message.partial ? "PARTIAL" : "COMPLETE" };
    } else if (message.kind === "files") {
      const results = [];
      for (const file of (message.files || []).slice(0, 20)) {
        try { const snapshot = await this.readSnapshot(file, true); results.push(await inspectBuffer(snapshot.buffer, path.basename(file))); }
        catch { results.push({ score: 0, matches: [], inspectionStatus: "UNANALYZABLE", classification: "NO_ANALIZABLE" }); }
      }
      inspection = results.sort((a, b) => b.score - a.score)[0] || { score: 0, matches: [], classification: "NO_ANALIZABLE" };
      inspection.inspectionStatus = results.length > 0 && !message.partial && (message.files || []).length <= 20 && results.every((r) => r.inspectionStatus === "COMPLETE") ? "COMPLETE" : "PARTIAL";
    } else inspection = { score: 0, matches: [], classification: "NO_ANALIZABLE", inspectionStatus: "UNANALYZABLE" };
    const policy = decide(inspection, "clipboard", this.config.policies);
    const fields = { channel: "clipboard_observed", activity: "PORTAPAPELES_OBSERVADO", classification: inspection.classification, score: inspection.score, matches: inspection.matches, inspectionStatus: inspection.inspectionStatus, detected: inspection.score > 0, decision: inspection.score > 0 ? "ALERTA" : inspection.inspectionStatus === "COMPLETE" ? "PERMITIDO" : "NO_ANALIZABLE", recommendedDecision: policy.decision, prevented: false, process: String(message.process || "desconocido").slice(0, 80), evidence: "AFTER_COPY", outcome: "OBSERVED" };
    this.audit.record(fields);
    if (this.config.clipboardRemediation && !policy.allowed) {
      try {
        const receipt = await this.bridge.request("clearClipboard", { sequence: message.sequence });
        this.audit.record({ ...fields, activity: "LIMPIEZA_REACTIVA_PORTAPAPELES", outcome: "REMEDIATED", remediated: Boolean(receipt.cleared), prevented: false, receipt });
      } catch (error) { this.operationalError("LIMPIEZA_PORTAPAPELES", error); }
    }
    if (inspection.score > 0) this.notify("El agente detectó información sensible en el portapapeles. Revisa el panel.");
  }

  notify(message) {
    if (!this.config.notifications || !this.bridge.info.available || Date.now() - this.lastNotification < 10000) return;
    this.lastNotification = Date.now();
    this.bridge.request("notify", { message }).catch(() => {});
  }

  status() {
    const items = [...this.inventory.values()];
    let systemControls = { applied: false, verificationRequired: true };
    try { systemControls = JSON.parse(fs.readFileSync(path.join(this.dataDirectory, "controles-windows-estado.json"), "utf8")); } catch {}
    return {
      version: "3.0.0", startedAt: this.startedAt, platform: process.platform, scan: this.scanState, classifier: { ...semanticClassifier.status(), backend: process.env.DLP_INSPECTION_BACKEND || "local" },
      inventory: { total: items.length, sensitive: items.filter((x) => x.score > 0).length, unknown: items.filter((x) => x.inspectionStatus !== "COMPLETE" || x.semantic?.required && x.semantic.status !== "COMPLETE").length, semanticEnabled: this.config.inventorySemantic && process.env.DLP_LLM_MODE === "hybrid", semanticBudget: this.config.semanticFilesPerScan },
      operations: { prevented: this.audit.events.filter((event) => event.prevented === true).length },
      windows: this.bridge.info, windowsControls: systemControls, audit: this.audit.status(), suggestedRoots: suggestedRoots(),
      browserClients: this.browserObserver.status(),
      coverage: [
        { channel: "Archivos locales", mode: "DETECCION", active: this.watchers.length > 0, detail: "Carpetas configuradas, archivos accesibles y formatos admitidos; no intercepta lecturas ni copias nativas." },
        { channel: "USB / carpetas compartidas", mode: "BLOQUEO_EN_OPERACION_MEDIADA", active: true, detail: "El agente decide antes de escribir. Los destinos de laboratorio están identificados; el Explorador no pasa por esta operación." },
        { channel: "Subida HTTP", mode: "BLOQUEO_ANTES_DEL_ENVIO", active: true, detail: "Solo transferencias ejecutadas por el agente a destinos configurados." },
        { channel: "Navegador", mode: "COMPLEMENTO_REQUERIDO", active: this.browserObserver.status().some((c) => c.active), detail: "Latido de vinculación y sitios visitados; selección, pegado y arrastre soportados. La navegación observada no prueba bloqueo." },
        { channel: "Portapapeles Windows", mode: "OBSERVACION_REACTIVA", active: this.config.clipboardMonitor && this.bridge.info.available && this.bridge.info.clipboard === "OBSERVACION_REACTIVA", detail: "Observar o limpiar después de copiar no demuestra bloqueo previo. La copia mediada sí se decide antes de escribir." },
        { channel: "Impresión", mode: "BLOQUEO_EN_IMPRESION_MEDIADA", active: this.bridge.info.available, detail: "La impresión del agente se decide antes de enviar el trabajo. Trabajos externos solo se observan si el sensor puede consultarlos." },
        { channel: "Controles generales Windows", mode: "ACTIVACION_ADMINISTRATIVA_SEPARADA", active: systemControls.applied === true, detail: "USB de solo lectura, salida SMB y servicio de impresión. El estado es un recibo de configuración, no una prueba física; bloquean el canal completo." },
      ],
      rules: rules.map(({ id, name, description, points }) => ({ id, name, description, points })),
    };
  }

  async stop() {
    this.stopping = true;
    this.stopTelemetry?.();
    this.copyMonitor?.stop();
    clearTimeout(this.debounce); clearInterval(this.scanTimer);
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    await this.bridge.stop();
  }
}

module.exports = { EndpointRuntime, INSPECTABLE };
