"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { temporary } = require("./helpers/fixtures.cjs");
const { prepare, plan, start, locations, childEnvironment } = require("../scripts/pc-protection");

test("preparar PC conserva perfil y no activa captura ni crea CA/credenciales", async t => {
  const tmp = await temporary(); t.after(tmp.cleanup);
  await fs.writeFile(path.join(tmp.root, ".env"), "DLP_CONTROL_URL=http://127.0.0.1:3100\nGROQ_API_KEY=FICTICIA\n");
  const result = prepare({ root: tmp.root, hostname: "PC-FICTICIA" });
  assert.equal(result.captureActivated, false); assert.equal(result.firewallChanged, false); assert.equal(result.certificateInstalled, false);
  const p = locations(tmp.root), original = await fs.readFile(p.profile, "utf8");
  assert.ok(!original.includes("GROQ_API_KEY"));
  assert.deepEqual(await fs.readdir(p.directory), ["perfil.json"]);
  assert.equal(prepare({ root: tmp.root, hostname: "OTRA" }).preservedExistingProfile, true);
  assert.equal(await fs.readFile(p.profile, "utf8"), original);
  const status = plan({ root: tmp.root, platform: "linux" });
  assert.equal(status.captureState, "NOT_ACTIVE"); assert.equal(status.universalProtection, false); assert.equal(status.cases.length, 12);
});

test("activación de toda la PC se rechaza antes de escribir o invocar sistema", async t => {
  const tmp = await temporary(); t.after(tmp.cleanup);
  await assert.rejects(start(["--all-apps", "--ack-data-processing"], { root: tmp.root, platform: "win32", execute: () => assert.fail("No ejecutar") }), /ALL_PC_NOT_VALIDATED/);
  assert.deepEqual(await fs.readdir(tmp.root), []);
});

test("capturador no hereda ADMIN, Groq ni proxies; tiene identidad individual", () => {
  const env = childEnvironment({ deviceId: "equipo", inspectToken: "inspect", telemetryToken: "telemetry" }, { controlUrl: "http://127.0.0.1:3100" }, locations("C:/ficticio"), { PATH: "bin", GROQ_API_KEY: "NO", DLP_CONTROL_ADMIN_TOKEN: "NO", HTTPS_PROXY: "NO", AZURE_TOKEN: "NO", DLP_INSPECT_TOKEN: "OTRO" });
  assert.equal(env.PATH, "bin"); assert.equal(env.DLP_INSPECT_TOKEN, "inspect");
  for (const key of ["GROQ_API_KEY", "DLP_CONTROL_ADMIN_TOKEN", "HTTPS_PROXY", "AZURE_TOKEN"]) assert.equal(env[key], undefined);
});

test("diagnóstico ignora estado de captura antiguo/de otra sesión", async t => {
  const tmp = await temporary(); t.after(tmp.cleanup); prepare({ root: tmp.root });
  const p = locations(tmp.root);
  await fs.writeFile(p.manager, JSON.stringify({ pid: process.pid, nonce: "actual" }));
  await fs.writeFile(p.status, JSON.stringify({ state: "CAPTURE_RUNNING", session: "anterior", updatedAt: Date.now() / 1000 }));
  assert.equal(plan({ root: tmp.root, platform: "linux" }).captureState, "STARTING_OR_STALE_NOT_VERIFIED");
});
