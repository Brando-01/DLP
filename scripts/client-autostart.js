"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { parseEnv } = require("node:util");
const { ROOT } = require("../lib/environment");
function clientReadiness(root = ROOT) {
  const file = path.join(root, ".env");
  const env = fs.existsSync(file) ? parseEnv(fs.readFileSync(file, "utf8")) : {};
  if (!/^[a-f0-9-]{36}$/.test(env.DLP_DEVICE_ID || "") || env.DLP_INSPECTION_BACKEND !== "central" || env.DLP_FORWARD_EVENTS !== "1" || ![env.DLP_INSPECT_TOKEN, env.DLP_TELEMETRY_TOKEN].every(t => /^[a-f0-9]{64}$/.test(t || "")) || env.DLP_INSPECT_TOKEN === env.DLP_TELEMETRY_TOKEN) throw new Error("Inscribe primero este cliente con scripts/enroll-device.js. Requiere identidad y credenciales individuales.");
  if (!fs.existsSync(path.join(root, "node_modules", "express"))) throw new Error("Instala dependencias con npm ci antes del inicio automático.");
  return { enrolled: true, deviceId: env.DLP_DEVICE_ID, serverUrl: env.DLP_CONTROL_URL };
}
function unitPlan(options = {}) {
  const root = options.root || ROOT, node = options.node || process.execPath;
  const id = crypto.createHash("sha256").update(root).digest("hex").slice(0, 12);
  const name = `dlp-agent-${id}.service`;
  if ([root, node].some(v => /[\r\n\0]/.test(v))) throw new Error("La ruta del servicio contiene caracteres no admitidos.");
  const quote = (text, command = false) => '"' + text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%").replace(/\$/g, command ? "$$$$" : "$") + '"';
  // WorkingDirectory es un valor de ruta: systemd conserva las comillas exteriores.
  // ExecStart sí utiliza el analizador de argumentos y requiere sus propias comillas.
  const workingDirectory = root.replace(/%/g, "%%");
  const content = `# DLP owner=${id}\n[Unit]\nDescription=Agente DLP de laboratorio (usuario)\nStartLimitIntervalSec=60\nStartLimitBurst=5\n\n[Service]\nType=simple\nWorkingDirectory=${workingDirectory}\nExecStart=${quote(node, true)} ${quote(path.join(root, "scripts/agent-runner.js"), true)} --mode=SYSTEMD_USER\nRestart=on-failure\nRestartSec=5\nUMask=0077\nNoNewPrivileges=true\n\n[Install]\nWantedBy=default.target\n`;
  return { name, content, marker: `# DLP owner=${id}\n`, file: path.join(options.configHome || process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "systemd/user", name) };
}
async function linuxAction(action, options = {}) {
  const root = options.root || ROOT, plan = unitPlan(options);
  const execute = options.execute || (args => execFileSync("systemctl", ["--user", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  const verify = options.verify || (file => execFileSync("systemd-analyze", ["verify", "--man=no", file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  if (action === "plan") return { ...plan, scope: "Usuario actual; inicio de sesión. Sin firewall, CA, root ni habilitación de linger." };
  const exists = fs.existsSync(plan.file);
  if (exists && !fs.readFileSync(plan.file, "utf8").startsWith(plan.marker)) throw new Error("La unidad existente no pertenece a esta instalación; no se reemplazó.");
  if (action === "status") return { name: plan.name, installed: exists, status: exists ? String(execute(["show", plan.name, "--property=ActiveState,SubState,UnitFileState"])) : "NOT_INSTALLED" };
  if (action === "stop") { if (exists) execute(["stop", plan.name]); return { stopped: true }; }
  if (action === "uninstall") {
    if (exists) { execute(["disable", "--now", plan.name]); fs.unlinkSync(plan.file); execute(["daemon-reload"]); }
    return { removed: true, configurationPreserved: true };
  }
  if (action !== "install") throw new Error("Acción no válida.");
  clientReadiness(root);
  if (!options.execute && process.getuid?.() === 0) throw new Error("Ejecuta la instalación como el usuario del puesto, sin sudo.");
  fs.mkdirSync(path.dirname(plan.file), { recursive: true }); fs.writeFileSync(plan.file, plan.content, { mode: 0o600 });
  verify(plan.file);
  execute(["daemon-reload"]); execute(["enable", plan.name]);
  if (options.start) {
    // Puede no haber un estado anterior cargado; ese caso no requiere limpieza.
    try { execute(["reset-failed", plan.name]); } catch {}
    execute(["restart", plan.name]);
  }
  return { installed: true, name: plan.name, started: Boolean(options.start), scope: "Inicio de sesión del usuario. No habilita linger ni protege antes de iniciar sesión." };
}
async function main(args = process.argv.slice(2)) {
  const action = args[0] || "plan";
  if (!["plan", "install", "status", "stop", "uninstall", "check"].includes(action) || args.slice(1).some(a => a !== "--start")) throw new Error("Uso: node scripts/client-autostart.js plan|install|status|stop|uninstall [--start]");
  if (action === "check") return console.log(JSON.stringify(clientReadiness()));
  if (process.platform === "win32") {
    const actions = { plan: "Plan", install: "Install", status: "Status", stop: "Stop", uninstall: "Uninstall" };
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "endpoint/windows/Install-Agent.ps1"), "-Action", actions[action], ...(args.includes("--start") ? ["-Start"] : [])], { stdio: "inherit", windowsHide: true });
  } else if (process.platform === "linux") console.log(JSON.stringify(await linuxAction(action, { start: args.includes("--start") }), null, 2));
  else throw new Error("Inicio automático disponible para Windows y Linux.");
}
if (require.main === module) main().catch(error => { console.error(error.message || "No se pudo configurar el inicio automático."); process.exitCode = 1; });
module.exports = { clientReadiness, unitPlan, linuxAction };
