"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { parseEnv } = require("node:util");
const { temporary } = require("./helpers/fixtures.cjs");
const { prepare } = require("../scripts/strict-lab");
const { StrictRelay } = require("../endpoint/strict-relay");

test("preparación estricta conserva identidad y no instala firewall ni CA del sistema", async t => {
  const tmp = await temporary(); t.after(tmp.cleanup);
  const env = 'DLP_DEVICE_ID=11111111-1111-4111-8111-111111111111\nDLP_INSPECTION_BACKEND=central\nDLP_CONTROL_URL=http://192.168.99.1:3100\nDLP_INSPECT_TOKEN=' + 'a'.repeat(64) + '\n';
  await fs.writeFile(path.join(tmp.root, ".env"), env);
  const ca = path.join(tmp.root, "ca.pem"); await fs.writeFile(ca, "-----BEGIN CERTIFICATE-----\nPUBLICA-FICTICIA\n-----END CERTIFICATE-----\n");
  const result = prepare({ root: tmp.root, platform: "linux", ca });
  assert.equal(result.firewallChanged, false);
  const values = parseEnv(await fs.readFile(path.join(tmp.root, ".env"), "utf8"));
  assert.equal(values.DLP_STRICT_LAB, "1"); assert.equal(values.DLP_DEVICE_ID, "11111111-1111-4111-8111-111111111111"); assert.equal(values.DLP_INSPECT_TOKEN, "a".repeat(64));
  await fs.writeFile(ca, "PRIVATE KEY"); assert.throws(() => prepare({ root: tmp.root, platform: "linux", ca }), /CA pública/);
});

test("relay rechaza otros destinos y no abre salida cuando el gateway falla", async t => {
  const relay = new StrictRelay({ enabled: true, gateway: "127.0.0.1", token: "a".repeat(64), deviceId: "11111111-1111-4111-8111-111111111111", port: 0, proxyPort: 1 });
  await relay.start(); t.after(() => relay.stop());
  const request = target => new Promise((resolve, reject) => {
    const socket = net.connect(relay.info.port, "127.0.0.1", () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    socket.once("data", b => { socket.destroy(); resolve(b.toString()); }); socket.once("error", reject); socket.setTimeout(2000, () => { socket.destroy(); reject(new Error("timeout")); });
  });
  assert.match(await request("discord.com:443"), /403/);
  assert.match(await request("sink.dlp.test:4201"), /503/);
});
