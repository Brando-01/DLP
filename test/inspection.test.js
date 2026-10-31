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
