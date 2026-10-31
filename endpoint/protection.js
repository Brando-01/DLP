"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);
let latestAudit = null;
let nativeAudit = null;
function protectionDirectory() { return path.join(process.env.ProgramData || "C:\\ProgramData", "DLP-Laboratorio", "Protection"); }
function protectionStatus(directory, now = Date.now()) {
  const backup = fs.existsSync(path.join(directory, "proteccion-respaldo.json"));
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(path.join(directory, "proteccion-verificacion.json"), "utf8")); } catch {}
  if (latestAudit?.directory === directory && (!receipt || Date.parse(latestAudit.value.checkedAt) > Date.parse(receipt.checkedAt))) receipt = latestAudit.value;
  const age = receipt ? now - Date.parse(receipt.checkedAt) : NaN;
  const fresh = Boolean(receipt && receipt.host?.toLowerCase() === os.hostname().toLowerCase() && age >= 0 && age <= 5 * 60 * 1000);
  return {
    state: !backup ? "NOT_APPLIED" : !fresh ? "AUDIT_REQUIRED" : ["CONFIGURATION_VERIFIED", "DRIFT", "APPLIED_UNVERIFIED"].includes(receipt.state) ? receipt.state : "AUDIT_REQUIRED",
    configurationVerified: backup && fresh && receipt.state === "CONFIGURATION_VERIFIED" && receipt.configurationVerified === true,
    checkedAt: fresh ? receipt.checkedAt : null,
    gateway: fresh ? receipt.gateway : null,
    findings: fresh && Array.isArray(receipt.findings) ? receipt.findings.filter(s => typeof s === "string").slice(0, 100) : [],
    networkTestsRequired: true,
    nativeSensitiveOnly: false,
    nativeApplications: nativeAudit && now - nativeAudit.checkedAt < 5 * 60 * 1000 ? nativeAudit.value : { state: "AUDIT_REQUIRED", configurationVerified: false },
    limitation: "Las aplicaciones no autorizadas quedan sin red. No hay un controlador que bloquee solo sus lecturas de documentos sensibles.",
  };
}
async function auditProtection(directory) {
  if (process.platform !== "win32") throw new Error("La auditoría de este perfil requiere Windows");
  const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "windows", "Protection.ps1"), "-Action", "Audit", "-DataDirectory", path.resolve(directory)], { windowsHide: true, timeout: 25000, maxBuffer: 512 * 1024 });
  latestAudit = { directory, value: JSON.parse(stdout.replace(/^\uFEFF/, "")) };
  const native = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "windows", "Native-Apps.ps1"), "-Action", "Audit"], { windowsHide: true, timeout: 25000, maxBuffer: 512 * 1024 });
  nativeAudit = { checkedAt: Date.now(), value: JSON.parse(native.stdout.replace(/^\uFEFF/, "")) };
  return protectionStatus(directory);
}
module.exports = { protectionStatus, auditProtection, protectionDirectory };
