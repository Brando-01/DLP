"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const cases = require("./casos.json");
assert.equal(cases.length, 20, "La evaluación debe contener 20 casos");
assert.equal(cases.filter((testCase) => testCase.sensitive).length, 10, "Se esperan 10 casos sensibles");
assert.equal(new Set(cases.map((testCase) => testCase.id)).size, cases.length, "Los identificadores deben ser únicos");
const isolatedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dlp-evaluacion-"));
process.env.DLP_DATA_DIR = isolatedDirectory;
const { app } = require("../app");

function confusionMatrix(results, isPositive) {
  const matrix = { TP: 0, FP: 0, TN: 0, FN: 0 };

  for (const result of results) {
    const predicted = isPositive(result.decision);
    const actual = result.sensitive;
    const category = actual ? (predicted ? "TP" : "FN") : (predicted ? "FP" : "TN");
    matrix[category] += 1;
  }

  return matrix;
}

function metrics(matrix) {
  const precisionDenominator = matrix.TP + matrix.FP;
  const recallDenominator = matrix.TP + matrix.FN;

  return {
    precision: precisionDenominator ? matrix.TP / precisionDenominator : 0,
    recall: recallDenominator ? matrix.TP / recallDenominator : 0,
  };
}

function percentage(value) {
  return `${(value * 100).toFixed(1)}%`;
}

async function main() {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  try {
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const results = [];

    for (const testCase of cases) {
      const filePath = path.join(__dirname, testCase.file);
      const content = fs.readFileSync(filePath);
      const form = new FormData();
      form.append("archivo", new Blob([content]), path.basename(filePath));

      const response = await fetch(`${endpoint}/api/upload`, {
        method: "POST",
        body: form,
      });
      const event = await response.json();
      assert.ok(["PERMITIDO", "ALERTA", "BLOQUEADO"].includes(event.decision), `${testCase.id}: respuesta no válida`);
      assert.equal(response.status, event.decision === "BLOQUEADO" ? 403 : 200, `${testCase.id}: estado HTTP`);

      const expectedStored = event.decision !== "BLOQUEADO";
      assert.equal(Boolean(event.storedName), expectedStored, `${testCase.id}: nombre almacenado`);
      if (expectedStored) {
        assert.ok(fs.existsSync(path.join(isolatedDirectory, "recibidos", event.storedName)), `${testCase.id}: archivo permitido ausente`);
      }

      results.push({
        id: testCase.id,
        file: path.basename(filePath),
        sensitive: testCase.sensitive,
        decision: event.decision,
        score: event.score,
        rules: event.matches.map((match) => match.id).join(", ") || "—",
      });
    }

    const recordedEvents = fs.readFileSync(path.join(isolatedDirectory, "logs", "eventos.jsonl"), "utf8")
      .split(/\r?\n/)
      .filter(Boolean);
    assert.equal(recordedEvents.length, cases.length, "Deben quedar registrados todos los intentos");
    const storedFiles = fs.readdirSync(path.join(isolatedDirectory, "recibidos"));
    assert.equal(
      storedFiles.length,
      results.filter((result) => result.decision !== "BLOQUEADO").length,
      "Solo deben almacenarse las transferencias permitidas o con alerta"
    );

    const detection = confusionMatrix(results, (decision) => decision !== "PERMITIDO");
    const prevention = confusionMatrix(results, (decision) => decision === "BLOQUEADO");
    const detectionMetrics = metrics(detection);
    const preventionMetrics = metrics(prevention);

    console.table(results);
    console.log("Detección = ALERTA o BLOQUEADO contra la clasificación real:", detection);
    console.log(`Precisión: ${percentage(detectionMetrics.precision)} | Recall: ${percentage(detectionMetrics.recall)}`);
    console.log("Prevención = BLOQUEADO contra la clasificación real:", prevention);
    console.log(`Precisión: ${percentage(preventionMetrics.precision)} | Recall: ${percentage(preventionMetrics.recall)}`);
    console.log("Los 20 eventos se registraron. Los archivos bloqueados no se almacenaron.");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(isolatedDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
