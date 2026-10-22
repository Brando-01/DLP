"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const ZERO = "0".repeat(64);
const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

class AuditLog {
  constructor(directory) {
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, "auditoria.jsonl");
    this.events = [];
    this.previousHash = ZERO;
    if (fs.existsSync(this.file)) {
      const lines = fs.readFileSync(this.file, "utf8").split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const event = JSON.parse(line);
        const { auditHash, ...payload } = event;
        if (payload.previousHash !== this.previousHash || hash(payload) !== auditHash) throw new Error("La cadena de auditoría no es íntegra; revisar el archivo antes de arrancar");
        this.previousHash = auditHash;
        this.events.push(event);
      }
    }
    this.lastStat = fs.existsSync(this.file) ? fs.statSync(this.file, { bigint: true }) : null;
  }
  record(fields) {
    const stat = fs.existsSync(this.file) ? fs.statSync(this.file, { bigint: true }) : null;
    const changed = Boolean(stat) !== Boolean(this.lastStat) || stat && this.lastStat && (stat.size !== this.lastStat.size || stat.mtimeNs !== this.lastStat.mtimeNs || stat.ctimeNs !== this.lastStat.ctimeNs);
    if (changed && !this.verify().chainValid) throw new Error("Auditoría alterada: se retienen las nuevas operaciones hasta revisar el registro");
    const payload = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...fields, previousHash: this.previousHash };
    // No aceptar texto, archivos o secretos como parte del registro.
    for (const key of ["text", "content", "buffer", "token", "password", "body"]) delete payload[key];
    const event = { ...payload, auditHash: hash(payload) };
    fs.appendFileSync(this.file, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
    this.previousHash = event.auditHash;
    this.events.push(event);
    this.lastStat = fs.statSync(this.file, { bigint: true });
    return event;
  }
  recent(limit = 200) { return this.events.slice(-Math.min(Math.max(limit, 1), 1000)).reverse(); }
  verify() {
    let previous = ZERO, count = 0;
    try {
      const lines = fs.existsSync(this.file) ? fs.readFileSync(this.file, "utf8").split(/\r?\n/).filter(Boolean) : [];
      for (const line of lines) {
        const { auditHash, ...payload } = JSON.parse(line);
        if (payload.previousHash !== previous || hash(payload) !== auditHash) return { chainValid: false, checkedAt: new Date().toISOString() };
        previous = auditHash; count += 1;
      }
      return { chainValid: count === this.events.length && previous === this.previousHash, checkedAt: new Date().toISOString() };
    } catch { return { chainValid: false, checkedAt: new Date().toISOString() }; }
  }
  status() { return { events: this.events.length, ...this.verify(), lastHash: this.previousHash, note: "Cadena SHA-256 para detectar alteraciones; no es una firma ni protege contra un administrador que reconstruya la cadena." }; }
}

module.exports = { AuditLog };
