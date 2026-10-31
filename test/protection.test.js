"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { temporary, FakeBridge } = require("./helpers/fixtures.cjs");
const { restrictedPolicy } = require("../scripts/protection-profile");
const { validatePolicy, destinationDecision } = require("../control/policy");
const { EndpointRuntime } = require("../endpoint/runtime");
const { protectionStatus } = require("../endpoint/protection");
const { createControl } = require("../control/server");
const credentials = { admin: "a".repeat(64), inspect: "b".repeat(64), telemetry: "c".repeat(64) };
test("perfil estricto: destino autorizado no implica autorizar todas las webs, ni escrituras sin cuerpo", () => {
  const policy = restrictedPolicy(["sink.dlp.test"]);
  for (const destination of ["https://conversor.example/upload", "https://discord.com/api/attachments", "https://sink.dlp.test.evil.test/upload"]) {
    const denied = destinationDecision({ channel: "web_proxy", destination, parts: [{ name: "publico.txt" }], outboundWrite: true }, policy);
    assert.equal(denied.allowed, false); assert.equal(denied.cause, "DESTINATION");
  }
  assert.equal(destinationDecision({ channel: "web_proxy", destination: "https://conversor.example/upload", parts: [], outboundWrite: true }, policy).allowed, false);
  assert.equal(destinationDecision({ channel: "web_proxy", destination: "https://sink.dlp.test/upload", parts: [{ name: "privado.txt" }] }, policy), null);
  assert.throws(() => restrictedPolicy(["*"]), /explícitos/);
  const lax = structuredClone(policy); lax.policies.browser_file.mode = "audit";
  assert.throws(() => validatePolicy(lax), /enforce/);
});
test("la configuración del firewall caducada, ajena o solo aplicada nunca se presenta como verificada", async t => {
  const temp = await temporary(); t.after(temp.cleanup);
  const now = Date.now();
  const file = path.join(temp.root, "proteccion-verificacion.json");
  assert.equal(protectionStatus(temp.root).state, "NOT_APPLIED");
  await fs.writeFile(path.join(temp.root, "proteccion-respaldo.json"), "{}");
  assert.equal(protectionStatus(temp.root).state, "AUDIT_REQUIRED");
  const receipt = { state: "CONFIGURATION_VERIFIED", configurationVerified: true, checkedAt: new Date(now).toISOString(), host: os.hostname() };
  await fs.writeFile(file, JSON.stringify(receipt));
  assert.equal(protectionStatus(temp.root, now).configurationVerified, true);
  assert.equal(protectionStatus(temp.root, now + 6 * 60 * 1000).configurationVerified, false);
  await fs.writeFile(file, JSON.stringify({ ...receipt, host: "otro-equipo" }));
  assert.equal(protectionStatus(temp.root, now).configurationVerified, false);
  await fs.writeFile(file, JSON.stringify({ ...receipt, state: "APPLIED_UNVERIFIED" }));
  assert.equal(protectionStatus(temp.root, now).configurationVerified, false);
});
test("inventario semántico: detecta contexto, conserva pendientes y avanza la cola sin bloquear por clasificar", async t => {
  const prior = process.env.DLP_LLM_MODE; process.env.DLP_LLM_MODE = "hybrid";
  t.after(() => { if (prior === undefined) delete process.env.DLP_LLM_MODE; else process.env.DLP_LLM_MODE = prior; });
  const temp = await temporary(); t.after(temp.cleanup);
  const root = path.join(temp.root, "fuente"); await fs.mkdir(root);
  for (const name of ["a.txt", "b.txt", "c.txt"]) await fs.writeFile(path.join(root, name), "Información de ejemplo sin patrones locales");
  let calls = 0;
  const runtime = new EndpointRuntime({ dataDirectory: path.join(temp.root, "estado"), bridge: new FakeBridge(), config: { watchRoots: [root], semanticFilesPerScan: 1 }, classifyAtRest: async (buffer, name) => {
    calls += 1;
    if (name === "a.txt") return { semantic: { required: true, status: "ERROR" } };
    return { sha256: crypto.createHash("sha256").update(buffer).digest("hex"), inspectionStatus: "COMPLETE", classification: "CONFIDENCIAL", score: 3, matches: [{ id: "LLM-001", points: 3 }], semantic: { required: true, status: "COMPLETE" } };
  } });
  t.after(() => runtime.stop());
  await runtime.scan();
  assert.equal(calls, 1); assert.equal(runtime.status().inventory.unknown, 3);
  assert.ok([...runtime.inventory.values()].every(v => v.classification === "PENDIENTE"));
  await runtime.scan(); await runtime.scan();
  assert.equal(calls, 3); assert.equal(runtime.status().inventory.sensitive, 2); assert.equal(runtime.status().inventory.unknown, 1);
  assert.ok(runtime.audit.events.every(e => e.prevented !== true));
  await fs.writeFile(path.join(root, "b.txt"), "Horario público actualizado");
  await runtime.scan(); assert.equal(calls, 4);
});
test("clasificación central en reposo: autentica, devuelve el hash y no crea tickets ni registros de envío", async t => {
  const temp = await temporary(); t.after(temp.cleanup);
  const control = createControl({ directory: temp.root, credentials });
  const server = control.app.listen(0, "127.0.0.1"); await new Promise(r => server.once("listening", r));
  t.after(() => new Promise(r => { server.close(r); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/v1/classify`;
  const payload = { name: "ficticio.txt", base64: Buffer.from("DNI: 12345678").toString("base64") };
  assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-DLP-Token": credentials.telemetry }, body: JSON.stringify(payload) })).status, 401);
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-DLP-Token": credentials.inspect }, body: JSON.stringify(payload) });
  assert.equal(response.status, 200);
  const { inspection } = await response.json(); assert.equal(inspection.classification, "CONFIDENCIAL");
  assert.equal(control.tickets.size, 0); assert.equal(control.audit.events.at(-1).evidence, "CLASSIFICATION_ONLY");
  assert.ok(!(await fs.readFile(control.audit.file, "utf8")).includes("12345678"));
});
