"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { setup } = require("../scripts/setup");
const { startDemo } = require("../scripts/demo");
const { temporary } = require("./helpers/fixtures.cjs");

test("demo arranca en loopback, usa estado separado y permite vacío sin central ni clave", async t => {
  const temp = await temporary(); t.after(temp.cleanup);
  await setup(temp.root);
  const envBefore = await fs.readFile(path.join(temp.root, ".env"), "utf8");
  const demo = await startDemo({ root: temp.root, agentPort: 0, sitePort: 0, receiverPort: 0 });
  t.after(demo.stop);
  const agent = `http://127.0.0.1:${demo.endpoint.server.address().port}`;
  assert.equal((await fetch(agent + "/api/health")).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${demo.siteServer.address().port}`)).status, 200);
  for (const [name, text, allowed] of [["vacio.txt", "", true], ["publico.txt", "Horario público", true], ["privado.txt", "DNI: 12345678", false]]) {
    const response = await fetch(agent + "/api/browser/inspect", { method: "POST", headers: { "Content-Type": "application/json", "X-DLP-Token": demo.endpoint.runtime.credentials.browser }, body: JSON.stringify({ channel: "browser_file", fileName: name, text, url: "https://destino.example" }) });
    assert.equal(response.status, 200);
    const decision = await response.json();
    assert.equal(decision.allowed, allowed, name);
  }
  assert.equal(demo.endpoint.runtime.config.clipboardMonitor, false);
  assert.equal(await fs.readFile(path.join(temp.root, ".env"), "utf8"), envBefore);
  assert.ok(demo.endpoint.runtime.dataDirectory.endsWith(path.join("datos-endpoint", "demo")));
});
