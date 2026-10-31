"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { inspectBuffer, extractText } = require("../lib/inspection");
const { analyzeContent } = require("../lib/classifier");
const { decide, validatePolicies } = require("../lib/policy");
const { pdfBuffer, docxBuffer, xlsxBuffer } = require("./helpers/fixtures.cjs");

test("lee TXT UTF-8 y UTF-16 sin convertir binarios en documentos públicos", async () => {
  assert.equal((await inspectBuffer(Buffer.from("DNI: 12345678"), "persona.txt")).classification, "CONFIDENCIAL");
  const utf16 = Buffer.concat([Buffer.from([255, 254]), Buffer.from("CLASIFICACION: RESTRINGIDO", "utf16le")]);
  assert.equal((await inspectBuffer(utf16, "persona.txt")).classification, "RESTRINGIDO");
  assert.equal((await inspectBuffer(Buffer.from([0, 1, 255]), "falso.txt")).inspectionStatus, "UNANALYZABLE");
});
test("extrae y clasifica un PDF real y rechaza un PDF que necesita OCR", async () => {
  const confidential = await inspectBuffer(pdfBuffer("CLASIFICACION: CONFIDENCIAL"), "notas.pdf");
  assert.equal(confidential.inspectionStatus, "COMPLETE");
  assert.equal(confidential.classification, "CONFIDENCIAL");
  const scanned = await inspectBuffer(pdfBuffer(""), "escaneo.pdf");
  assert.equal(scanned.inspectionStatus, "UNANALYZABLE");
  assert.equal(decide(scanned, "usb").allowed, false);
});
test("extrae texto de Word y campos tabulares de Excel sin ejecutar sus contenidos", async () => {
  const word = await inspectBuffer(await docxBuffer("DNI: 12345678"), "documento.docx");
  assert.equal(word.classification, "CONFIDENCIAL");
  assert.equal(word.inspectionStatus, "COMPLETE");
  const excel = await inspectBuffer(await xlsxBuffer([["codigo_estudiante", "nota_final"], ["20261234", 18]]), "notas.xlsx");
  assert.equal(excel.inspectionStatus, "COMPLETE");
  assert.equal(excel.score, 4);
});
test("vacíos válidos TXT, Word y Excel no necesitan Groq ni quedan retenidos", async () => {
  const classifier = { classify: async () => { throw new Error("No consultar IA para contenido vacío acreditado"); } };
  for (const [name, bytes] of [["vacio.txt", Buffer.alloc(0)], ["espacios.txt", Buffer.from(" \r\n\t")], ["vacio.docx", await docxBuffer("")], ["vacio.xlsx", await xlsxBuffer([])]]) {
    const result = await inspectBuffer(bytes, name, { semantic: true, classifier });
    assert.equal(result.inspectionStatus, "COMPLETE", name);
    assert.equal(result.emptyContent, true, name);
    assert.equal(result.classification, "PUBLICO", name);
    assert.equal(result.semantic.status, "EMPTY_CONTENT", name);
    assert.equal(result.semantic.required, false, name);
    assert.equal(decide(result, "browser_file").allowed, true, name);
  }
});
test("una extracción sin texto no confunde Office con imágenes o contenido opaco con vacío", async () => {
  const JSZip = require("jszip");
  for (const [name, bytes, entry] of [["imagen.docx", await docxBuffer(""), "word/media/image1.png"], ["objeto.docx", await docxBuffer(""), "word/embeddings/objeto.bin"], ["comentario.docx", await docxBuffer(""), "word/comments.xml"], ["imagen.xlsx", await xlsxBuffer([]), "xl/media/image1.png"]]) {
    const zip = await JSZip.loadAsync(bytes);
    zip.file(entry, "DNI: 12345678");
    const result = await inspectBuffer(await zip.generateAsync({ type: "nodebuffer" }), name, { semantic: true });
    assert.equal(result.inspectionStatus, "UNANALYZABLE", name);
    assert.equal(result.emptyContent, false, name);
    assert.equal(decide(result, "browser_file").allowed, false, name);
  }
  const externalDrawing = await JSZip.loadAsync(await docxBuffer(""));
  externalDrawing.file("word/document.xml", (await externalDrawing.file("word/document.xml").async("string")).replace("<w:t></w:t>", "<w:drawing/>"));
  const imageOnly = await inspectBuffer(await externalDrawing.generateAsync({ type: "nodebuffer" }), "externa.docx", { semantic: true });
  assert.equal(imageOnly.inspectionStatus, "UNANALYZABLE");
  assert.equal(decide(imageOnly, "browser_file").allowed, false);
  for (const name of ["vacio.docx", "vacio.xlsx", "vacio.pdf", "vacio.exe", "vacio.gpg", "vacio.jpg", "vacio.png"]) {
    const result = await inspectBuffer(Buffer.alloc(0), name, { semantic: true });
    assert.equal(result.inspectionStatus, "UNANALYZABLE", name);
    assert.equal(decide(result, "browser_file").allowed, false, name);
  }
});
test("un formato desconocido o texto parcial no se permite silenciosamente", async () => {
  const executable = await inspectBuffer(Buffer.from("no es un antivirus"), "programa.exe");
  assert.equal(executable.classification, "NO_ANALIZABLE");
  assert.equal(decide(executable, "http_transfer").decision, "BLOQUEADO");
  const partial = await inspectBuffer(Buffer.from("contenido público ".repeat(100)), "texto.txt", { maxCharacters: 20 });
  assert.equal(partial.inspectionStatus, "PARTIAL");
  assert.equal(decide(partial, "print").allowed, false);
  const timeout = await extractText(Buffer.from("hola"), "hola.txt", { timeoutMs: 1 });
  assert.equal(timeout.status, "UNANALYZABLE");
});

