"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { PROJECT } = require("../endpoint/config");
const { EndpointRuntime } = require("../endpoint/runtime");
const { createEndpointApp } = require("../endpoint/server");
const { createDemoSite } = require("../endpoint/demo-site");
const { FakeBridge } = require("../test/helpers/fixtures.cjs");

async function waitFor(predicate, message, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(message);
}
async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  return server;
}
async function run() {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(PROJECT, "tmp", "browser-binaries");
  let playwright;
  try { playwright = require(process.env.DLP_PLAYWRIGHT_MODULE || "playwright"); }
  catch { throw new Error("Esta comprobación opcional necesita Playwright. Instálalo como herramienta de pruebas o indica DLP_PLAYWRIGHT_MODULE."); }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dlp-browser-e2e-"));
  let context, apiServer, siteServer, runtime;
  const results = [];
  try {
    const sources = path.join(directory, "protegidos"); await fs.mkdir(sources);
    const publicText = "Horario publico de biblioteca", privateText = "DNI: 12345678";
    const publicPath = path.join(sources, "publico.txt"), privatePath = path.join(sources, "privado.txt");
    await fs.writeFile(publicPath, publicText); await fs.writeFile(privatePath, privateText);
    runtime = new EndpointRuntime({ dataDirectory: path.join(directory, "estado"), bridge: new FakeBridge(), config: { watchRoots: [sources], notifications: false } });
    await runtime.start();
    apiServer = await listen(createEndpointApp(runtime));
    const agentUrl = `http://127.0.0.1:${apiServer.address().port}`;
    const site = createDemoSite(path.join(directory, "destino"));
    siteServer = await listen(site.app);
    const siteUrl = `http://127.0.0.1:${siteServer.address().port}`;
    const extension = path.join(PROJECT, "extension", "dist", "chromium");
    context = await playwright.chromium.launchPersistentContext(path.join(directory, "perfil-aislado"), { ...(process.env.DLP_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DLP_CHROMIUM_EXECUTABLE } : { channel: "chromium" }), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 15000 });
    await worker.evaluate(async (settings) => chrome.storage.local.set(settings), { enabled: true, agentUrl, token: runtime.credentials.browser, failClosed: true });
    await waitFor(() => runtime.browserObserver.status().some((c) => c.active), "El complemento no confirmó un latido real");
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(siteUrl);
    await waitFor(() => runtime.audit.events.some((e) => e.channel === "browser_navigation" && e.origin === siteUrl), "La navegación real no llegó al agente");
    results.push({ scenario: "Navegación real y latido del conector", result: "OBSERVADO", evidence: "REAL_WEBNAVIGATION_API_AND_AGENT_HEARTBEAT" });
    const routeStart = runtime.audit.events.length;
    await page.evaluate(() => history.pushState(null, "", "/?consulta=NO_GUARDAR_123#privado"));
    await waitFor(() => runtime.audit.events.slice(routeStart).some((e) => e.activity === "CAMBIO_DE_RUTA_WEB"), "El cambio de ruta no se observó");
    assert.ok(!JSON.stringify(runtime.audit.events).includes("NO_GUARDAR_123"));
    results.push({ scenario: "Ruta SPA sin almacenar consulta o fragmento", result: "OBSERVADO", evidence: "REAL_HISTORY_STATE_EVENT_ORIGIN_ONLY" });
    const choose = async (file) => { const chooser = page.waitForEvent("filechooser"); await page.locator("#file").click(); await (await chooser).setFiles(file); };
    const receipt = (channel, after, prevented) => runtime.audit.events.slice(after).some((e) => e.channel === channel && e.evidence === "BROWSER_CLIENT_REPORT" && e.prevented === prevented);

    let start = runtime.audit.events.length;
    await choose(privatePath);
    await waitFor(() => receipt("browser_file", start, true), "El archivo sensible no fue retenido por el complemento");
    assert.equal(await page.locator("#file").evaluate((node) => node.files.length), 0);
    await page.locator("#upload").click();
    assert.equal(site.receipts.length, 0);
    results.push({ scenario: "Archivo sensible elegido manualmente", result: "BLOQUEADO", destinationReceipts: 0, evidence: "REAL_CHROMIUM_EXTENSION_FILE_CHOOSER" });

    await choose(publicPath);
    await page.waitForFunction(() => document.querySelector("#file").files.length === 1);
    await page.locator("#upload").click();
    await waitFor(() => site.receipts.length === 1, "El archivo público no llegó al receptor independiente");
    assert.equal(site.receipts[0].sha256, crypto.createHash("sha256").update(publicText).digest("hex"));
    results.push({ scenario: "Archivo público elegido y enviado", result: "PERMITIDO", destinationReceipts: 1, evidence: "REAL_CHROMIUM_EXTENSION_AND_RECEIVER" });

    const paste = async (text) => page.locator("#text").evaluate((node, text) => { node.focus(); const data = new DataTransfer(); data.setData("text/plain", text); node.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, composed: true, clipboardData: data })); }, text);
    start = runtime.audit.events.length;
    await paste(privateText);
    await waitFor(() => receipt("browser_paste", start, true), "El pegado sensible no fue retenido");
    assert.equal(await page.locator("#text").inputValue(), "");
    assert.equal(site.receipts.length, 1);
    results.push({ scenario: "Pegado sensible", result: "BLOQUEADO", evidence: "REAL_EXTENSION_SYNTHETIC_PASTE_EVENT", nativeClipboardTested: false });
    await paste(publicText);
    await page.waitForFunction((expected) => document.querySelector("#text").value === expected, publicText);
    await page.locator("#send-text").click();
    await waitFor(() => site.receipts.length === 2, "El texto público no llegó al receptor");
    results.push({ scenario: "Pegado público y envío", result: "PERMITIDO", evidence: "REAL_EXTENSION_SYNTHETIC_PASTE_EVENT_AND_RECEIVER", nativeClipboardTested: false });

    const drop = async (name, content) => page.locator("#drop").evaluate((node, data) => { const transfer = new DataTransfer(); transfer.items.add(new File([data.content], data.name, { type: "text/plain" })); node.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer })); }, { name, content });
    start = runtime.audit.events.length;
    await drop("privado.txt", privateText);
    await waitFor(() => receipt("browser_drop", start, true), "El arrastre sensible no fue retenido");
    assert.equal(site.receipts.length, 2);
    results.push({ scenario: "Arrastre sensible", result: "BLOQUEADO", evidence: "REAL_EXTENSION_SYNTHETIC_DROP_EVENT" });
    await drop("publico.txt", publicText);
    await waitFor(() => site.receipts.length === 3, "El arrastre público no llegó al receptor");
    results.push({ scenario: "Arrastre público", result: "PERMITIDO", evidence: "REAL_EXTENSION_SYNTHETIC_DROP_EVENT_AND_RECEIVER" });

    await worker.evaluate(async () => chrome.storage.local.set({ enabled: false }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await choose(privatePath);
    await page.locator("#upload").click();
    await waitFor(() => site.receipts.length === 4, "La prueba negativa no demostró que el destino acepta contenido sin el conector");
    assert.equal(site.receipts[3].sha256, crypto.createHash("sha256").update(privateText).digest("hex"));
    results.push({ scenario: "Control negativo: complemento desactivado", result: "SENSIBLE_RECIBIDO", evidence: "REAL_UNPROTECTED_RECEIVER", limitation: "Un usuario puede desactivar un complemento no administrado" });

    const evidenceDirectory = path.join(PROJECT, "output", "evidencias"); await fs.mkdir(evidenceDirectory, { recursive: true });
    await worker.evaluate(async () => chrome.storage.local.set({ enabled: true }));
    await waitFor(() => runtime.browserObserver.status().some((c) => c.active && c.navigation), "El conector no volvió a estar activo");
    const panel = await context.newPage(); await panel.goto(agentUrl);
    await panel.waitForFunction(() => document.querySelector("#count-files").textContent === "2");
    await panel.locator('[data-view="live"]').click();
    await panel.locator("#live-browser").filter({ hasText: "Conectado" }).waitFor();
    await panel.locator("#live-filter").selectOption("navigation");
    await panel.waitForFunction(() => document.querySelector("#live-events").textContent.includes("SITIO_WEB_VISITADO"));
    await new Promise((resolve) => setTimeout(resolve, 2100));
    await page.goto(siteUrl.replace("127.0.0.1", "localhost"));
    await panel.waitForFunction(() => document.querySelector("#live-events").textContent.includes("localhost"));
    results.push({ scenario: "Vista en vivo recibe una visita posterior sin recarga manual", result: "OBSERVADO", evidence: "REAL_NAVIGATION_AND_AUTOMATIC_PANEL_REFRESH" });
    await panel.screenshot({ path: path.join(evidenceDirectory, "panel-endpoint.png"), fullPage: true });

    await worker.evaluate(async () => chrome.storage.local.set({ enabled: true }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await new Promise((resolve) => apiServer.close(resolve)); apiServer = null;
    await choose(publicPath);
    await page.waitForFunction(() => document.querySelector("#dlp-agent-notice")?.textContent.includes("retenida"));
    assert.equal(await page.locator("#file").evaluate((node) => node.files.length), 0);
    results.push({ scenario: "Agente indisponible con cierre ante fallo", result: "RETENIDO_SIN_ANALIZAR", evidence: "REAL_CHROMIUM_EXTENSION_OFFLINE", sensitiveDetected: false });

    const output = path.join(PROJECT, "output", "evaluacion"); await fs.mkdir(output, { recursive: true });
    const report = { generatedAt: new Date().toISOString(), browser: await context.browser().version(), extension: worker.url().split("/")[2], tests: results.length, results, nativeWindowsClipboardTested: false, physicalUSBTested: false, sourceHash: crypto.createHash("sha256").update(await fs.readFile(path.join(extension, "content.js"))).digest("hex") };
    await fs.writeFile(path.join(output, "resultado-navegador.json"), JSON.stringify(report, null, 2));
    console.table(results.map(({ scenario, result, evidence }) => ({ escenario: scenario, resultado: result, evidencia: evidence })));
    return report;
  } finally {
    await context?.close();
    if (apiServer) await new Promise((resolve) => apiServer.close(resolve));
    if (siteServer) await new Promise((resolve) => siteServer.close(resolve));
    await runtime?.stop();
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith("dlp-browser-e2e-")) throw new Error("Carpeta temporal inesperada");
    await fs.rm(resolved, { recursive: true, force: true });
  }
}
if (require.main === module) run().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { run };
