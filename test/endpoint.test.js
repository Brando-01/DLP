"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { EndpointRuntime } = require("../endpoint/runtime");
const { createEndpointApp } = require("../endpoint/server");
const { createReceiver } = require("../endpoint/receiver");
const { AuditLog } = require("../lib/audit");
const { temporary, FakeBridge } = require("./helpers/fixtures.cjs");

async function fixture(t, adapters) {
  const temporaryFiles = await temporary();
  const protectedRoot = path.join(temporaryFiles.root, "protegidos");
  await fs.mkdir(protectedRoot);
  await fs.writeFile(path.join(protectedRoot, "publico.txt"), "Horario público de biblioteca");
  await fs.writeFile(path.join(protectedRoot, "privado.txt"), "CLASIFICACION: CONFIDENCIAL");
  await fs.writeFile(path.join(protectedRoot, "alerta.txt"), "Contacto: ana@universidad.edu.pe");
  const bridge = new FakeBridge();
  const runtime = new EndpointRuntime({ dataDirectory: path.join(temporaryFiles.root, "estado"), bridge, adapters, config: { watchRoots: [protectedRoot], clipboardMonitor: true, notifications: false, targets: [{ id: "usb", channel: "usb", name: "USB de laboratorio", path: path.join(temporaryFiles.root, "salida"), lab: true }] } });
  t.after(async () => { await runtime.stop(); await temporaryFiles.cleanup(); });
  await runtime.scan();
  const item = (name) => [...runtime.inventory.values()].find((file) => file.name === name);
  return { runtime, bridge, item, root: temporaryFiles.root, protectedRoot };
}
test("inventaría documentos fuera del portal y detecta modificaciones y nuevas sensibilidades", async (t) => {
  const { runtime, item, protectedRoot } = await fixture(t);
  assert.equal(runtime.inventory.size, 3);
  assert.equal(item("publico.txt").classification, "PUBLICO");
  await fs.writeFile(path.join(protectedRoot, "publico.txt"), "DNI: 12345678");
  await runtime.scan(true);
  assert.equal(item("publico.txt").classification, "CONFIDENCIAL");
  assert.ok(runtime.audit.events.some((e) => e.activity === "CLASIFICAR_ARCHIVO" && e.file === "publico.txt" && e.detected));
});
test("USB mediado: permite bytes públicos exactos y no escribe archivos bloqueados", async (t) => {
  const { runtime, item, root } = await fixture(t);
  const allowed = await runtime.transfer({ fileId: item("publico.txt").id, targetId: "usb" });
  assert.equal(allowed.outcome, "COMPLETED");
  const blocked = await runtime.transfer({ fileId: item("privado.txt").id, targetId: "usb" });
  assert.equal(blocked.prevented, true);
  assert.equal(blocked.evidence, "LAB_CONTROLLED_OPERATION");
  assert.equal((await fs.readdir(path.join(root, "salida"))).length, 1);
  assert.equal(await fs.readFile(allowed.receipt.storedPath, "utf8"), "Horario público de biblioteca");
});

test("el vigilante detecta una creación sin carga al portal ni escaneo manual", async (t) => {
  const { runtime, protectedRoot } = await fixture(t);
  await runtime.start();
  await fs.writeFile(path.join(protectedRoot, "nuevo.txt"), "DNI: 12345678");
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && ![...runtime.inventory.values()].some((f) => f.name === "nuevo.txt")) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok([...runtime.inventory.values()].some((f) => f.name === "nuevo.txt" && f.classification === "CONFIDENCIAL"));
});