test("Excel no permite fórmulas sensibles como vacío ni confía solo en su resultado guardado", async () => {
  let calls = 0;
  const classifier = { classify: async () => { calls += 1; return { status: "COMPLETE", required: true, classification: "PUBLICO" }; } };
  for (const result of [undefined, "", 0, "Horario público"]) {
    const bytes = await xlsxBuffer([[{ formula: '"DNI: 12345678"', ...(result === undefined ? {} : { result }) }]]);
    const inspected = await inspectBuffer(bytes, "formula-sensible.xlsx", { semantic: true, classifier });
    assert.notEqual(inspected.semantic.status, "EMPTY_CONTENT");
    assert.equal(inspected.emptyContent, false);
    assert.ok(inspected.score >= 3);
    assert.equal(decide(inspected, "browser_file").allowed, false);
  }
  assert.equal(calls, 0, "Las reglas fuertes o la extracción parcial evitan la consulta externa");
});

test("Excel conserva fórmulas públicas completas y retiene cálculos sin resultado sin ejecutarlos", async () => {
  const complete = await inspectBuffer(await xlsxBuffer([[{ formula: "1+2", result: 3 }]]), "calculado.xlsx");
  assert.equal(complete.inspectionStatus, "COMPLETE");
  assert.equal(complete.emptyContent, false);
  assert.equal(decide(complete, "browser_file").allowed, true);
  const unresolved = await inspectBuffer(await xlsxBuffer([[{ formula: "1+2" }]]), "sin-resultado.xlsx");
  assert.equal(unresolved.inspectionStatus, "PARTIAL");
  assert.equal(unresolved.emptyContent, false);
  assert.equal(unresolved.score, 0);
  assert.equal(decide(unresolved, "browser_file").allowed, false);
});

test("Excel inspecciona fórmulas compartidas, hojas ocultas y destino de hipervínculos", async () => {
  const ExcelJS = require("exceljs");
  const book = new ExcelJS.Workbook();
  book.addWorksheet("Visible").getCell("A1").value = "Horario público";
  const hidden = book.addWorksheet("Oculta", { state: "veryHidden" });
  hidden.getCell("A1").value = { formula: '"DNI: 12345678"', result: "" };
  hidden.getCell("A2").value = { sharedFormula: "A1", result: "" };
  const formula = await inspectBuffer(Buffer.from(await book.xlsx.writeBuffer()), "compartida.xlsx");
  assert.equal(formula.emptyContent, false);
  assert.ok(formula.score >= 3);
  assert.equal(decide(formula, "browser_file").allowed, false);
  const link = await inspectBuffer(await xlsxBuffer([[{ text: "Sitio de ejemplo", hyperlink: "https://example.test/?ACCESS_TOKEN=FICTICIO123" }]]), "enlace.xlsx");
  assert.ok(link.score >= 3);
  assert.equal(decide(link, "browser_file").allowed, false);
});

test("agregar texto público no oculta objetos de Office que el lector no puede inspeccionar", async () => {
  const JSZip = require("jszip");
  for (const [name, bytes, entry] of [["word.docx", await docxBuffer("Horario público"), "word/media/image1.png"], ["excel.xlsx", await xlsxBuffer([["Horario público"]]), "xl/embeddings/objeto.bin"]]) {
    const zip = await JSZip.loadAsync(bytes); zip.file(entry, "CONTENIDO_FICTICIO_NO_INSPECCIONADO");
    const inspected = await inspectBuffer(await zip.generateAsync({ type: "nodebuffer" }), name);
    assert.equal(inspected.inspectionStatus, "PARTIAL", name);
    assert.equal(inspected.score, 0, name);
    assert.equal(inspected.emptyContent, false, name);
    assert.equal(decide(inspected, "browser_file").allowed, false, name);
  }
});
test("modo auditoría detecta sin atribuir un bloqueo y modo alerta permite", () => {
  const inspection = { ...analyzeContent("CLASIFICACION: CONFIDENCIAL"), inspectionStatus: "COMPLETE" };
  const audit = validatePolicies({ usb: { mode: "audit", blockScore: 3 } });
  assert.equal(decide(inspection, "usb", audit).decision, "DETECTADO");
  assert.equal(decide(inspection, "usb", audit).allowed, true);
  const alert = validatePolicies({ usb: { mode: "alert", blockScore: 3 } });
  assert.equal(decide(inspection, "usb", alert).decision, "ALERTA");
  assert.equal(decide(inspection, "usb", alert).allowed, true);
  assert.equal(decide(inspection, "usb").allowed, false);
});
test("comprueba Luhn, etiquetas con acentos y CSV con punto y coma", () => {
  assert.equal(analyzeContent("Tarjeta de prueba: 4111 1111 1111 1111").classification, "RESTRINGIDO");
  assert.equal(analyzeContent("Tarjeta: 4111 1111 1111 1112").score, 0);
  assert.equal(analyzeContent("CLASIFICACIÓN: RESTRINGIDA").decision, "BLOQUEADO");
  assert.equal(analyzeContent("codigo_estudiante;nota_final\n20261234;18\n", "notas.csv").score, 4);
  assert.equal(analyzeContent("NOTA_FINAL: 20.5").score, 0);
});
