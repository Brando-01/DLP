"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");

class WindowsBridge extends EventEmitter {
  constructor(options = {}) {
    super();
    this.enabled = process.platform === "win32" && options.enabled !== false;
    this.child = null;
    this.pending = new Map();
    this.info = { available: false, clipboard: "NO_INICIADO", drives: [], printers: [], printingObservation: "NO_INICIADO" };
  }
  start() {
    if (!this.enabled || this.child) return;
    const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    this.child = spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Sta", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "windows", "Sensor.ps1")], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const lines = readline.createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      if (line.length > 300000) return;
      try {
        const message = JSON.parse(line);
        if (message.id && this.pending.has(message.id)) {
          const { resolve, reject, timer } = this.pending.get(message.id);
          clearTimeout(timer); this.pending.delete(message.id);
          message.ok ? resolve(message.result) : reject(new Error(message.error || "Operación Windows no disponible"));
        } else if (message.type === "status") { this.info = { ...this.info, ...message, available: true }; this.emit("status", this.info); }
        else this.emit("sensor", message);
      } catch { this.emit("diagnostic", "Respuesta no válida del sensor Windows"); }
    });
    this.child.stderr.on("data", () => {});
    this.child.on("error", () => { this.info.available = false; this.emit("diagnostic", "No se pudo iniciar el sensor Windows"); });
    this.child.on("exit", () => {
      this.child = null; this.info.available = false;
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error("El sensor Windows se detuvo")); }
      this.pending.clear();
    });
  }
  request(action, fields = {}, timeout = 12000) {
    if (!this.child || !this.info.available) return Promise.reject(new Error("El sensor Windows no está disponible en esta sesión"));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Tiempo de respuesta de Windows agotado")); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, action, ...fields }) + "\n");
    });
  }
  async stop() {
    if (!this.child) return;
    try { this.child.stdin.write(JSON.stringify({ action: "stop" }) + "\n"); } catch {}
    const child = this.child;
    const timer = setTimeout(() => { if (!child.killed) child.kill(); }, 1500);
    timer.unref();
  }
}

module.exports = { WindowsBridge };