test("un portapapeles truncado o vacío nunca se informa como inspección completa", async (t) => {
  const { runtime, protectedRoot } = await fixture(t);
  await runtime.handleNative({ type: "clipboard", kind: "files", files: [path.join(protectedRoot, "publico.txt")], partial: true });
  assert.equal(runtime.audit.events.at(-1).inspectionStatus, "PARTIAL");
  assert.equal(runtime.audit.events.at(-1).prevented, false);
  await runtime.handleNative({ type: "clipboard", kind: "files", files: [] });
  assert.equal(runtime.audit.events.at(-1).decision, "NO_ANALIZABLE");
});
test("una alerta y una detección en auditoría sí permiten la operación", async (t) => {
  const { runtime, item } = await fixture(t);
  const alert = await runtime.transfer({ fileId: item("alerta.txt").id, targetId: "usb" });
  assert.equal(alert.decision, "ALERTA");
  assert.equal(alert.outcome, "COMPLETED");
  await runtime.updateConfig({ ...runtime.config, policies: { ...runtime.config.policies, usb: { mode: "audit", blockScore: 3 } } });
  const detected = await runtime.transfer({ fileId: item("privado.txt").id, targetId: "usb" });
  assert.equal(detected.decision, "DETECTADO");
  assert.equal(detected.outcome, "COMPLETED");
  assert.equal(detected.prevented, false);
});
test("impresión y portapapeles mediados no invocan Windows cuando se bloquea", async (t) => {
  const { runtime, item, bridge } = await fixture(t);
  for (const channel of ["clipboard", "print"]) {
    const result = await runtime.transfer({ fileId: item("privado.txt").id, channel, printer: "Impresora de prueba" });
    assert.equal(result.prevented, true);
  }
  assert.equal(bridge.calls.length, 0);
  const result = await runtime.transfer({ fileId: item("publico.txt").id, channel: "clipboard" });
  assert.equal(result.outcome, "COMPLETED");
  assert.equal(bridge.calls[0].action, "writeClipboard");
});
test("observar y limpiar el portapapeles nativo no se registra como prevención", async (t) => {
  const { runtime, bridge } = await fixture(t);
  runtime.config.clipboardRemediation = true;
  await runtime.handleNative({ type: "clipboard", kind: "text", text: "CLASIFICACION: CONFIDENCIAL", sequence: 123, process: "notepad" });
  const events = runtime.audit.events.filter((e) => e.channel === "clipboard_observed");
  assert.equal(events.length, 2);
  assert.ok(events.every((event) => event.prevented === false));
  assert.equal(events[1].outcome, "REMEDIATED");
  assert.equal(bridge.calls[0].action, "clearClipboard");
  assert.ok(!JSON.stringify(events).includes("CLASIFICACION: CONFIDENCIAL"));
});
test("reclasifica el archivo al transferir y no confía en el inventario antiguo", async (t) => {
  const { runtime, item, protectedRoot, root } = await fixture(t);
  const id = item("publico.txt").id;
  await fs.writeFile(path.join(protectedRoot, "publico.txt"), "DNI: 12345678");
  const blocked = await runtime.transfer({ fileId: id, targetId: "usb" });
  assert.equal(blocked.prevented, true);
  await assert.rejects(fs.readdir(path.join(root, "salida")), { code: "ENOENT" });
});
test("el receptor HTTP no recibe los bytes de una solicitud bloqueada", async (t) => {
  const { runtime, item, root } = await fixture(t);
  const receiver = createReceiver(path.join(root, "receptor"));
  const server = receiver.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  runtime.config.targets.push({ id: "http", channel: "http_transfer", name: "HTTP de prueba", url: `http://127.0.0.1:${server.address().port}/upload`, lab: true });
  const blocked = await runtime.transfer({ fileId: item("privado.txt").id, targetId: "http" });
  assert.equal(blocked.prevented, true);
  assert.equal(receiver.receipts.length, 0);
  const allowed = await runtime.transfer({ fileId: item("publico.txt").id, targetId: "http" });
  assert.equal(allowed.outcome, "COMPLETED");
  assert.equal(receiver.receipts[0].sha256, allowed.sha256);
});
test("el API local separa el token del navegador, bloquea CORS ajeno y Host de rebinding", async (t) => {
  const { runtime } = await fixture(t);
  const server = createEndpointApp(runtime).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + "/api/config")).status, 401);
  assert.equal((await fetch(base + "/api/config", { headers: { "X-DLP-Token": runtime.credentials.browser } })).status, 401);
  assert.equal((await fetch(base + "/api/config", { headers: { "X-DLP-Token": runtime.credentials.admin } })).status, 200);
  assert.equal((await fetch(base + "/api/bootstrap", { headers: { Origin: "https://example.com" } })).status, 403);
  const rebindingStatus = await new Promise((resolve, reject) => {
    const request = http.get(base + "/api/bootstrap", { headers: { Host: "attacker.example" } }, (response) => { response.resume(); resolve(response.statusCode); });
    request.on("error", reject);
  });
  assert.equal(rebindingStatus, 403);
  const browser = await fetch(base + "/api/browser/config", { headers: { "X-DLP-Token": runtime.credentials.browser, Origin: "chrome-extension://" + "a".repeat(32) } });
  assert.equal(browser.status, 200);
  assert.equal(browser.headers.get("access-control-allow-origin"), "chrome-extension://" + "a".repeat(32));
});
test("la decisión del navegador no se confunde con un bloqueo ejecutado", async (t) => {
  const { runtime } = await fixture(t);
  const result = await runtime.inspectBrowser({ channel: "browser_paste", text: "DNI: 12345678", url: "https://example.com/form" });
  assert.equal(result.allowed, false);
  assert.equal(runtime.audit.events.at(-1).prevented, null);
  const receipt = await runtime.completeBrowser({ ticket: result.ticket, outcome: "CANCELLED" });
  assert.equal(receipt.prevented, true);
  assert.equal(runtime.audit.events.at(-1).evidence, "BROWSER_CLIENT_REPORT");
  await assert.rejects(() => runtime.completeBrowser({ ticket: result.ticket, outcome: "CANCELLED" }), /ausente o caducada/);
});
test("alterar el registro se detecta antes de nuevas operaciones", async (t) => {
  const temporaryFiles = await temporary(); t.after(temporaryFiles.cleanup);
  const audit = new AuditLog(temporaryFiles.root);
  audit.record({ channel: "test", decision: "BLOQUEADO", text: "no debe guardarse" });
  const original = await fs.readFile(audit.file, "utf8");
  assert.ok(!original.includes("no debe guardarse"));
  await fs.writeFile(audit.file, original.replace("BLOQUEADO", "PERMITIDO"));
  assert.equal(audit.status().chainValid, false);
  assert.throws(() => audit.record({ channel: "test" }), /Auditoría alterada/);
  assert.throws(() => new AuditLog(temporaryFiles.root), /no es íntegra/);
});
