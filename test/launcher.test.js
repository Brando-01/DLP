"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { runAll, centralStatus } = require("../scripts/run-all");
const { createControl } = require("../control/server");
const { startEndpoint } = require("../endpoint/server");
const { EndpointRuntime } = require("../endpoint/runtime");
const { temporary, FakeBridge } = require("./helpers/fixtures.cjs");
async function fixture(t) {
  const temp = await temporary(); t.after(temp.cleanup);
  const source = path.join(temp.root, "protegidos"); await fs.mkdir(source);
  return { root: temp.root, ports: { agent: 0, site: 0, receiver: 0 }, prepare: async () => {}, readProtection: async () => ({ state: "NOT_APPLIED", configurationVerified: false }), log: () => {}, startEndpoint: async options => startEndpoint({ ...options, runtime: new EndpointRuntime({ dataDirectory: options.dataDirectory, bridge: new FakeBridge(), config: { watchRoots: [source], inventorySemantic: false } }) }) };
}
test("un arranque reúne agente y receptores, avisa de cobertura incompleta y detiene recursos propios", async t => {
  const options = await fixture(t); let stopped = 0; const messages = [];
  const service = await runAll({ ...options, log: value => messages.push(value), startBackend: async () => ({ url: "http://127.0.0.1:3100", stop: async () => { stopped += 1; } }) });
  t.after(service.stop);
  const agent = `http://127.0.0.1:${service.endpoint.server.address().port}`;
  assert.equal((await fetch(agent + "/api/health")).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${service.siteServer.address().port}`)).status, 200);
  const status = service.endpoint.runtime.status();
  assert.equal(status.session.mode, "INTEGRATED");
  assert.equal(status.session.systemConfigurationVerified, false);
  assert.equal(status.session.nativeSensitiveOnly, false);
  assert.ok(messages.some(m => m.includes("COBERTURA INCOMPLETA")));
  await service.stop(); await service.stop(); assert.equal(stopped, 1);
  assert.equal(service.endpoint.server.listening, false); assert.equal(service.siteServer.listening, false); assert.equal(service.receiverServer.listening, false);
});
test("el modo que exige controles del sistema rechaza el arranque si no están verificados", async t => {
  const options = await fixture(t); let prepared = false, launched = false;
  await assert.rejects(runAll({ ...options, requireSystemControls: true, prepare: async () => { prepared = true; }, startBackend: async () => { launched = true; } }), /PROTECCIÓN INCOMPLETA/);
  assert.equal(prepared, false); assert.equal(launched, false);
});
test("un puerto ocupado no provoca cierre de servicios ajenos ni arranque parcial", async t => {
  const options = await fixture(t); let launched = false;
  const prior = http.createServer((req, res) => res.end("SERVICIO_AJENO")); prior.listen(0, "127.0.0.1");
  await new Promise(r => prior.once("listening", r)); t.after(() => new Promise(r => prior.close(r)));
  const port = prior.address().port;
  await assert.rejects(runAll({ ...options, ports: { ...options.ports, agent: port }, startBackend: async () => { launched = true; } }), /ocupado/);
  assert.equal(launched, false); assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "SERVICIO_AJENO");
});
test("un fallo al iniciar el agente limpia los receptores y el backend propios", async t => {
  const options = await fixture(t); let stopped = 0;
  await assert.rejects(runAll({ ...options, startBackend: async () => ({ url: "http://127.0.0.1:3100", stop: async () => { stopped += 1; } }), startEndpoint: async () => { throw new Error("FALLO_FICTICIO"); } }), /FALLO_FICTICIO/);
  assert.equal(stopped, 1);
});
test("cancelar durante el backend no inicia el agente ni deja el backend propio abierto", async t => {
  const options = await fixture(t); const abort = new AbortController(); let stopped = 0, launched = false;
  await assert.rejects(runAll({ ...options, signal: abort.signal, startBackend: async () => { abort.abort(); return { url: "http://127.0.0.1:3100", stop: async () => { stopped += 1; } }; }, startEndpoint: async () => { launched = true; } }), /abort/i);
  assert.equal(stopped, 1); assert.equal(launched, false);
});
test("el arranque verifica el central con credencial de inspección, sin necesitar ADMIN", async t => {
  const temp = await temporary(); t.after(temp.cleanup);
  const prior = { DLP_CONTROL_URL: process.env.DLP_CONTROL_URL, DLP_INSPECT_TOKEN: process.env.DLP_INSPECT_TOKEN, DLP_CONTROL_ADMIN_TOKEN: process.env.DLP_CONTROL_ADMIN_TOKEN };
  t.after(() => { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const credentials = { admin: "a".repeat(64), inspect: "b".repeat(64), telemetry: "c".repeat(64) };
  const control = createControl({ directory: temp.root, credentials });
  const server = control.app.listen(0, "127.0.0.1"); await new Promise(r => server.once("listening", r));
  t.after(() => new Promise(r => { server.close(r); server.closeAllConnections(); }));
  process.env.DLP_CONTROL_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.DLP_INSPECT_TOKEN = credentials.inspect;
  delete process.env.DLP_CONTROL_ADMIN_TOKEN;
  assert.equal((await centralStatus()).inspectorReady, true);
  process.env.DLP_INSPECT_TOKEN = "d".repeat(64);
  await assert.rejects(centralStatus(), /credenciales/);
});
