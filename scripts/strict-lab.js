"use strict";
require("../lib/environment");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { parseEnv } = require("node:util");
const { execFileSync } = require("node:child_process");
const { ROOT } = require("../lib/environment");
const { writeJsonAtomic } = require("../endpoint/config");
function prepare(options = {}) {
  const root = options.root || ROOT, platform = options.platform || process.platform;
  const file = path.join(root, ".env"), env = parseEnv(fs.readFileSync(file, "utf8"));
  if (!/^[a-f0-9-]{36}$/.test(env.DLP_DEVICE_ID || "") || env.DLP_INSPECTION_BACKEND !== "central") throw new Error("Primero inscribe esta VM individualmente.");
  const gateway = new URL(env.DLP_CONTROL_URL).hostname;
  const own = Object.values(os.networkInterfaces()).flat().some(n => n?.address === gateway);
  if (net.isIP(gateway) !== 4 || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(gateway) || own) throw new Error("Se requiere un gateway privado separado; no preparar en el anfitrión.");
  const ca = fs.readFileSync(options.ca, "utf8");
  if (!ca.includes("BEGIN CERTIFICATE") || ca.includes("PRIVATE KEY")) throw new Error("Indica solo la CA pública del proxy.");
  const directory = path.join(root, "datos-endpoint"); fs.mkdirSync(directory, { recursive: true });
  const cert = path.join(directory, "strict-proxy-ca.pem"); fs.writeFileSync(cert, ca, { mode: 0o600 });
  const policy = { schemaVersion: 1, strictLab: true, host: options.hostname || os.hostname(), gateway, proxyPort: 8081, controlPort: 3100, mailPort: 2525, caCertificate: cert, scope: "LAB_SINK_ONLY", uid: process.getuid?.() };
  if (platform === "win32") {
    const result = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "endpoint/windows/Protection.ps1"), "-Action", "Discover"], { encoding: "utf8", windowsHide: true });
    policy.programs = JSON.parse(result.replace(/^\uFEFF/, "")).programs;
  } else if (platform !== "linux") throw new Error("Solo Windows y Linux.");
  writeJsonAtomic(path.join(directory, "strict-lab-policy.json"), policy);
  Object.assign(env, { DLP_STRICT_LAB: "1", DLP_STRICT_GATEWAY: gateway });
  const temporary = file + ".strict.tmp";
  fs.writeFileSync(temporary, Object.entries(env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("\n") + "\n", { flag: "wx", mode: 0o600 });
  fs.renameSync(temporary, file);
  return { prepared: true, firewallChanged: false, next: "client:install, strict:plan y activación administrativa dentro de la VM", gateway };
}
function main(args = process.argv.slice(2)) {
  const action = args[0] || "plan", policy = path.join(ROOT, "datos-endpoint/strict-lab-policy.json");
  if (action === "prepare") { if (args.length !== 3 || args[1] !== "--ca") throw new Error("Uso: npm run strict:prepare -- --ca RUTA_CA_PUBLICA"); console.log(JSON.stringify(prepare({ ca: path.resolve(args[2]) }))); return; }
  if (!["plan", "apply", "audit", "restore"].includes(action) || args.length !== 1) throw new Error("Acción no admitida.");
  if (process.platform === "win32") {
    const ps = { plan: "Plan", apply: "Apply", audit: "Audit", restore: "Restore" }[action];
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "endpoint/windows/Protection.ps1"), "-Action", ps, ...(action === "apply" || action === "plan" ? ["-PolicyPath", policy] : []), ...(action === "apply" ? ["-ConfirmIsolatedEndpoint"] : [])], { stdio: "inherit", windowsHide: true });
  } else if (process.platform === "linux") {
    execFileSync("python3", [path.join(ROOT, "endpoint/linux/strict_egress.py"), action, "--policy", policy], { stdio: "inherit" });
  } else throw new Error("Solo Windows y Linux.");
}
if (require.main === module) { try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { prepare };
