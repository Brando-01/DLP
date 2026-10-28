"use strict";
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { inspectBuffer } = require("../lib/inspection");
const { isWithin } = require("./config");

class CopyMonitor {
  constructor(runtime) { this.runtime = runtime; this.seen = new Map(); this.watchers = []; this.busy = false; this.stopped = false; }
  async scan() {
    if (this.busy || this.stopped) return; this.busy = true;
    let count = 0;
    const walk = async (root, directory) => {
      let entries; try { entries = await fsp.readdir(directory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (this.stopped || ++count > this.runtime.config.maxFiles) break;
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink() || path.relative(root, file).split(/[\\/]/).some((p) => [".git", "node_modules", "datos-endpoint", "datos-control"].includes(p.toLowerCase()))) continue;
        if (entry.isDirectory()) { await walk(root, file); continue; }
        if (!entry.isFile()) continue;
        try {
          const real = await fsp.realpath(file); if (!isWithin(real, await fsp.realpath(root))) continue;
          const stat = await fsp.stat(real); const previous = this.seen.get(real);
          if (previous?.mtime === stat.mtimeMs && previous?.size === stat.size) continue;
          const snapshot = await this.runtime.readSnapshot(real, true);
          const hash = crypto.createHash("sha256").update(snapshot.buffer).digest("hex");
          const source = [...this.runtime.inventory.values()].find((item) => item.sha256 === hash && !isWithin(real, path.dirname(item.path)) && item.score > 0);
          const inspection = source || await inspectBuffer(snapshot.buffer, entry.name);
          this.seen.set(real, { mtime: stat.mtimeMs, size: stat.size });
          while (this.seen.size > this.runtime.config.maxFiles * 2) this.seen.delete(this.seen.keys().next().value);
          if (inspection.score > 0 || inspection.inspectionStatus !== "COMPLETE") this.runtime.audit.record({ channel: "local_copy", activity: source ? "COPIA_SENSIBLE_CORRELACIONADA" : "ARCHIVO_EN_DESTINO_NO_AUTORIZADO", file: entry.name, destination: real, sourcePath: source?.path, sha256: hash, classification: inspection.classification, score: inspection.score, matches: inspection.matches, decision: inspection.score > 0 ? "ALERTA" : "NO_ANALIZABLE", detected: inspection.score > 0, prevented: false, outcome: "OBSERVED_AFTER_WRITE", evidence: source ? "MATCHING_CLASSIFIED_SOURCE_HASH_AFTER_COPY" : "DESTINATION_FILE_SENSOR_AFTER_WRITE", caseId: "CU-02" });
        } catch { /* Un archivo que sigue escribiéndose se reintentará en el próximo escaneo. */ }
      }
    };
    try { for (const root of this.runtime.config.restrictedDestinations) await walk(root, root); } finally { this.busy = false; }
  }
  start() {
    for (const root of this.runtime.config.restrictedDestinations) {
      try { this.watchers.push(fs.watch(root, { recursive: true }, () => { clearTimeout(this.debounce); this.debounce = setTimeout(() => this.scan(), 500); })); } catch {}
    }
    this.timer = setInterval(() => this.scan(), 5000); this.timer.unref(); this.scan();
  }
  stop() { this.stopped = true; clearInterval(this.timer); clearTimeout(this.debounce); this.watchers.forEach((watcher) => watcher.close()); }
}
module.exports = { CopyMonitor };
