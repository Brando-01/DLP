"use strict";
// Prueba nativa no destructiva: no cambia políticas, firewall, USB o portapapeles.
// Solo imprime datos ficticios al controlador virtual Microsoft Print to PDF.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { EndpointRuntime } = require("../endpoint/runtime");
const { WindowsBridge } = require("../endpoint/windows-bridge");
const { PROJECT } = require("../endpoint/config");

async function run() {
  if (process.platform !== "win32") throw new Error("Esta comprobación requiere Windows");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dlp-windows-smoke-"));
  const root = path.join(directory, "protegidos"); await fs.mkdir(root);
  await fs.writeFile(path.join(root, "publico.txt"), "DLP: prueba publica de impresion. No contiene datos personales.");
  await fs.writeFile(path.join(root, "privado.txt"), "DNI: 12345678\nExpediente privado ficticio de laboratorio.");
  const bridge = new WindowsBridge();
  let printCalls = 0;
  const nativeRequest = bridge.request.bind(bridge);
  bridge.request = (...args) => { if (args[0] === "print") printCalls += 1; return nativeRequest(...args); };
  const runtime = new EndpointRuntime({ dataDirectory: path.join(directory, "estado"), bridge, config: { watchRoots: [root], notifications: false, clipboardMonitor: false } });
  try {
    await runtime.scan();
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("El sensor Windows no respondió")), 15000);
      bridge.once("status", (value) => { clearTimeout(timer); resolve(value); });
    });
    bridge.start();
    const initial = await ready;
    await bridge.request("configure", { clipboardMonitor: false, printingMonitor: false });
    const report = { generatedAt: new Date().toISOString(), sensorAvailable: true, interactiveSession: initial.interactive, removableDevices: initial.drives.length, installedPrinters: initial.printers.length, clipboardModified: false, systemControlsApplied: false, nativePhysicalUSBTested: false, tests: [] };
    if (initial.printers.includes("Microsoft Print to PDF")) {
      const privateFile = [...runtime.inventory.values()].find((item) => item.name === "privado.txt");
      const publicFile = [...runtime.inventory.values()].find((item) => item.name === "publico.txt");
      const blocked = await runtime.transfer({ fileId: privateFile.id, channel: "print", printer: "Microsoft Print to PDF" });
      assert.equal(blocked.prevented, true); assert.equal(printCalls, 0);
      report.tests.push({ scenario: "Impresión mediada de contenido sensible", result: "BLOQUEADO", nativePrintCalls: 0, evidence: "POLICY_BEFORE_REAL_NATIVE_ADAPTER" });
      const printed = await runtime.transfer({ fileId: publicFile.id, channel: "print", printer: "Microsoft Print to PDF" });
      if (printed.outcome === "COMPLETED") {
        const bytes = await fs.readFile(printed.receipt.outputPath);
        assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
        report.tests.push({ scenario: "Impresión pública en controlador virtual Windows", result: "PDF_GENERADO", bytes: bytes.length, output: path.relative(PROJECT, printed.receipt.outputPath), evidence: "REAL_WINDOWS_PRINT_TO_PDF" });
      } else report.tests.push({ scenario: "Impresión pública en controlador virtual Windows", result: "NO_VERIFICADO", error: printed.message, evidence: "NATIVE_ATTEMPT_FAILED" });
    } else report.tests.push({ scenario: "Impresión virtual", result: "NO_DISPONIBLE", evidence: "NO_COMPATIBLE_PRINTER" });
    const output = path.join(PROJECT, "output", "evaluacion"); await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, "resultado-windows.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    return report;
  } finally {
    await runtime.stop();
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith("dlp-windows-smoke-")) throw new Error("Carpeta temporal inesperada");
    await fs.rm(resolved, { recursive: true, force: true });
  }
}
if (require.main === module) run().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { run };
