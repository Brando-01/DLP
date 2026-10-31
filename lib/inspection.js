"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const { Worker } = require("node:worker_threads");
const { analyzeContent } = require("./classifier");
const { semanticClassifier } = require("./semantic");
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

async function inspectBuffer(buffer, fileName, options = {}) {
  const extracted = await extractText(buffer, fileName, options);
  const analysis = extracted.status === "UNANALYZABLE" ? { score: 0, matches: [], classification: "NO_ANALIZABLE" } : analyzeContent(extracted.text, extracted.ruleFileName || fileName);
  // Solo el extractor puede acreditar vacío: nunca basta con tamaño cero,
  // extensión o una extracción fallida (p. ej. PDF escaneado / Office cifrado).
  const emptyContent = extracted.status === "COMPLETE" && !extracted.text.trim();
  const semantic = emptyContent ? { status: "EMPTY_CONTENT", required: false } : options.semantic && extracted.status === "COMPLETE" && analysis.score < 3 ? await (options.classifier || semanticClassifier).classify(extracted.text) : { status: options.semantic && analysis.score >= 3 ? "BYPASSED_LOCAL_BLOCK" : "NOT_REQUESTED", required: false };
  if (["COMPLETE", "NO_DETERMINADO"].includes(semantic.status) && ["INTERNO", "CONFIDENCIAL", "RESTRINGIDO"].includes(semantic.classification)) {
    const score = { INTERNO: 1, CONFIDENCIAL: 3, RESTRINGIDO: 5 }[semantic.classification];
    analysis.score = Math.max(score, analysis.score);
    const order = ["PUBLICO", "INTERNO", "CONFIDENCIAL", "RESTRINGIDO"];
    if (order.indexOf(semantic.classification) > order.indexOf(analysis.classification)) analysis.classification = semantic.classification;
    analysis.matches.push({ id: "LLM-001", name: "Clasificación semántica", points: score });
  }
  analysis.decision = analysis.score >= 3 ? "BLOQUEADO" : analysis.score > 0 ? "ALERTA" : "PERMITIDO";
  return { ...analysis, semantic, emptyContent, inspectionStatus: extracted.status, reason: extracted.reason, format: extracted.format, detectedFormat: extracted.detectedFormat, formatMismatch: extracted.formatMismatch || false, transformations: extracted.transformations || [], sha256: crypto.createHash("sha256").update(buffer).digest("hex"), size: buffer.length };
}

module.exports = { extractText, inspectBuffer, MAX_FILE_BYTES };
