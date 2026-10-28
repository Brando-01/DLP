"use strict";
require("../lib/environment");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { ROOT } = require("../lib/environment");
const { start } = require("../start");
async function run() {
  if (!process.env.DLP_CONTROL_ADMIN_TOKEN) throw new Error("Ejecuta npm.cmd run setup antes de iniciar el laboratorio");
  const python = process.env.DLP_PYTHON || path.join(ROOT, process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
  if (!fs.existsSync(python)) throw new Error("Instala Python 3.12+ y las dependencias: python -m venv .venv; .venv/Scripts/python -m pip install -r integrations/requirements.txt");
  const dependency = spawnSync(python, ["-c", "import mitmproxy, aiosmtpd, cryptography"], { cwd: ROOT, windowsHide: true, stdio: "pipe" });
  if (dependency.status !== 0) throw new Error("Faltan dependencias Python del filtro. Consulta README.");
  const childEnv = { ...process.env, DLP_LAB_CERTS: path.join(ROOT, "datos-control/certs-private"), DLP_LAB_PUBLIC_CA: path.join(ROOT, "datos-control/certs-public"), DLP_DNS_LOG: path.join(ROOT, "datos-control/dns.jsonl"), DLP_SINK_DIR: path.join(ROOT, "laboratorio/recepciones"), DLP_PROXY_PRIVATE: path.join(ROOT, "datos-control/mitm-private") };
  fs.mkdirSync(path.join(ROOT, "datos-control"), { recursive: true });
  const cert = spawnSync(python, ["deploy/certificates.py"], { cwd: ROOT, windowsHide: true, env: childEnv, stdio: "inherit" });
  if (cert.status !== 0) throw new Error("No se pudo preparar el certificado del receptor");
  const children = []; let service;
  const launch = (args) => {
    const environment = { ...childEnv };
    for (const key of ["GROQ_API_KEY", "DLP_CONTROL_ADMIN_TOKEN", "DLP_TELEMETRY_TOKEN"]) delete environment[key];
    const child = spawn(python, args, { cwd: ROOT, windowsHide: true, env: environment, stdio: "inherit" });
    child.on("error", (error) => console.error(`No inició un servicio: ${error.message}`));
    children.push(child); return child;
  };
  let stopped = false;
  const stop = async () => {
    if (stopped) return; stopped = true;
    children.forEach((child) => { if (child.exitCode === null) child.kill(); });
    await service?.stop();
  };
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => stop().catch(() => {}));
  try {
    process.env.DLP_CONTROL_EMBEDDED = "1";
    service = await start();
    launch(["-m", "integrations.lab_sink"]); launch(["-m", "integrations.lab_dns"]); launch(["-m", "integrations.dns_guard"]); launch(["-m", "integrations.mail_filter"]);
    const privateDir = childEnv.DLP_PROXY_PRIVATE;
    const caPublic = path.join(childEnv.DLP_LAB_PUBLIC_CA, "mitmproxy-ca-cert.pem");
    launch(["-c", "from mitmproxy.tools.main import mitmdump; mitmdump()", "--listen-host", "127.0.0.1", "--listen-port", "8080", "--set", `confdir=${privateDir}`, "--set", "connection_strategy=lazy", "--set", "body_size_limit=12m", "--set", `ssl_verify_upstream_trusted_ca=${path.join(childEnv.DLP_LAB_PUBLIC_CA, "receiver-ca.pem")}`, "-s", "integrations/proxy_addon.py", "-q"]);
    const started = Date.now();
    while (Date.now() - started < 45000 && !stopped) {
      if (children.some((child) => child.exitCode !== null)) throw new Error("Un servicio terminó durante el arranque; revisa su diagnóstico");
      const privateCa = path.join(privateDir, "mitmproxy-ca-cert.pem");
      if (fs.existsSync(privateCa)) { fs.copyFileSync(privateCa, caPublic); break; }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!fs.existsSync(caPublic)) throw new Error("El proxy no generó su certificado público");
    console.log("Laboratorio iniciado: consola :3100, agente :3001, proxy :8080, SMTP :2525, receptor HTTPS/WebDAV :4201, DNS :5300.");
    console.log("Usa datos ficticios y el certificado público en datos-control/certs-public. No se cambió el proxy ni el firewall de Windows.");
    console.log("Groq se activa al configurar GROQ_API_KEY en .env y reiniciar. Antes de ello las salidas híbridas quedan pendientes.");
    for (const child of children) child.on("exit", () => { if (!stopped) { console.error("Se detuvo un servicio del laboratorio; cerrando el resto."); stop().catch(() => {}); } });
    return { stop, service };
  } catch (error) { await stop(); throw error; }
}
if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
