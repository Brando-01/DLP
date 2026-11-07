"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parseEnv } = require("node:util");
// No cargar environment ni el runtime: el diagnóstico debe funcionar si el estado es inválido.
function encoding(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return "UTF16_LE_BOM";
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return "UTF16_BE_BOM";
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return "UTF8_BOM";
  return "UTF8_OR_NO_BOM";
}
function diagnose(root = path.resolve(__dirname, "..")) {
  const checks = []; let env = {};
  try { env = parseEnv(fs.readFileSync(path.join(root, ".env"), "utf8")); checks.push({ file: ".env", status: "OK" }); }
  catch (error) { checks.push({ file: ".env", status: error.code === "ENOENT" ? "MISSING" : "ENV_READ_ERROR" }); }
  const directory = path.resolve(process.env.DLP_ENDPOINT_DATA_DIR || env.DLP_ENDPOINT_DATA_DIR || path.join(root, "datos-endpoint"));
  for (const name of ["config.json", "credenciales.json", "auditoria.jsonl", "supervisor.json", "strict-lab-policy.json"]) {
    const result = { file: name, status: "OK", startupCritical: ["config.json", "credenciales.json", "auditoria.jsonl"].includes(name) };
    checks.push(result); const file = path.join(directory, name);
    try {
      const stat = fs.statSync(file); if (stat.size > 64 * 1024 * 1024) { result.status = "TOO_LARGE_TO_CHECK"; continue; }
      const buffer = fs.readFileSync(file); result.encoding = encoding(buffer); const text = buffer.toString("utf8");
      const lines = name.endsWith(".jsonl") ? text.split(/\r?\n/) : [text]; let previous = "0".repeat(64), records = 0;
      for (let i = 0; i < lines.length; i++) {
        if (name.endsWith(".jsonl") && !lines[i]) continue;
        let parsed;
        try { parsed = JSON.parse(lines[i]); }
        catch { result.status = "JSON_INVALID"; result.line = i + 1; break; }
        if (name === "credenciales.json" && (!parsed || ![parsed.admin, parsed.browser].every(v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v)))) result.status = "CREDENTIAL_FORMAT_INVALID";
        if (name === "auditoria.jsonl") {
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { result.status = "AUDIT_RECORD_INVALID"; result.line = i + 1; break; }
          const { auditHash, ...payload } = parsed;
          const expected = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
          if (payload.previousHash !== previous || auditHash !== expected) { result.status = "AUDIT_CHAIN_INVALID"; result.line = i + 1; break; }
          previous = auditHash; records++;
        }
      }
      if (name.endsWith(".jsonl")) result.validatedRecords = records;
    } catch (error) { result.status = error.code === "ENOENT" ? "MISSING" : "READ_ERROR"; }
  }
  return { readOnly: true, contentsIncluded: false, node: process.version, strictConfigured: env.DLP_STRICT_LAB === "1", checks, note: "No modifica ni repara registros. Si hay JSON_INVALID o AUDIT_CHAIN_INVALID, conserva los archivos para revisar el caso." };
}
if (require.main === module) console.log(JSON.stringify(diagnose(), null, 2));
module.exports = { diagnose };
