"use strict";
require("../lib/environment");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { validatePolicy, defaults } = require("../control/policy");
const { PROJECT, writeJsonAtomic } = require("../endpoint/config");
function restrictedPolicy(domains = ["sink.dlp.test"], mail = ["dlp.test", "example.test"]) {
  return validatePolicy({ ...defaults(), profile: "restricted", uploadDomains: domains, mailDomains: mail });
}
function main() {
  const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  const directory = path.resolve(process.env.DLP_ENDPOINT_DATA_DIR || path.join(PROJECT, "datos-endpoint"));
  const policy = restrictedPolicy(arg("--uploads")?.split(","), arg("--mail")?.split(","));
  writeJsonAtomic(path.join(directory, "politica-estricta.json"), policy);
  if (process.platform === "win32") {
    const file = path.join(directory, "proteccion-politica.json");
    if (!fs.existsSync(file)) {
      const source = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(PROJECT, "endpoint", "windows", "Protection.ps1"), "-Action", "Discover"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
      const discovered = JSON.parse(source.replace(/^\uFEFF/, ""));
      if (arg("--gateway")) discovered.gateway = arg("--gateway");
      writeJsonAtomic(file, discovered);
    }
    console.log("Perfil de Windows preparado en datos-endpoint/proteccion-politica.json. Completa gateway separado y CA pública; revisa Plan antes de Apply.");
  }
  console.log("Política del motor preparada en datos-endpoint/politica-estricta.json. No se ha aplicado. Gestiona los destinos autorizados en la consola central.");
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { restrictedPolicy };
