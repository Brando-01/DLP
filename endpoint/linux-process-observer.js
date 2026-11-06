"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { EventEmitter } = require("node:events");

// Metadatos del usuario del agente. No lee cmdline, memoria ni contenido de ventanas.
class LinuxProcessObserver extends EventEmitter {
  constructor(options = {}) {
    super();
    this.enabled = options.enabled !== false && (options.platform || process.platform) === "linux";
    this.proc = options.proc || "/proc";
    this.uid = options.uid ?? process.getuid?.();
    this.interval = options.interval || 5000;
    this.processes = new Map(); this.initialized = false; this.stopped = false; this.busy = false;
    this.info = { available: false, scope: "CURRENT_USER", intervalMs: this.interval, sampledAt: null, count: 0, truncated: false, processes: [], droppedEvents: 0 };
  }
  async poll() {
    if (!this.enabled || this.stopped || this.busy) return;
    this.busy = true;
    try {
      const entries = await fs.readdir(this.proc, { withFileTypes: true });
      const current = new Map(); let skipped = 0;
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
        try {
          const dir = path.join(this.proc, entry.name);
          const status = await fs.readFile(path.join(dir, "status"), "utf8");
          const uid = /^Uid:\s+(\d+)/m.exec(status);
          if (!uid || Number(uid[1]) !== this.uid) continue;
          const program = (await fs.readFile(path.join(dir, "comm"), "utf8")).trim().replace(/[\x00-\x1f\x7f]/g, "").slice(0, 160);
          current.set(Number(entry.name), program);
          if (current.size >= 4096) { skipped++; break; }
        } catch { skipped++; } // /proc cambia mientras se recorre; no invalida toda la muestra.
      }
      if (this.stopped) return;
      let emitted = 0, dropped = 0;
      const emit = (phase, processId, program) => {
        if (emitted++ < 100) this.emit("sensor", { type: "process-observed", phase, processId, program });
        else dropped++;
      };
      if (this.initialized) {
        for (const [pid, name] of this.processes) if (current.get(pid) !== name) emit("EXIT", pid, name);
        for (const [pid, name] of current) if (this.processes.get(pid) !== name) emit("START", pid, name);
      }
      this.processes = current; this.initialized = true;
      const processes = [...current].sort((a, b) => a[1].localeCompare(b[1]) || a[0] - b[0]).slice(0, 50).map(([processId, program]) => ({ processId, program }));
      this.info = { ...this.info, available: true, sampledAt: new Date().toISOString(), count: current.size, processes, truncated: current.size > 50 || skipped > 0, droppedEvents: this.info.droppedEvents + dropped };
    } catch {
      this.info = { ...this.info, available: false }; this.emit("diagnostic", "No se pudo consultar el sensor de procesos Linux");
    } finally { this.busy = false; }
  }
  start() { if (!this.enabled || this.timer) return; this.stopped = false; this.poll(); this.timer = setInterval(() => this.poll(), this.interval); this.timer.unref(); }
  stop() { this.stopped = true; clearInterval(this.timer); this.timer = null; this.info.available = false; }
}
module.exports = { LinuxProcessObserver };
