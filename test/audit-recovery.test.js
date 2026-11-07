"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { temporary } = require("./helpers/fixtures.cjs");
const { AuditLog } = require("../lib/audit");
const { recoverAudit } = require("../scripts/recover-client-audit");
async function fixture(t) {
  const tmp = await temporary(); t.after(tmp.cleanup);
  const directory = path.join(tmp.root, "datos-endpoint"), audit = new AuditLog(directory);
  for (let i = 0; i < 4; i++) audit.record({ activity: "VALIDO_" + i, prevented: false });
  const prefix = await fs.readFile(audit.file);
  return { root: tmp.root, directory, audit, prefix, ensureIdle: async () => {} };
}
test("recuperación conserva bytes originales, prefijo, fragmento y evidencia; añade alerta y es idempotente", async t => {
  const f = await fixture(t), fragment = Buffer.from('{"dato":"PRIVADO_NO_IMPRIMIR",');
  await fs.appendFile(f.audit.file, fragment); const original = await fs.readFile(f.audit.file);
  const plan = await recoverAudit({ ...f, ensureIdle: () => { throw new Error("Plan no comprueba ni cambia procesos"); } });
  assert.equal(plan.recoverable, true); assert.equal(plan.line, 5); assert.equal(plan.validRecords, 4);
  assert.deepEqual(await fs.readFile(f.audit.file), original);
  const report = await recoverAudit({ ...f, apply: true });
  assert.equal(report.chainValid, true); assert.equal(report.preservedRecords, 4); assert.equal(report.totalRecords, 5);
  assert.equal(report.manualReviewRequired, true); assert.ok(!JSON.stringify(report).includes("PRIVADO_NO_IMPRIMIR"));
  const archive = path.join(f.directory, report.evidenceDirectory);
  assert.deepEqual(await fs.readFile(path.join(archive, "auditoria-original.jsonl")), original);
  assert.deepEqual(await fs.readFile(path.join(archive, "registro-final.bin")), fragment);
  const recovered = await fs.readFile(f.audit.file); assert.deepEqual(recovered.subarray(0, f.prefix.length), f.prefix);
  const audit = new AuditLog(f.directory); assert.equal(audit.status().chainValid, true);
  assert.equal(audit.events.at(-1).activity, "AUDITORIA_RECUPERADA_CON_CUARENTENA");
  assert.deepEqual(audit.events.slice(0, 4).map(e => e.id), f.audit.events.map(e => e.id));
  assert.equal((await recoverAudit({ ...f, apply: true })).alreadyValid, true);
  assert.deepEqual(await fs.readFile(f.audit.file), recovered);
});
test("rechaza JSON roto en medio y cadena alterada sin modificar evidencia", async t => {
  const f = await fixture(t), lines = f.prefix.toString().split("\n");
  await fs.writeFile(f.audit.file, [lines[0], '{"incompleto":', ...lines.slice(1)].join("\n"));
  const middle = await fs.readFile(f.audit.file);
  await assert.rejects(recoverAudit({ ...f, apply: true }), /INVALID_RECORD_NOT_LAST/);
  assert.deepEqual(await fs.readFile(f.audit.file), middle);
  await fs.writeFile(f.audit.file, f.prefix.toString().replace("VALIDO_3", "CAMBIADO"));
  const changed = await fs.readFile(f.audit.file);
  await assert.rejects(recoverAudit({ ...f, apply: true }), /HASH_CHAIN_INVALID/);
  assert.deepEqual(await fs.readFile(f.audit.file), changed);
  assert.equal(await fs.access(path.join(f.directory, "recuperacion-auditoria")).then(() => true, () => false), false);
});
test("rechaza agente activo, cambio concurrente y bloqueo previo; no toca archivos ajenos", async t => {
  const f = await fixture(t); await fs.appendFile(f.audit.file, '{"incompleto":');
  const original = await fs.readFile(f.audit.file);
  await assert.rejects(recoverAudit({ ...f, apply: true, ensureIdle: async () => { throw new Error("AGENTE_ACTIVO"); } }), /AGENTE_ACTIVO/);
  assert.deepEqual(await fs.readFile(f.audit.file), original);
  const marker = path.join(f.directory, "auditoria-recuperacion.lock"); await fs.writeFile(marker, "PROPIETARIO_AJENO");
  await assert.rejects(recoverAudit({ ...f, apply: true }), e => e.code === "EEXIST");
  assert.equal(await fs.readFile(marker, "utf8"), "PROPIETARIO_AJENO"); await fs.unlink(marker);
  await assert.rejects(recoverAudit({ ...f, apply: true, ensureIdle: async () => fs.appendFile(f.audit.file, "OTRO_CAMBIO") }), /cambió/);
  assert.equal(await fs.access(marker).then(() => true, () => false), false);
  assert.ok((await fs.readFile(f.audit.file, "utf8")).endsWith("OTRO_CAMBIO"));
});
test("mantenimiento impide abrir o escribir auditoría y no modifica registros", async t => {
  const f = await fixture(t), marker = path.join(f.directory, "auditoria-recuperacion.lock"); await fs.writeFile(marker, "MANTENIMIENTO");
  assert.throws(() => new AuditLog(f.directory), /recuperación/);
  assert.throws(() => f.audit.record({ activity: "NO_ESCRIBIR" }), /recuperación/);
  assert.deepEqual(await fs.readFile(f.audit.file), f.prefix);
});

test("comprobación real de parada rechaza PID supervisor activo y puerto local ocupado", async t => {
  const f = await fixture(t); await fs.appendFile(f.audit.file, '{"incompleto":');
  const original = await fs.readFile(f.audit.file), supervisor = path.join(f.directory, "supervisor.json");
  await fs.writeFile(supervisor, JSON.stringify({ pid: process.pid }));
  await assert.rejects(recoverAudit({ root: f.root, apply: true }), /Detén primero/);
  await fs.unlink(supervisor);
  const server = net.createServer(socket => socket.end()); server.listen(0, "127.0.0.1");
  await new Promise(r => server.once("listening", r)); t.after(() => new Promise(r => server.close(r)));
  await fs.writeFile(path.join(f.root, ".env"), "DLP_AGENT_PORT=" + server.address().port + "\n");
  await assert.rejects(recoverAudit({ root: f.root, apply: true }), /servicio local activo/);
  assert.deepEqual(await fs.readFile(f.audit.file), original);
});
