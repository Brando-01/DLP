"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { execFileSync } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { temporary } = require("./helpers/fixtures.cjs");
const { unitPlan, linuxAction } = require("../scripts/client-autostart");
const { supervise, requestStop } = require("../scripts/agent-runner");
async function freePort() {
  const server = http.createServer(); server.listen(0, "127.0.0.1"); await new Promise(r => server.once("listening", r));
  const port = server.address().port; await new Promise(r => server.close(r)); return port;
}
async function waitFor(fn) { const until = Date.now() + 10000; while (Date.now() < until) { try { const result = await fn(); if (result) return result; } catch {} await delay(50); } throw new Error("La condición de supervisión no se cumplió."); }
test("unidad Linux: plan sin instalación, propiedad, ciclo instalar/desinstalar y protección de archivos ajenos", async t => {
  const tmp = await temporary(); t.after(tmp.cleanup);
  const root = path.join(tmp.root, "cliente con espacios"); await fs.mkdir(root);
  const options = { root, configHome: path.join(tmp.root, "config"), node: "/usr/bin/node", verify: () => {}, execute: () => "" };
  const plan = await linuxAction("plan", options);
  assert.equal(await fs.access(plan.file).then(() => true, () => false), false);
  await assert.rejects(linuxAction("install", options), /Inscribe primero/);
  await fs.mkdir(path.join(root, "node_modules/express"), { recursive: true });
  const original = `DLP_DEVICE_ID=11111111-1111-4111-8111-111111111111\nDLP_INSPECTION_BACKEND=central\nDLP_FORWARD_EVENTS=1\nDLP_INSPECT_TOKEN=${"a".repeat(64)}\nDLP_TELEMETRY_TOKEN=${"b".repeat(64)}\n`;
  await fs.writeFile(path.join(root, ".env"), original);
  const commands = []; options.execute = args => { commands.push(args); return "ActiveState=active"; };
  await linuxAction("install", { ...options, start: true });
  assert.ok(commands.some(args => args[0] === "enable")); assert.ok(commands.some(args => args[0] === "restart"));
  assert.equal((await linuxAction("status", options)).installed, true);
  await linuxAction("uninstall", options);
  assert.equal(await fs.readFile(path.join(root, ".env"), "utf8"), original);
  assert.equal(await fs.access(plan.file).then(() => true, () => false), false);
  await fs.writeFile(plan.file, "# UNIDAD AJENA\n");
  await assert.rejects(linuxAction("install", options), /no pertenece/);
  assert.equal(await fs.readFile(plan.file, "utf8"), "# UNIDAD AJENA\n");
  assert.throws(() => unitPlan({ root: "/tmp/ataque\nExecStart=/bin/false" }), /caracteres/);
});
test("systemd real acepta las unidades generadas para rutas normales y con espacios", { skip: process.platform !== "linux" }, async t => {
  const tmp = await temporary(); t.after(tmp.cleanup);
  for (const name of ["cliente", "cliente con espacios", "cliente % y $ con comillas \"dato\""]) {
    const root = path.join(tmp.root, name); await fs.mkdir(root);
    const plan = unitPlan({ root, node: process.execPath });
    const file = path.join(tmp.root, plan.name); await fs.writeFile(file, plan.content);
    execFileSync("systemd-analyze", ["verify", "--man=no", file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    // Control negativo que reproduce el fallo original: las comillas invalidan la ruta.
    await fs.writeFile(file, plan.content.replace(/^WorkingDirectory=.*$/m, 'WorkingDirectory="' + root.replace(/%/g, "%%") + '"'));
    assert.throws(() => execFileSync("systemd-analyze", ["verify", "--man=no", file], { stdio: "pipe" }));
  }
});
test("supervisor real: evita duplicados, reinicia su proceso y se detiene sin procesos huérfanos", async t => {
  const tmp = await temporary(); t.after(tmp.cleanup);
  const data = path.join(tmp.root, "datos-endpoint"); await fs.mkdir(data);
  await fs.writeFile(path.join(data, "credenciales.json"), JSON.stringify({ browser: "b".repeat(64), admin: "a".repeat(64) }));
  const entry = path.join(tmp.root, "agente-ficticio.js");
  await fs.writeFile(entry, `const http=require('node:http'),crypto=require('node:crypto');const installationId=crypto.createHash('sha256').update('b'.repeat(64)).digest('hex').slice(0,32);const server=http.createServer((req,res)=>{if(req.url==='/api/shutdown'&&req.headers['x-dlp-token']==='a'.repeat(64)){res.end('{}');server.close();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({service:'Agente DLP local',installationId,pid:process.pid}));});server.listen(Number(process.env.DLP_AGENT_PORT),'127.0.0.1');`);
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const running = supervise({ root: tmp.root, port, entry, interval: 100, mode: "TEST" });
  t.after(async () => { await requestStop(tmp.root); await running; });
  const health = () => fetch(base + "/api/health").then(r => r.json());
  const first = await waitFor(health);
  assert.deepEqual(await supervise({ root: tmp.root, port, entry }), { alreadyRunning: true });
  process.kill(first.pid);
  const second = await waitFor(async () => { const v = await health(); return v.pid !== first.pid ? v : null; });
  assert.notEqual(second.pid, first.pid);
  await requestStop(tmp.root); await running;
  await assert.rejects(fetch(base + "/api/health"));
  assert.equal(await fs.access(path.join(data, "supervisor.json")).then(() => true, () => false), false);
});
test("un puerto de un servicio ajeno no se ocupa, no se cierra y no deja bloqueo del supervisor", async t => {
  const tmp = await temporary(); t.after(tmp.cleanup);
  const server = http.createServer((_req, res) => { res.setHeader("Content-Type", "application/json"); res.end('{"service":"AJENO"}'); });
  server.listen(0, "127.0.0.1"); await new Promise(r => server.once("listening", r));
  t.after(() => new Promise(r => { server.close(r); server.closeAllConnections(); }));
  await assert.rejects(supervise({ root: tmp.root, port: server.address().port, interval: 100 }), /ocupado/);
  assert.equal(server.listening, true);
  assert.equal(await fs.access(path.join(tmp.root, "datos-endpoint/supervisor.json")).then(() => true, () => false), false);
});

test("un cierre transitorio del socket de salud se reintenta sin iniciar procesos sobre el puerto", async t => {
  const tmp = await temporary(); t.after(tmp.cleanup);
  const data = path.join(tmp.root, "datos-endpoint"); await fs.mkdir(data);
  const crypto = require("node:crypto"), browser = "b".repeat(64);
  await fs.writeFile(path.join(data, "credenciales.json"), JSON.stringify({ browser }));
  const installationId = crypto.createHash("sha256").update(browser).digest("hex").slice(0, 32);
  let calls = 0;
  const server = http.createServer((req, res) => { calls++; if (calls === 1) return req.socket.destroy(); res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ service: "Agente DLP local", installationId })); });
  server.listen(0, "127.0.0.1"); await new Promise(r => server.once("listening", r));
  t.after(() => new Promise(r => { server.close(r); server.closeAllConnections(); }));
  const running = supervise({ root: tmp.root, port: server.address().port, interval: 50 });
  t.after(async () => { await requestStop(tmp.root); await running; });
  await waitFor(() => calls >= 2);
  await requestStop(tmp.root); await running;
  const log = await fs.readFile(path.join(data, "supervisor.log"), "utf8");
  assert.ok(!log.includes("Proceso del agente iniciado")); assert.equal(server.listening, true);
});
