"use strict";
process.env.DLP_LLM_MODE = "off";
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { startControl } = require("../control/server");
const { temporary } = require("../test/helpers/fixtures.cjs");
async function run() {
  const playwright = require(process.env.DLP_PLAYWRIGHT_MODULE || "playwright");
  const tmp = await temporary(); let service, browser;
  try {
    const credentials = Object.fromEntries(["admin", "inspect", "telemetry"].map((key) => [key, crypto.randomBytes(32).toString("hex")]));
    service = await startControl({ port: 0, directory: tmp.root, credentials });
    service.audit.record({ channel: "web_proxy", activity: "RESULTADO_GATEWAY", decision: "BLOQUEADO", prevented: true, outcome: "CANCELLED", evidence: "PRUEBA_VISUAL_FICTICIA", destination: "https://example.test" });
    browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.DLP_CHROMIUM_EXECUTABLE });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${service.server.address().port}`);
    await page.locator("#token").fill(credentials.admin);
    await page.locator("#login-form button").click();
    await page.locator("#console").waitFor({ state: "visible" });
    assert.equal(await page.locator("#cases tr").count(), 12);
    assert.ok((await page.locator("#events").textContent()).includes("CANCELLED"));
    assert.ok(!(await page.content()).includes(credentials.admin));
    await fs.mkdir("tmp/control-ui", { recursive: true });
    await page.screenshot({ path: "tmp/control-ui/consola.png", fullPage: true });
    assert.deepEqual(errors, []);
    await page.locator("#logout").click();
    assert.equal(await page.locator("#login").isVisible(), true);
    console.log("Consola: acceso, doce escenarios, recibos, cierre de sesion y JavaScript verificados.");
  } finally { await browser?.close(); await service?.stop(); await tmp.cleanup(); }
}
run().catch((error) => { console.error(error.message); process.exitCode = 1; });
