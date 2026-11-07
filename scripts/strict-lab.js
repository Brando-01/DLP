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
const { publicProxyCA } = require("../lib/public-proxy-ca");
function prepare(options = {}) {
  const root = options.root || ROOT, platform = options.platform || process.platform;
  const file = path.join(root, ".env"), env = parseEnv(fs.readFileSync(file, "utf8"));
  if (!/^[a-f0-9-]{36}$/.test(env.DLP_DEVICE_ID || "") || env.DLP_INSPECTION_BACKEND !== "central") throw new Error("Primero inscribe esta VM individualmente.");
  const gateway = new URL(env.DLP_CONTROL_URL).hostname;
  const own = Object.values(os.networkInterfaces()).flat().some(n => n?.address === gateway);
  if (net.isIP(gateway) !== 4 || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(gateway) || own) throw new Error("Se requiere un gateway privado separado; no preparar en el anfitrión.");
  let raw = options.caPem;
  if (raw === undefined) {
    try { raw = fs.readFileSync(options.ca, "utf8"); }
    catch { throw new Error("No se pudo abrir la CA indicada. Usa npm run strict:prepare -- --from-central para obtenerla sin carpeta compartida."); }
  }
  const { pem: ca, fingerprint256 } = publicProxyCA(raw);
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
  return { prepared: true, firewallChanged: false, caFingerprint256: fingerprint256, next: "client:install, strict:plan y activación administrativa dentro de la VM", gateway };
}
async function prepareFromCentral(options = {}) {
  const root = options.root || ROOT, env = parseEnv(fs.readFileSync(path.join(root, ".env"), "utf8"));
  if (!/^[a-f0-9-]{36}$/.test(env.DLP_DEVICE_ID || "") || !/^[a-f0-9]{64}$/.test(env.DLP_INSPECT_TOKEN || "")) throw new Error("Primero inscribe esta VM individualmente.");
  const url = new URL(env.DLP_CONTROL_URL);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || !["http:", "https:"].includes(url.protocol) || url.protocol === "http:" && env.DLP_ALLOW_LAB_HTTP !== "1") throw new Error("Central inválido: HTTP requiere la concesión explícita de laboratorio de la inscripción.");
  const response = await (options.fetch || fetch)(url.origin + "/v1/lab/proxy-ca", { headers: { "X-DLP-Token": env.DLP_INSPECT_TOKEN }, redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(response.status === 404 ? "Actualiza y sincroniza el servidor: aún no ofrece la descarga de CA." : response.status === 401 || response.status === 403 ? "El central no acepta la identidad de esta VM." : "El central no tiene disponible la CA pública del proxy.");
  }
  let size = 0; const chunks = [];
  for await (const chunk of response.body) { size += chunk.length; if (size > 65536) throw new Error("CA recibida fuera del límite permitido."); chunks.push(Buffer.from(chunk)); }
  return prepare({ ...options, root, caPem: Buffer.concat(chunks).toString("utf8") });
}
async function main(args = process.argv.slice(2)) {
  const action = args[0] || "plan", policy = path.join(ROOT, "datos-endpoint/strict-lab-policy.json");
  if (action === "prepare") {
    if (args.length === 2 && args[1] === "--from-central") console.log(JSON.stringify(await prepareFromCentral()));
    else if (args.length === 3 && args[1] === "--ca") console.log(JSON.stringify(prepare({ ca: path.resolve(args[2]) })));
    else throw new Error("Uso: npm run strict:prepare -- --from-central | --ca RUTA_CA_PUBLICA");
    return;
  }
  if (!["plan", "apply", "audit", "restore"].includes(action) || args.length !== 1) throw new Error("Acción no admitida.");
  if (["plan", "apply"].includes(action) && !fs.existsSync(policy)) throw new Error("Falta preparar el modo estricto. Ejecuta strict:prepare -- --from-central y continúa solo si informa prepared:true.");
  if (process.platform === "win32") {
    const ps = { plan: "Plan", apply: "Apply", audit: "Audit", restore: "Restore" }[action];
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "endpoint/windows/Protection.ps1"), "-Action", ps, ...(action === "apply" || action === "plan" ? ["-PolicyPath", policy] : []), ...(action === "apply" ? ["-ConfirmIsolatedEndpoint"] : [])], { stdio: "inherit", windowsHide: true });
  } else if (process.platform === "linux") {
    execFileSync("python3", [path.join(ROOT, "endpoint/linux/strict_egress.py"), action, "--policy", policy], { stdio: "inherit" });
  } else throw new Error("Solo Windows y Linux.");
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { prepare, prepareFromCentral };
