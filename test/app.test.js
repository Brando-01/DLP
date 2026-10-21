"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dlp-test-"));
process.env.DLP_DATA_DIR = testDirectory;

const { app, analyzeContent } = require("../app");
let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

async function upload(name, content) {
  const body = new FormData();
  body.append("archivo", new Blob([content], { type: "text/plain" }), name);
  const response = await fetch(`${baseUrl}/api/upload`, { method: "POST", body });
  return { status: response.status, data: await response.json() };
}

test("el analizador distingue los tres resultados", () => {
  assert.equal(analyzeContent("HORARIO DE CLASES").decision, "PERMITIDO");
  assert.equal(analyzeContent("Contacto: ana@universidad.edu.pe").decision, "ALERTA");
  assert.equal(analyzeContent("CLASIFICACION: CONFIDENCIAL").decision, "BLOQUEADO");
});

test("permite y almacena un archivo público", async () => {
  const result = await upload("publico.txt", "HORARIO DE CLASES\nAula: 301");
  assert.equal(result.status, 200);
  assert.equal(result.data.decision, "PERMITIDO");
  assert.ok(result.data.storedName);
  assert.ok(fs.existsSync(path.join(testDirectory, "recibidos", result.data.storedName)));
});

test("permite con alerta un indicador de bajo riesgo", async () => {
  const result = await upload("interno.txt", "Contacto: ana@universidad.edu.pe");
  assert.equal(result.status, 200);
  assert.equal(result.data.decision, "ALERTA");
  assert.equal(result.data.score, 1);
});

test("bloquea y no almacena un archivo confidencial", async () => {
  const result = await upload(
    "confidencial.txt",
    "CLASIFICACION: CONFIDENCIAL\nCODIGO_ESTUDIANTE: 20261234\nNOTA_FINAL: 18"
  );
  assert.equal(result.status, 403);
  assert.equal(result.data.decision, "BLOQUEADO");
  assert.equal(result.data.storedName, null);
});

test("bloquea una clasificación sensible en JSON compacto", async () => {
  const result = await upload(
    "reporte.json",
    '{"clasificacion":"CONFIDENCIAL","informe":"interno ficticio"}'
  );
  assert.equal(result.status, 403);
  assert.equal(result.data.decision, "BLOQUEADO");
  assert.equal(result.data.storedName, null);
});

test("bloquea un JSON con código y nota aunque no tenga clasificación", async () => {
  const result = await upload(
    "registro.json",
    '{"codigo_estudiante":"20261234","nota_final":18}'
  );
  assert.equal(result.status, 403);
  assert.equal(result.data.decision, "BLOQUEADO");
  assert.equal(result.data.score, 4);
  assert.equal(result.data.storedName, null);
});

test("bloquea una fila CSV real con código y nota", async () => {
  const result = await upload(
    "registro.csv",
    'codigo_estudiante,nota_final,nombre\n20261234,18,"Ana, Rojas"\n'
  );
  assert.equal(result.status, 403);
  assert.equal(result.data.decision, "BLOQUEADO");
  assert.equal(result.data.score, 4);
});

test("bloquea un registro privado en texto sin etiqueta CONFIDENCIAL", async () => {
  const result = await upload(
    "notas.txt",
    "Estudiante: Rosa Pérez. Su calificación final fue 17 sobre 20."
  );
  assert.equal(result.status, 403);
  assert.equal(result.data.decision, "BLOQUEADO");
  assert.ok(result.data.matches.some((match) => match.id === "DLP-007"));
});

test("rechaza extensiones no admitidas", async () => {
  const result = await upload("imagen.png", "contenido simulado");
  assert.equal(result.status, 400);
  assert.equal(result.data.decision, "ERROR");
});
