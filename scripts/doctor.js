"use strict";
require("../lib/environment");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { ROOT } = require("../lib/environment");
const { semanticClassifier } = require("../lib/semantic");
function command(executable, args, timeout = 6000) {
  const result = spawnSync(executable, args, { encoding: "utf8", windowsHide: true, timeout });
  return { available: !result.error && result.status === 0, version: result.status === 0 ? String(result.stdout).trim().slice(0, 150) : undefined };
}
const python = process.env.DLP_PYTHON || path.join(ROOT, process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
const report = { generatedAt: new Date().toISOString(), platform: process.platform, ramGiB: Math.round(os.totalmem() / 1024 ** 3), node: process.version, configurationPresent: fs.existsSync(path.join(ROOT, ".env")), classifier: semanticClassifier.status(), python: command(python, ["-c", "import mitmproxy, aiosmtpd; print('Python: filtros HTTPS y SMTP disponibles')"]), docker: command("docker", ["info", "--format", "{{.ServerVersion}}"]), groqLiveTested: false, notes: ["La clave configurada no acredita conectividad ni exactitud. Usa groq:check con datos ficticios.", "Los controles generales Windows requieren una sesión administrativa y verificación de red/USB en el equipo de laboratorio.", "La alternativa Linux puede ejecutarse en la VM del proyecto si Docker Desktop del anfitrión falla."] };
if (process.platform === "win32") {
  const wsl = command("wsl.exe", ["--list", "--quiet"]);
  report.wslLabPresent = wsl.available && wsl.version.replaceAll("\0", "").includes("DLP-Control-WSL");
  if (report.wslLabPresent) report.wslDocker = command("wsl.exe", ["-d", "DLP-Control-WSL", "-u", "root", "--exec", "docker", "version", "--format", "{{.Server.Version}}"], 10000);
}
const output = path.join(ROOT, "output/evaluacion/preflight-actual.json"); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.configurationPresent) process.exitCode = 1;
