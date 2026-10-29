"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parseEnv } = require("node:util");
const GENERATED = ["DLP_CONTROL_ADMIN_TOKEN", "DLP_INSPECT_TOKEN", "DLP_TELEMETRY_TOKEN", "DLP_LAB_PASSWORD", "DLP_WAZUH_ENROLLMENT_PASSWORD"];
const ROLES = GENERATED.slice(0, 3);
function prepareEnvironment(directory, template) {
  const file = path.join(directory, ".env");
  const created = !fs.existsSync(file);
  let content = created ? template : fs.readFileSync(file, "utf8");
  const values = parseEnv(content), defaults = parseEnv(template), repaired = [];
  for (const key of Object.keys(defaults)) {
    const definitions = content.split(/\r?\n/).filter((line) => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line));
    if (definitions.length > 1) throw new Error(`La variable ${key} está duplicada en .env; conserva una sola definición`);
    if (!Object.hasOwn(values, key)) {
      content += `\n${key}=${defaults[key]}\n`; values[key] = defaults[key]; repaired.push(key);
    }
  }
  for (const key of GENERATED) {
    if (!values[key]?.trim()) {
      const value = crypto.randomBytes(32).toString("hex");
      content = content.replace(new RegExp(`^(?:[ \\t]*export[ \\t]+)?[ \\t]*${key}[ \\t]*=.*$`, "gm"), `${key}=${value}`);
      values[key] = value; if (!repaired.includes(key)) repaired.push(key);
    }
  }
  for (const key of ROLES) if (!/^[a-f0-9]{64}$/.test(values[key])) throw new Error(`${key} debe contener 64 caracteres hexadecimales; elimina solo su valor y ejecuta setup si necesitas generarlo`);
  if (new Set(ROLES.map((key) => values[key])).size !== ROLES.length) throw new Error("Los tres tokens del control deben ser distintos; revisa los nombres sin publicar sus valores");
  for (const key of GENERATED.slice(3)) if (/[\r\n]/.test(values[key])) throw new Error(`${key} no admite saltos de línea`);
  if (created || content !== fs.readFileSync(file, "utf8")) {
    const temp = file + "." + crypto.randomUUID() + ".tmp";
    try { fs.writeFileSync(temp, content, { flag: "wx", mode: 0o600 }); fs.renameSync(temp, file); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  return { file, created, repaired, values };
}
module.exports = { prepareEnvironment, GENERATED };
