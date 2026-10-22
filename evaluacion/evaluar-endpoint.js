"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { EndpointRuntime } = require("../endpoint/runtime");
const { createReceiver } = require("../endpoint/receiver");
const { PROJECT } = require("../endpoint/config");
const { pdfBuffer, docxBuffer, xlsxBuffer, FakeBridge } = require("../test/helpers/fixtures.cjs");
const cases = require("./casos-endpoint.json");

function matrix(results, positive) {
  const value = { TP: 0, FP: 0, TN: 0, FN: 0 };
  for (const result of results) value[result.sensitive ? positive(result) ? "TP" : "FN" : positive(result) ? "FP" : "TN"] += 1;
  return { ...value, precision: value.TP + value.FP ? value.TP / (value.TP + value.FP) : 0, recall: value.TP + value.FN ? value.TP / (value.TP + value.FN) : 0 };
}
async function caseBuffer(item) {
  if (item.format === "pdf") return pdfBuffer(item.text);
  if (item.format === "docx") return docxBuffer(item.text);
  if (item.format === "xlsx") return xlsxBuffer(item.rows);
  return Buffer.from(item.text, "utf8");
}
async function runEvaluation() {
  assert.equal(new Set(cases.map((item) => item.id)).size, cases.length);
  assert.ok(cases.every((item) => typeof item.sensitive === "boolean" && item.reason));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dlp-endpoint-evaluation-"));
  const source = path.join(directory, "protegidos");
  await fs.mkdir(source);
  const samplesDirectory = path.join(PROJECT, "laboratorio", "evaluacion-muestras");
  await fs.mkdir(samplesDirectory, { recursive: true });
  for (const item of cases) {
    const buffer = await caseBuffer(item);
    await fs.writeFile(path.join(source, item.file), buffer);
    await fs.writeFile(path.join(samplesDirectory, item.file), buffer);
  }
  const bridge = new FakeBridge();
  const receiver = createReceiver(path.join(directory, "receptor"));
  const server = receiver.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const config = {
    watchRoots: [source], notifications: false,
    targets: [
      { id: "usb", name: "USB representado por directorio de prueba", channel: "usb", path: path.join(directory, "usb"), lab: true },
      { id: "smb", name: "Recurso compartido representado por directorio de prueba", channel: "network_share", path: path.join(directory, "smb"), lab: true },
      { id: "http", name: "Receptor HTTP local real", channel: "http_transfer", url: `http://127.0.0.1:${server.address().port}/upload`, lab: true },
    ],
  };
  const runtime = new EndpointRuntime({ dataDirectory: path.join(directory, "estado"), config, bridge });
  try {
    await runtime.scan();
    assert.equal(runtime.inventory.size, cases.length);
    const results = [];
    for (const channel of ["usb", "network_share", "http_transfer", "clipboard", "print"]) {
      for (const item of cases) {
        const entry = [...runtime.inventory.values()].find((file) => file.name === item.file);
        const callsBefore = bridge.calls.length, receivedBefore = receiver.receipts.length;
        const request = ["clipboard", "print"].includes(channel) ? { fileId: entry.id, channel, printer: "Impresora de prueba" } : { fileId: entry.id, targetId: channel === "network_share" ? "smb" : channel === "http_transfer" ? "http" : "usb" };
        const result = await runtime.transfer(request);
        assert.notEqual(result.outcome, "FAILED", `${channel}/${item.id}: ${result.message}`);
        const allowed = result.outcome === "COMPLETED";
        assert.equal(result.prevented, !allowed);
        let sideEffectVerified;
        if (["usb", "network_share"].includes(channel)) {
          if (allowed) {
            const bytes = await fs.readFile(result.receipt.storedPath);
            assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), result.sha256);
          }
          const targetDir = path.join(directory, channel === "usb" ? "usb" : "smb");
          const destinationFiles = await fs.readdir(targetDir).catch(() => []);
          assert.equal(destinationFiles.some((name) => name.startsWith(result.operationId)), allowed);
          sideEffectVerified = true;
        } else if (channel === "http_transfer") {
          assert.equal(receiver.receipts.length - receivedBefore, allowed ? 1 : 0);
          if (allowed) assert.equal(receiver.receipts.at(-1).sha256, result.sha256);
          sideEffectVerified = true;
        } else {
          assert.equal(bridge.calls.length - callsBefore, allowed ? 1 : 0);
          sideEffectVerified = true;
        }
        results.push({ id: item.id, file: item.file, channel, sensitive: item.sensitive, referenceReason: item.reason, inspectionStatus: result.inspectionStatus, classification: result.classification, score: result.score, rules: result.matches.map((m) => m.id), decision: result.decision, detected: result.detected, prevented: result.prevented, outcome: result.outcome, sideEffectVerified, evidence: ["clipboard", "print"].includes(channel) ? "TEST_DOUBLE_NATIVE_ADAPTER" : channel === "http_transfer" ? "REAL_LOOPBACK_RECEIVER" : "REAL_LAB_DIRECTORY_WRITE" });
      }
    }
    const channels = [...new Set(results.map((result) => result.channel))].map((channel) => {
      const selected = results.filter((result) => result.channel === channel);
      const complete = selected.filter((result) => result.inspectionStatus === "COMPLETE");
      return { channel, n: selected.length, completeInspections: complete.length, incompleteInspections: selected.length - complete.length, detection: matrix(selected, (r) => r.detected), prevention: matrix(selected, (r) => r.prevented), completeOnlyDetection: matrix(complete, (r) => r.detected), completeOnlyPrevention: matrix(complete, (r) => r.prevented), evidence: selected[0].evidence };
    });
    assert.equal(runtime.audit.status().chainValid, true);
    const report = {
      title: "Evaluación multicanal del laboratorio DLP de endpoint", generatedAt: new Date().toISOString(), node: process.version, platform: process.platform,
      cases: cases.length, operations: results.length, sourceCasesSha256: crypto.createHash("sha256").update(await fs.readFile(path.join(__dirname, "casos-endpoint.json"))).digest("hex"),
      interpretation: "Las etiquetas se declaran en casos-endpoint.json por propósito y contenido. Los casos se construyeron para comprobar el desarrollo; no constituyen un conjunto independiente de generalización. Las métricas integrales incluyen restricciones por no inspección y sus efectos de disponibilidad.",
      coverage: { usb: "Directorio de laboratorio, no USB físico ni bloqueo del Explorador", network_share: "Directorio de laboratorio, no SMB físico", http_transfer: "Transferencias HTTP reales a un receptor loopback independiente", clipboard: "Adaptador nativo simulado; prueba del punto de decisión, no del portapapeles físico", print: "Adaptador nativo simulado; prueba del punto de decisión, no de una impresora física" },
      channels, audit: runtime.audit.status(), results,
    };
    const output = path.join(PROJECT, "output", "evaluacion");
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, "resultado-endpoint.json"), JSON.stringify(report, null, 2));
    const csv = ["id,file,channel,sensitive,inspection,decision,detected,prevented,outcome,evidence", ...results.map((row) => [row.id, row.file, row.channel, row.sensitive, row.inspectionStatus, row.decision, row.detected, row.prevented, row.outcome, row.evidence].join(","))].join("\r\n");
    await fs.writeFile(path.join(output, "resultado-endpoint.csv"), csv);
    console.table(channels.map((item) => ({ canal: item.channel, casos: item.n, inspeccionados: item.completeInspections, "VP/FP/VN/FN detección": [item.detection.TP, item.detection.FP, item.detection.TN, item.detection.FN].join("/"), "VP/FP/VN/FN prevención": [item.prevention.TP, item.prevention.FP, item.prevention.TN, item.prevention.FN].join("/"), "evidencia": item.evidence })));
    console.log(`${results.length} operaciones comprobadas; auditoría íntegra. Resultados: output/evaluacion/resultado-endpoint.json`);
    console.log("Los dobles de prueba y los directorios de laboratorio no acreditan bloqueo físico ni interceptación global de Windows.");
    return report;
  } finally {
    await runtime.stop();
    await new Promise((resolve) => server.close(resolve));
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith("dlp-endpoint-evaluation-")) throw new Error("Carpeta temporal inesperada");
    await fs.rm(resolved, { recursive: true, force: true });
  }
}
if (require.main === module) runEvaluation().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { runEvaluation, matrix, caseBuffer };
