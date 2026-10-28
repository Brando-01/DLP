"use strict";
require("../lib/environment");
const fs = require("node:fs/promises");
const path = require("node:path");
const { inspectBuffer } = require("../lib/inspection");
const { decide } = require("../lib/policy");
const { semanticClassifier } = require("../lib/semantic");
const { caseBuffer, matrix } = require("./evaluar-endpoint");
async function run() {
  if (!process.env.GROQ_API_KEY || process.env.DLP_LLM_MODE !== "hybrid") throw new Error("Primero configura la clave y DLP_LLM_MODE=hybrid en .env. No hay resultados Groq verificados todavía.");
  const cases = JSON.parse(await fs.readFile(path.join(__dirname, "casos-endpoint.json"), "utf8"));
  const results = [];
  for (const item of cases) {
    const buffer = await caseBuffer(item);
    const inspection = await inspectBuffer(buffer, item.file, { semantic: true });
    const policy = decide(inspection, "web_proxy");
    results.push({ id: item.id, sensitive: item.sensitive, file: item.file, score: inspection.score, classification: inspection.classification, detected: policy.detected, prevented: !policy.allowed, semanticStatus: inspection.semantic.status, inspectionStatus: inspection.inspectionStatus });
    // El plan gratuito no es un servicio sin límites. Las cuotas de la cuenta pueden exigir una pausa mayor.
    if (inspection.semantic.required) await new Promise((resolve) => setTimeout(resolve, 15000));
  }
  const unknown = results.filter((r) => r.inspectionStatus !== "COMPLETE" || !["OFF", "NOT_REQUESTED", "COMPLETE", "BYPASSED_LOCAL_BLOCK"].includes(r.semanticStatus));
  const report = { generatedAt: new Date().toISOString(), liveGroqUsed: results.some((r) => r.semanticStatus === "COMPLETE"), providerCalls: semanticClassifier.status().calls, semanticCompleted: results.filter((r) => r.semanticStatus === "COMPLETE").length, model: process.env.GROQ_MODEL || "openai/gpt-oss-20b", documents: cases.length, semanticIncomplete: unknown.length, detection: matrix(results, (r) => r.detected), prevention: matrix(results, (r) => r.prevented), results, limitation: "Conjunto de desarrollo, no evaluación independiente. Un fallo de proveedor se contabiliza como falta de inspección; el bloqueo no acredita detección semántica." };
  const output = path.join(__dirname, "../output/evaluacion/resultado-hibrido-groq.json");
  await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ documents: cases.length, semanticIncomplete: unknown.length, detection: report.detection, prevention: report.prevention }, null, 2));
  if (unknown.some((r) => ["PENDING_KEY", "ERROR"].includes(r.semanticStatus))) process.exitCode = 1;
}
if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
