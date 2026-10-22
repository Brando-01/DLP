"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const { Worker } = require("node:worker_threads");
const { analyzeContent } = require("./classifier");
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function extractText(buffer, fileName, options = {}) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError("Se esperaba un Buffer");
  if (buffer.length > (options.maxBytes || MAX_FILE_BYTES)) return Promise.resolve({ status: "UNANALYZABLE", text: "", reason: "Archivo superior al límite de inspección" });
  return new Promise((resolve) => {
    let done = false;
    const worker = new Worker(path.join(__dirname, "extract-worker.js"), {
      workerData: { buffer, fileName: path.basename(fileName), maxCharacters: options.maxCharacters || 200000 },
      resourceLimits: { maxOldGenerationSizeMb: 192, stackSizeMb: 8 }, stdout: true, stderr: true,
    });
    worker.stdout.resume(); worker.stderr.resume();
    const finish = (result) => { if (done) return; done = true; clearTimeout(timer); resolve(result); worker.terminate().catch(() => {}); };
    const timer = setTimeout(() => finish({ status: "UNANALYZABLE", text: "", reason: "Tiempo de inspección agotado" }), options.timeoutMs || 8000);
    worker.on("message", finish);
    worker.on("error", () => finish({ status: "UNANALYZABLE", text: "", reason: "El lector no pudo procesar el documento" }));
    worker.on("exit", () => finish({ status: "UNANALYZABLE", text: "", reason: "El lector finalizó sin resultado" }));
  });
}

async function inspectBuffer(buffer, fileName, options) {
  const extracted = await extractText(buffer, fileName, options);
  const analysis = extracted.status === "UNANALYZABLE" ? { score: 0, matches: [], classification: "NO_ANALIZABLE" } : analyzeContent(extracted.text, extracted.ruleFileName || fileName);
  return { ...analysis, inspectionStatus: extracted.status, reason: extracted.reason, format: extracted.format, sha256: crypto.createHash("sha256").update(buffer).digest("hex"), size: buffer.length };
}

module.exports = { extractText, inspectBuffer, MAX_FILE_BYTES };
