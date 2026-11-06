"use strict";
require("../lib/environment");
process.env.DLP_LLM_MODE = "off";
process.env.GROQ_API_KEY = "";
process.env.DLP_FORWARD_EVENTS = "0";
process.env.DLP_ALLOW_LAB_HTTP = "1";
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createControl } = require("../control/server");
const { chromium } = require("playwright");
async function run() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dlp-central-ui-"));
  const credentials = { admin: "a".repeat(64), inspect: "b".repeat(64), telemetry: "c".repeat(64) };
  let now = Date.now(), browser, server; const results = [];
  try {
    const control = createControl({ directory, credentials, now: () => now });
    server = control.app.listen(0, "127.0.0.1"); await new Promise(r => server.once("listening", r));
    const url = `http://127.0.0.1:${server.address().port}`;
    const request = (route, token, body) => fetch(url + route, { method: body ? "POST" : "GET", headers: { "X-DLP-Token": token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    browser = await chromium.launch({ headless: true, ...(process.env.DLP_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DLP_CHROMIUM_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
    await page.goto(url); await page.locator("#token").fill(credentials.admin); await page.locator("#login-form button").click();
    await page.locator("#console").waitFor({ state: "visible" }); results.push("Acceso administrativo en navegador real");
    async function enroll(name, platform) {
      await page.locator("#device-name").fill(name); await page.locator("#device-platform").selectOption(platform); await page.locator("#enroll-url").fill(url);
      await page.locator("#enroll-form button").click();
      await page.locator("#invitation-detail").filter({ hasText: name }).waitFor();
      const downloaded = page.waitForEvent("download"); await page.locator("#download-invitation").click();
      const download = await downloaded, file = path.join(directory, name + ".json"); await download.saveAs(file);
      const invitation = JSON.parse(await fs.readFile(file, "utf8"));
      const r = await request("/v1/enroll", "", { ...invitation, hostname: name.toLowerCase(), platform, version: "3.0.0" }); assert.equal(r.status, 200);
      const device = await r.json();
      await request("/v1/telemetry", device.telemetryToken, { device: device.deviceId, hostname: name.toLowerCase(), platform, startMode: platform === "win32" ? "WINDOWS_LOGON" : "SYSTEMD_USER", events: [] });
      return device;
    }
    const win = await enroll("WIN-01", "win32"), lin = await enroll("LIN-01", "linux"); results.push("Invitación descargada e inscripción individual Windows/Linux");
    await request("/v1/telemetry", win.telemetryToken, { device: win.deviceId, platform: "win32", startMode: "WINDOWS_LOGON", sensors: { process: { available: true, scope: "VISIBLE_PROCESSES", sampledAt: new Date().toISOString(), count: 1, processes: [{ processId: 1234, program: "notepad" }] }, browser: { activeClients: 1, navigationClients: 1 }, inventory: { roots: 2, files: 3 }, inspectionBackend: "central" }, events: [{ id: "proceso-prueba", channel: "process_observed", activity: "PROCESO_INICIADO", program: "notepad", processId: 1234 }, { id: "sitio-prueba", channel: "browser_navigation", activity: "SITIO_WEB_VISITADO", destination: "https://portal.example.test/ruta?secreto=NO_MOSTRAR" }, { id: "escape-prueba", channel: "process_observed", program: '<img src=x onerror="window.__bad=true">', activity: "PROCESO_FINALIZADO", processId: 4321 }] });
    for (const [device, file, text, outcome] of [[win, "reserva-win.txt", "DNI: 12345678", "CANCELLED"], [lin, "publico-lin.txt", "Horario publico de biblioteca", "RELEASED"]]) {
      const r = await request("/v1/inspect", device.inspectToken, { device: device.deviceId, channel: "browser_file", destination: "https://destino.example.test", parts: [{ name: file, base64: Buffer.from(text).toString("base64") }] });
      const decision = await r.json(); assert.equal(decision.allowed, outcome !== "CANCELLED");
      assert.equal((await request("/v1/receipts", device.inspectToken, { ticket: decision.ticket, outcome })).status, 200);
    }
    await page.locator("#refresh").click(); await page.locator("#agent-count").filter({ hasText: "2" }).waitFor();
    await page.locator(".device-card").filter({ has: page.getByRole("heading", { name: "WIN-01", exact: true }) }).getByRole("button", { name: "Ver actividad" }).click();
    await page.locator("#activity-title").filter({ hasText: "WIN-01" }).waitFor();
    assert.ok((await page.locator("#events").innerText()).includes("reserva-win.txt")); assert.ok(!(await page.locator("#events").innerText()).includes("publico-lin.txt"));
    const details = await page.locator("#device-details").innerText();
    assert.ok(details.includes("Extensiones activas: 1"));
    await page.locator("#device-details summary").click();
    assert.ok((await page.locator("#device-details").innerText()).includes("notepad · PID 1234"));
    assert.ok((await page.locator("#events").innerText()).includes("Programa: notepad · PID 1234"));
    assert.ok((await page.locator("#events").innerText()).includes("https://portal.example.test"));
    assert.ok(!(await page.locator("#events").innerText()).includes("NO_MOSTRAR"));
    assert.equal(await page.locator("#events img").count(), 0);
    await fs.mkdir("output/evidencias", { recursive: true });
    await page.locator("#device-details").screenshot({ path: "output/evidencias/central-detalle-equipo.png" });
    results.push("Programa/PID, procesos actuales, conector y sitio sin ruta privada; escape HTML");
    await page.locator("#device-filter").selectOption(lin.deviceId); await page.locator("#activity-title").filter({ hasText: "LIN-01" }).waitFor();
    assert.ok((await page.locator("#events").innerText()).includes("publico-lin.txt")); assert.ok(!(await page.locator("#events").innerText()).includes("reserva-win.txt")); results.push("Vista individual no mezcla eventos entre puestos");
    assert.ok((await page.locator("#device-details").innerText()).includes("no reporta aún"));
    await page.locator("#decision-filter").selectOption("BLOQUEADO"); assert.ok(!(await page.locator("#events").innerText()).includes("publico-lin.txt"));
    await page.locator("#decision-filter").selectOption(""); await page.locator("#all-devices").click(); await page.locator("#activity-title").filter({ hasText: "todos los equipos" }).waitFor();
    assert.ok((await page.locator("#events").innerText()).includes("reserva-win.txt")); results.push("Filtro de decisión y retorno a todos los equipos");
    now += 31000; await page.locator("#refresh").click(); await page.locator(".connection.STALE").first().waitFor();
    now += 90001; await page.locator("#refresh").click(); await page.locator(".connection.OFFLINE").first().waitFor(); results.push("Estado reciente, sin reporte y desconectado por reloj controlado");
    const card = page.locator(".device-card").filter({ has: page.getByRole("heading", { name: "WIN-01", exact: true }) });
    await card.getByRole("button", { name: "Revocar credencial" }).click(); await card.locator(".REVOKED").waitFor();
    assert.equal((await request("/v1/config", win.inspectToken)).status, 401); assert.equal((await request("/v1/config", lin.inspectToken)).status, 200); results.push("Revocación desde consola sin afectar el otro puesto");
    const output = path.resolve("output/evidencias"); await fs.mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, "central-equipos.png"), fullPage: true });
    await page.locator("#logout").click(); await page.locator("#login").waitFor({ state: "visible" }); results.push("Cierre de sesión elimina invitación de la interfaz");
    const report = { passed: true, mode: "LOCAL_RULES_NO_GROQ", source: "TEMPORARY_CONTROL_REAL_CHROMIUM", tests: results, limitation: "No instala inicio automático ni acredita interceptación universal o pruebas en VM." };
    await fs.mkdir("output/evaluacion", { recursive: true }); await fs.writeFile("output/evaluacion/resultado-central.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser?.close();
    if (server) await new Promise(r => { server.close(r); server.closeAllConnections(); });
    // directorio creado por mkdtemp; no se aceptan rutas aportadas por documentos.
    const resolved = path.resolve(directory), parent = path.resolve(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(parent) || !path.basename(resolved).startsWith("dlp-central-ui-")) throw new Error("Directorio temporal inesperado; no se elimina.");
    await fs.rm(resolved, { recursive: true, force: true });
  }
}
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
