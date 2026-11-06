"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { temporary } = require("./helpers/fixtures.cjs");
const { forwardAudit } = require("../lib/telemetry");

test("telemetría transmite programa/PID, estado semántico y sensores sin copiar contenido del evento", async t => {
  const tmp = await temporary(); t.after(tmp.cleanup);
  const keys = ["DLP_FORWARD_EVENTS", "DLP_CONTROL_URL", "DLP_TELEMETRY_TOKEN", "DLP_DEVICE_ID"];
  const prior = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; for (const key of keys) prior[key] === undefined ? delete process.env[key] : process.env[key] = prior[key]; });
  Object.assign(process.env, { DLP_FORWARD_EVENTS: "1", DLP_CONTROL_URL: "http://127.0.0.1:3100", DLP_TELEMETRY_TOKEN: "f".repeat(64), DLP_DEVICE_ID: "11111111-1111-4111-8111-111111111111" });
  let body;
  global.fetch = async (_url, options) => { body = JSON.parse(options.body); return { ok: true, body: { cancel: async () => {} } }; };
  const stop = forwardAudit({ events: [{ id: "a", channel: "process_observed", program: "notepad", processId: 42, content: "NO_ENVIAR" }, { id: "b", channel: "filesystem", semanticStatus: "COMPLETE", inspectionStatus: "COMPLETE", text: "NO_ENVIAR" }] }, tmp.root, () => ({ browser: { activeClients: 1 } }));
  t.after(stop);
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && !await fs.access(path.join(tmp.root, "telemetria-cursor.json")).then(() => true, () => false)) await delay(10);
  stop();
  assert.equal(body.device, process.env.DLP_DEVICE_ID);
  assert.equal(body.events[0].program, "notepad"); assert.equal(body.events[0].processId, 42);
  assert.equal(body.events[1].semanticStatus, "COMPLETE"); assert.equal(body.sensors.browser.activeClients, 1);
  assert.ok(!JSON.stringify(body).includes("NO_ENVIAR"));
  assert.equal(JSON.parse(await fs.readFile(path.join(tmp.root, "telemetria-cursor.json"))).cursor, 2);
});
