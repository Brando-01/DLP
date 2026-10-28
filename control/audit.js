"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { AuditLog } = require("../lib/audit");
class CentralAudit extends AuditLog {
  constructor(directory) { super(directory); this.siemFile = path.join(directory, "siem.jsonl"); }
  record(fields) {
    const event = super.record(fields);
    // Wazuh JSON no admite arrays de objetos. Mantener la auditoria completa
    // y emitir un feed acotado, sin documentos ni reingreso de alertas Wazuh.
    if (!String(event.activity).startsWith("WAZUH_")) {
      const item = {};
      for (const key of ["id", "timestamp", "channel", "activity", "device", "decision", "prevented", "outcome", "cause", "evidence", "score", "classification", "file"]) if (event[key] !== undefined && (event[key] === null || ["string", "number", "boolean"].includes(typeof event[key]))) item[key] = event[key];
      fs.appendFileSync(this.siemFile, JSON.stringify(item) + "\n", { encoding: "utf8", mode: 0o600 });
    }
    return event;
  }
}
module.exports = { CentralAudit };
