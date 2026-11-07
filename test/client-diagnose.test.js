"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { temporary } = require("./helpers/fixtures.cjs");
const { diagnose } = require("../scripts/client-diagnose");
const { AuditLog } = require("../lib/audit");
const { loadState } = require("../endpoint/config");

test("diagnóstico identifica JSON y codificación sin mostrar secretos ni cambiar archivos", async t => {
  const tmp = await temporary(); t.after(tmp.cleanup);
  const directory = path.join(tmp.root, "datos-endpoint"); await fs.mkdir(directory);
  await fs.writeFile(path.join(tmp.root, ".env"), "DLP_STRICT_LAB=1\nDLP_INSPECT_TOKEN=NO_MOSTRAR_TOKEN\n");
  const config = path.join(directory, "config.json"), credentials = path.join(directory, "credenciales.json");
  await fs.writeFile(config, '\ufeff{"dato":"NO_MOSTRAR_CONFIG"}');
  await fs.writeFile(credentials, '{"browser":"NO_MOSTRAR_CREDENCIAL",');
  const before = await Promise.all([fs.readFile(config), fs.readFile(credentials)]);
  const report = diagnose(tmp.root), serialized = JSON.stringify(report);
  assert.equal(report.readOnly, true); assert.equal(report.strictConfigured, true);
  assert.equal(report.checks.find(c => c.file === "config.json").encoding, "UTF8_BOM");
  assert.equal(report.checks.find(c => c.file === "credenciales.json").status, "JSON_INVALID");
  assert.ok(!serialized.includes("NO_MOSTRAR"));
  assert.deepEqual(await Promise.all([fs.readFile(config), fs.readFile(credentials)]), before);
  assert.throws(() => loadState(directory), e => e.code === "DLP_STATE_JSON_INVALID" && e.message.includes("config.json") && !e.message.includes("NO_MOSTRAR"));
});

test("auditoría truncada identifica la línea sin reparar ni descartar evidencia; cadena alterada sigue bloqueada", async t => {
  const tmp = await temporary(); t.after(tmp.cleanup);
  await fs.writeFile(path.join(tmp.root, ".env"), "");
  const directory = path.join(tmp.root, "datos-endpoint"), audit = new AuditLog(directory);
  audit.record({ channel: "test", activity: "PRUEBA", prevented: false });
  const valid = await fs.readFile(audit.file, "utf8");
  await fs.appendFile(audit.file, '{"content":"NO_MOSTRAR_AUDITORIA",');
  const before = await fs.readFile(audit.file);
  const report = diagnose(tmp.root), check = report.checks.find(c => c.file === "auditoria.jsonl");
  assert.equal(check.status, "JSON_INVALID"); assert.equal(check.line, 2); assert.equal(check.validatedRecords, 1);
  assert.ok(!JSON.stringify(report).includes("NO_MOSTRAR")); assert.deepEqual(await fs.readFile(audit.file), before);
  assert.throws(() => new AuditLog(directory), e => e.message.includes("auditoria.jsonl; línea 2") && !e.message.includes("NO_MOSTRAR"));
  await fs.writeFile(audit.file, valid.replace('"PRUEBA"', '"ALTERADO"'));
  assert.equal(diagnose(tmp.root).checks.find(c => c.file === "auditoria.jsonl").status, "AUDIT_CHAIN_INVALID");
  assert.throws(() => new AuditLog(directory), /no es íntegra/);
});
