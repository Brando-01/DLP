"use strict";
require("../lib/environment");
const { createSemanticClassifier } = require("../lib/semantic");
async function run() {
  if (!process.env.GROQ_API_KEY) throw new Error("Configura GROQ_API_KEY en .env. No la pegues en el chat ni en el repositorio.");
  const classifier = createSemanticClassifier({ settings: () => ({ mode: "hybrid", key: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL || "openai/gpt-oss-20b" }) });
  const result = await classifier.classify("Documento de prueba ficticio. María Torres obtuvo diecisiete en su evaluación del curso. Registro académico individual no publicado.");
  console.log(JSON.stringify({ provider: "Groq", status: result.status, classification: result.classification, categories: result.categories, model: result.model, sample: "DATOS_FICTICIOS", keyPrinted: false }, null, 2));
  if (result.status !== "COMPLETE") process.exitCode = 1;
}
if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
