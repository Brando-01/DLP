"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createControl } = require("../control/server");
const { temporary, docxBuffer, xlsxBuffer } = require("./helpers/fixtures.cjs");
const { inspectBuffer } = require("../lib/inspection");
const { EndpointRuntime } = require("../endpoint/runtime");
const { FakeBridge } = require("./helpers/fixtures.cjs");
const { CopyMonitor } = require("../endpoint/copy-monitor");
const credentials = { admin: "a".repeat(64), inspect: "b".repeat(64), telemetry: "c".repeat(64) };

test("evasión: DOCX/XLSX renombrados y base64 se inspeccionan por contenido real", async () => {
  for (const [bytes, name] of [[await docxBuffer("DNI: 12345678"), "imagen.jpg"], [await xlsxBuffer([["DNI"], ["12345678"]]), "foto.png"], [Buffer.from(Buffer.from("DNI: 12345678\nRegistro privado ficticio").toString("base64")), "codificado.txt"]]) {
    const result = await inspectBuffer(bytes, name);
    assert.equal(result.inspectionStatus, "COMPLETE"); assert.ok(result.score >= 3);
    assert.ok(result.formatMismatch || result.transformations.includes("BASE64_DECODED"));
  }
  const sevenzip = await inspectBuffer(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0]), "cifrado.txt");
  assert.equal(sevenzip.inspectionStatus, "UNANALYZABLE");
});
test("control central: autenticación por función, política y recibo separados", async (t) => {
  const temporaryFiles = await temporary(); t.after(temporaryFiles.cleanup);
  const control = createControl({ directory: temporaryFiles.root, credentials });
  const server = control.app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = (route, token, data, method = "POST") => fetch(url + route, { method, headers: { "X-DLP-Token": credentials[token], "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined });
  assert.equal((await request("/v1/admin/status", "inspect", null, "GET")).status, 401);
  const payload = { channel: "web_proxy", destination: "https://example.test/?secreto=no-registrar", parts: [{ name: "ficticio.txt", base64: Buffer.from("DNI: 12345678").toString("base64") }] };
  const decision = await (await request("/v1/inspect", "inspect", payload)).json();
  assert.equal(decision.allowed, false); assert.equal(control.audit.events.at(-1).prevented, null);
  assert.equal((await request("/v1/receipts", "inspect", { ticket: decision.ticket, outcome: "RELEASED" })).status, 400);
  assert.equal((await request("/v1/receipts", "inspect", { ticket: decision.ticket, outcome: "CANCELLED" })).status, 200);
  assert.equal(control.audit.events.at(-1).prevented, true);
  const log = await fs.readFile(control.audit.file, "utf8"); assert.ok(!log.includes("no-registrar")); assert.ok(!log.includes("12345678")); assert.ok(!log.includes(credentials.inspect));
  const feed = (await fs.readFile(control.audit.siemFile, "utf8")).trim().split("\n").map(JSON.parse);
  assert.ok(feed.length > 0); assert.ok(feed.every((event) => !Object.hasOwn(event, "files"))); assert.equal(feed.at(-1).prevented, true);
  const telemetry = await request("/v1/telemetry", "telemetry", { device: "pc-ficticia", events: [{ decision: "BLOQUEADO", prevented: true, text: "SECRETO", token: "otro" }] });
  assert.equal(telemetry.status, 200); assert.equal(control.audit.events.at(-1).prevented, false); assert.equal(control.audit.events.at(-1).reportedPrevented, true);
  const report = { device: "pc-ficticia", events: [{ id: "id-reintento", decision: "ALERTA" }] };
  assert.equal((await (await request("/v1/telemetry", "telemetry", report)).json()).accepted, 1);
  assert.equal((await (await request("/v1/telemetry", "telemetry", report)).json()).accepted, 0);
});

test("el endpoint respeta la politica central sobre el mismo hash y retiene si deja de responder", async (t) => {
  const temporaryFiles = await temporary(); t.after(temporaryFiles.cleanup);
  const control = createControl({ directory: temporaryFiles.root, credentials });
  const server = control.app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  const keys = ["DLP_INSPECTION_BACKEND", "DLP_CONTROL_URL", "DLP_INSPECT_TOKEN"];
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => { for (const key of keys) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key]; } });
  process.env.DLP_INSPECTION_BACKEND = "central";
  process.env.DLP_CONTROL_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.DLP_INSPECT_TOKEN = credentials.inspect;
  const { managedInspection, reportCentral } = require("../lib/managed-inspection");
  const { decide } = require("../lib/policy");
  const publicFile = await managedInspection(Buffer.from("Horario del laboratorio"), "horario.txt", "usb", "endpoint://usb");
  assert.equal(decide(publicFile, "usb").allowed, true);
  assert.equal(await reportCentral(publicFile, "RELEASED"), true);
  const privateFile = await managedInspection(Buffer.from("DNI: 12345678"), "privado.txt", "usb", "endpoint://usb");
  assert.equal(decide(privateFile, "usb").allowed, false);
  assert.equal(await reportCentral(privateFile, "CANCELLED"), true);
  const policy = (await (await fetch(`${process.env.DLP_CONTROL_URL}/v1/admin/status`, { headers: { "X-DLP-Token": credentials.admin } })).json()).policy;
  policy.blockedDomains = ["prohibido.test"];
  await fetch(`${process.env.DLP_CONTROL_URL}/v1/admin/policy`, { method: "PUT", headers: { "X-DLP-Token": credentials.admin, "Content-Type": "application/json" }, body: JSON.stringify(policy) });
  const deniedDestination = await managedInspection(Buffer.from("Horario"), "publico.txt", "browser_file", "https://prohibido.test/upload");
  assert.equal(deniedDestination.centralPolicy.allowed, false); assert.equal(deniedDestination.score, 0);
  assert.equal(await reportCentral(deniedDestination, "CANCELLED"), true);
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  const offline = await managedInspection(Buffer.from("Horario"), "horario.txt", "usb", "endpoint://usb");
  assert.equal(offline.semantic.status, "CENTRAL_UNAVAILABLE");
  assert.equal(decide(offline, "usb").allowed, false);
});
test("CU-02: una copia nativa se correlaciona por hash sin atribuir prevención", async (t) => {
  const temporaryFiles = await temporary(); t.after(temporaryFiles.cleanup);
  const source = path.join(temporaryFiles.root, "finanzas"), target = path.join(temporaryFiles.root, "escritorio");
  await fs.mkdir(source); await fs.mkdir(target);
  await fs.writeFile(path.join(source, "privado.txt"), "DNI: 12345678");
  const runtime = new EndpointRuntime({ dataDirectory: path.join(temporaryFiles.root, "estado"), bridge: new FakeBridge(), config: { watchRoots: [source], restrictedDestinations: [target] } });
  t.after(() => runtime.stop()); await runtime.scan();
  await fs.copyFile(path.join(source, "privado.txt"), path.join(target, "copia.txt"));
  const monitor = new CopyMonitor(runtime); await monitor.scan(); monitor.stop();
  const event = runtime.audit.events.at(-1);
  assert.equal(event.caseId, "CU-02"); assert.equal(event.activity, "COPIA_SENSIBLE_CORRELACIONADA"); assert.equal(event.prevented, false); assert.equal(event.decision, "ALERTA");
});
