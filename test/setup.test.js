"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { parseEnv } = require("node:util");
const { temporary } = require("./helpers/fixtures.cjs");
const { prepareEnvironment, GENERATED } = require("../lib/setup-environment");
const { setup } = require("../scripts/setup");
const templateFile = path.join(__dirname, "../.env.example");
test("setup completa una plantilla copiada: solo la clave Groq queda pendiente", async (t) => {
  const tmp = await temporary(); t.after(tmp.cleanup);
  const template = await fs.readFile(templateFile, "utf8");
  await fs.writeFile(path.join(tmp.root, ".env"), template);
  const result = prepareEnvironment(tmp.root, template);
  for (const key of GENERATED) assert.match(result.values[key], /^[a-f0-9]{64}$/);
  assert.equal(new Set(GENERATED.map((key) => result.values[key])).size, GENERATED.length);
  assert.deepEqual(Object.entries(result.values).filter(([, value]) => !value).map(([key]) => key), ["GROQ_API_KEY"]);
  assert.equal(parseEnv(await fs.readFile(result.file, "utf8")).DLP_CONTROL_ADMIN_TOKEN, result.values.DLP_CONTROL_ADMIN_TOKEN);
});
test("setup conserva la clave del usuario y todos los tokens al repetirse", async (t) => {
  const tmp = await temporary(); t.after(tmp.cleanup);
  const template = await fs.readFile(templateFile, "utf8");
  const initial = prepareEnvironment(tmp.root, template);
  await fs.writeFile(initial.file, (await fs.readFile(initial.file, "utf8")).replace(/^GROQ_API_KEY=$/m, 'GROQ_API_KEY="CLAVE_FICTICIA_NO_UTILIZABLE"'));
  const before = await fs.readFile(initial.file, "utf8");
  const next = prepareEnvironment(tmp.root, template);
  assert.equal(next.values.GROQ_API_KEY, "CLAVE_FICTICIA_NO_UTILIZABLE");
  assert.equal(await fs.readFile(initial.file, "utf8"), before);
  for (const key of GENERATED) assert.equal(next.values[key], initial.values[key]);
  await fs.writeFile(initial.file, before + "\nDLP_INSPECT_TOKEN=\n");
  assert.throws(() => prepareEnvironment(tmp.root, template), /duplicada/);
});
test("setup prepara el enrolamiento y mantiene el token del navegador separado y estable", async (t) => {
  const tmp = await temporary(); t.after(tmp.cleanup);
  await setup(tmp.root);
  const values = parseEnv(await fs.readFile(path.join(tmp.root, ".env"), "utf8"));
  const credentialFile = path.join(tmp.root, "datos-endpoint/credenciales.json");
  const local = JSON.parse(await fs.readFile(credentialFile, "utf8"));
  assert.match(local.browser, /^[a-f0-9]{64}$/);
  assert.notEqual(local.browser, values.DLP_CONTROL_ADMIN_TOKEN);
  assert.equal((await fs.readFile(path.join(tmp.root, "deploy/state/authd.pass"), "utf8")).trim(), values.DLP_WAZUH_ENROLLMENT_PASSWORD);
  await setup(tmp.root);
  assert.deepEqual(JSON.parse(await fs.readFile(credentialFile, "utf8")), local);
  for (const name of ["vacio.txt", "vacio.docx", "vacio.xlsx", "sin_texto.pdf", "base64_privado.txt", "publico.docx", "privado.docx"]) {
    assert.ok((await fs.stat(path.join(tmp.root, "laboratorio/Finanzas", name))).isFile(), name);
  }
  assert.equal((await fs.stat(path.join(tmp.root, "laboratorio/Finanzas/vacio.txt"))).size, 0);
});
