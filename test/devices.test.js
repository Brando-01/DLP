"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { temporary } = require("./helpers/fixtures.cjs");
const { DeviceStore } = require("../control/devices");
const { createControl } = require("../control/server");
const { enrollDevice } = require("../scripts/enroll-device");
const { parseEnv } = require("node:util");
const { installClient } = require("../scripts/install-client");
const credentials = { admin: "a".repeat(64), inspect: "b".repeat(64), telemetry: "c".repeat(64) };
async function fixture(t) {
  const tmp = await temporary(); t.after(tmp.cleanup);
  let now = Date.now();
  const control = createControl({ directory: tmp.root, credentials, now: () => now });
  const server = control.app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = (route, token = credentials.admin, body, method = body === undefined ? "GET" : "POST") => fetch(url + route, { method, headers: { "X-DLP-Token": token, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const register = async name => {
    const { invitation } = control.devices.invite({ name, platform: "linux", serverUrl: url, allowLabHttp: true });
    const r = await request("/v1/enroll", "", { ...invitation, platform: "linux", hostname: "mismo-host", version: "3" });
    assert.equal(r.status, 200); return { invitation, ...await r.json() };
  };
  return { tmp, control, request, register, url, advance: ms => { now += ms; } };
}
test("inscripción de un solo uso: plataforma, caducidad, persistencia y ausencia de secretos", async t => {
  const f = await fixture(t);
  assert.equal((await f.request("/v1/admin/devices", credentials.telemetry, {})).status, 401);
  const created = await f.request("/v1/admin/devices", credentials.admin, { name: "WIN-01", platform: "win32", serverUrl: "https://central.example.test" });
  assert.equal(created.status, 201); const { invitation } = await created.json();
  assert.equal((await f.request("/v1/enroll", "", { ...invitation, hostname: "puesto", platform: "linux" })).status, 400);
  const enrolled = await f.request("/v1/enroll", "", { ...invitation, hostname: "puesto", platform: "win32" });
  assert.equal(enrolled.status, 200); const tokens = await enrolled.json();
  assert.equal((await f.request("/v1/enroll", "", { ...invitation, hostname: "puesto", platform: "win32" })).status, 400);
  const disk = await fs.readFile(path.join(f.tmp.root, "equipos.json"), "utf8");
  const audit = await fs.readFile(f.control.audit.file, "utf8");
  for (const secret of [invitation.token, tokens.inspectToken, tokens.telemetryToken]) { assert.ok(!disk.includes(secret)); assert.ok(!audit.includes(secret)); }
  const store = new DeviceStore(f.tmp.root); assert.equal(store.authenticate(tokens.inspectToken, "inspect").id, tokens.deviceId);
  assert.equal(store.authenticate(tokens.inspectToken, "admin"), null);
  const pending = store.invite({ name: "LIN-02", platform: "linux", serverUrl: "https://central.example.test" });
  const future = new DeviceStore(f.tmp.root, { now: () => Date.now() + 31 * 60000 });
  assert.throws(() => future.enroll({ ...pending.invitation, hostname: "kali", platform: "linux" }), /caducada/);
});
test("credenciales por equipo: no suplantan reportes ni recibos; revocación individual", async t => {
  const f = await fixture(t), a = await f.register("LIN-01"), b = await f.register("LIN-02");
  assert.notEqual(a.inspectToken, b.inspectToken);
  assert.equal((await f.request("/v1/telemetry", a.telemetryToken, { device: b.deviceId, events: [] })).status, 403);
  assert.equal((await f.request("/v1/telemetry", credentials.telemetry, { device: a.deviceId, events: [] })).status, 403);
  assert.equal((await f.request("/v1/admin/status", a.inspectToken)).status, 401);
  const payload = { device: b.deviceId, channel: "browser_file", destination: "https://destino.example.test", parts: [{ name: "privado.txt", base64: Buffer.from("DNI: 12345678").toString("base64") }] };
  const decision = await (await f.request("/v1/inspect", a.inspectToken, payload)).json();
  assert.equal(decision.allowed, false); assert.equal(f.control.audit.events.at(-1).device, a.deviceId);
  assert.equal((await f.request("/v1/receipts", b.inspectToken, { ticket: decision.ticket, outcome: "CANCELLED" })).status, 403);
  assert.equal((await f.request("/v1/receipts", credentials.inspect, { ticket: decision.ticket, outcome: "CANCELLED" })).status, 403);
  assert.equal((await f.request("/v1/receipts", a.inspectToken, { ticket: decision.ticket, outcome: "CANCELLED" })).status, 200);
  await f.request(`/v1/admin/devices/${a.deviceId}/revoke`, credentials.admin, {});
  assert.equal((await f.request("/v1/config", a.inspectToken)).status, 401);
  assert.equal((await f.request("/v1/config", b.inspectToken)).status, 200);
  assert.equal(new DeviceStore(f.tmp.root).authenticate(a.telemetryToken, "telemetry"), null);
});
test("vista por equipo filtra antes del límite; latidos vacíos actualizan estado y sobreviven reinicio", async t => {
  const f = await fixture(t), a = await f.register("LIN-01"), b = await f.register("LIN-02");
  await f.request("/v1/telemetry", a.telemetryToken, { device: a.deviceId, platform: "linux", hostname: "kali", startMode: "SYSTEMD_USER", events: [{ id: "1", file: "solo-a.txt", decision: "ALERTA" }] });
  for (let i = 0; i < 320; i++) f.control.audit.record({ device: b.deviceId, activity: "OTRO_EQUIPO", prevented: false });
  const status = await (await f.request("/v1/admin/status?device=" + a.deviceId)).json();
  assert.ok(status.events.some(e => e.file === "solo-a.txt")); assert.ok(status.events.every(e => e.device === a.deviceId));
  assert.equal(status.agents.find(d => d.id === a.deviceId).connection, "ONLINE");
  f.advance(31000); assert.equal(f.control.devices.list().find(d => d.id === a.deviceId).connection, "STALE");
  f.advance(90001); assert.equal(f.control.devices.list().find(d => d.id === a.deviceId).connection, "OFFLINE");
  await f.request("/v1/telemetry", a.telemetryToken, { device: a.deviceId, events: [] });
  const reloaded = new DeviceStore(f.tmp.root, { now: () => Date.now() + 121001 });
  assert.equal(reloaded.list().find(d => d.id === a.deviceId).connection, "ONLINE");
});
test("cliente guarda identidad y respaldo privado sin clave Groq ni ADMIN del servidor", async t => {
  const f = await fixture(t), root = path.join(f.tmp.root, "cliente"); await fs.mkdir(root);
  await fs.writeFile(path.join(root, ".env"), "GROQ_API_KEY=FICTICIA\nDLP_CONTROL_ADMIN_TOKEN=FICTICIO\nDLP_AGENT_PORT=3001\n");
  const { invitation } = f.control.devices.invite({ name: "LIN-01", platform: "linux", serverUrl: f.url, allowLabHttp: true });
  const result = await enrollDevice(invitation, { root, platform: "linux", hostname: "kali" });
  const env = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
  assert.equal(env.DLP_DEVICE_ID, result.deviceId); assert.equal(env.DLP_AGENT_PORT, "3001");
  assert.equal(env.GROQ_API_KEY, undefined); assert.equal(env.DLP_CONTROL_ADMIN_TOKEN, undefined);
  assert.equal((await f.request("/v1/config", env.DLP_INSPECT_TOKEN)).status, 200);
  await assert.rejects(enrollDevice(invitation, { root, platform: "linux", hostname: "kali" }), /rechazó/);
  assert.equal(parseEnv(await fs.readFile(path.join(root, ".env"), "utf8")).DLP_DEVICE_ID, result.deviceId);
});

test("detalle de sensores y procesos se conserva por identidad y excluye objetos libres", async t => {
  const f = await fixture(t), a = await f.register("LIN-01"), b = await f.register("LIN-02");
  const response = await f.request("/v1/telemetry", a.telemetryToken, {
    device: a.deviceId, sensors: { process: { available: true, count: 1, processes: [{ processId: 42, program: "firefox", cmdline: "NO_PERSISTIR" }] }, browser: { activeClients: 1, navigationClients: 1 }, universalInterception: true, content: "NO_PERSISTIR" },
    events: [{ id: "detalle-1", activity: "PROCESO_INICIADO", program: "firefox", processId: 42, semanticStatus: "COMPLETE", content: "NO_PERSISTIR" }],
  });
  assert.equal(response.status, 200);
  f.control.audit.record({ device: a.deviceId, channel: "filesystem", activity: "CLASIFICACION_EN_REPOSO", semanticStatus: "COMPLETE", prevented: false });
  const status = await (await f.request("/v1/admin/status?device=" + a.deviceId)).json();
  const agent = status.agents.find(d => d.id === a.deviceId);
  assert.equal(agent.sensors.process.processes[0].program, "firefox"); assert.equal(agent.sensors.universalInterception, false);
  assert.equal(agent.semantic.complete, 1); // No cuenta de nuevo el resultado reportado por el agente.
  assert.equal(status.agents.find(d => d.id === b.deviceId).semantic, null);
  assert.equal(status.events.find(e => e.sourceEventId === "detalle-1").processId, 42);
  const disk = await fs.readFile(path.join(f.tmp.root, "equipos.json"), "utf8");
  assert.ok(!disk.includes("NO_PERSISTIR")); assert.ok(!JSON.stringify(status).includes("NO_PERSISTIR"));
  assert.equal(new DeviceStore(f.tmp.root).public(new DeviceStore(f.tmp.root).get(a.deviceId)).sensors.browser.navigationClients, 1);
});

test("instalador unificado no consume invitación con agente manual y reintenta servicio sin reinscribir", async t => {
  const f = await fixture(t), root = path.join(f.tmp.root, "puesto");
  await fs.mkdir(path.join(root, "node_modules/express"), { recursive: true });
  const { invitation } = f.control.devices.invite({ name: "LIN-INSTALACION", platform: "linux", serverUrl: f.url, allowLabHttp: true });
  const file = path.join(f.tmp.root, "invitacion.json"); await fs.writeFile(file, JSON.stringify(invitation));
  const options = { root, platform: "linux", hostname: "kali", checkPort: async () => true, execute: () => { throw new Error("No ejecutar"); } };
  await assert.rejects(installClient(file, options), /Ctrl\+C/);
  assert.equal(f.control.devices.get(invitation.deviceId).enrolledAt, null);
  await assert.rejects(installClient(file, { ...options, checkPort: async () => false, execute: () => { throw new Error("BUS_SIMULADO_NO_DISPONIBLE"); } }), /BUS_SIMULADO/);
  assert.ok(f.control.devices.get(invitation.deviceId).enrolledAt);
  const commands = [];
  const result = await installClient(file, { ...options, checkPort: async () => false, execute: args => commands.push(args) });
  assert.equal(result.alreadyEnrolled, true); assert.equal(commands.length, 1);
  assert.equal(f.control.audit.events.filter(e => e.activity === "EQUIPO_INSCRITO").length, 1);
});
