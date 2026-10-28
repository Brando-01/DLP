"use strict";

const path = require("node:path");
const { parentPort, workerData } = require("node:worker_threads");
const { TextDecoder } = require("node:util");
const TEXT_EXTENSIONS = new Set([".txt", ".csv", ".json", ".md", ".log", ".xml", ".yaml", ".yml", ".ini", ".conf", ".sql", ".js", ".ts", ".py", ".ps1", ".html"]);

function validateOfficeZip(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Contenedor Office no válido");
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (entries > 10000 || entries === 65535) throw new Error("Contenedor Office demasiado complejo");
  let total = 0;
  const names = [];
  for (let i = 0; i < entries; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Directorio Office inválido");
    const flags = buffer.readUInt16LE(offset + 8);
    const expanded = buffer.readUInt32LE(offset + 24);
    if (flags & 1 || expanded > 16 * 1024 * 1024) throw new Error("Documento cifrado o expansión excesiva");
    total += expanded;
    if (total > 32 * 1024 * 1024) throw new Error("Expansión Office superior a 32 MiB");
    const name = buffer.subarray(offset + 46, offset + 46 + buffer.readUInt16LE(offset + 28)).toString("utf8");
    if (name.includes("../") || name.startsWith("/") || name.includes("\\")) throw new Error("Ruta de contenedor no admitida");
    names.push(name);
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  return names;
}

function detectFormat(buffer, fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"))) return ".pdf";
  if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    const names = validateOfficeZip(buffer);
    if (names.includes("word/document.xml")) return ".docx";
    if (names.includes("xl/workbook.xml")) return ".xlsx";
    throw new Error("Archivo ZIP no inspeccionable: archivo general, cifrado o tipo no admitido");
  }
  if (buffer.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) || buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) || [".gpg", ".pgp", ".7z"].includes(extension) || buffer.subarray(0, 100).includes(Buffer.from("-----BEGIN PGP MESSAGE-----"))) throw new Error("Contenido cifrado o contenedor no inspeccionable");
  if ([".jpg", ".jpeg", ".png", ".gif"].includes(extension)) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (!/[\x00-\x08\x0e-\x1f]/.test(text)) return ".txt";
  }
  return extension;
}

async function extractDocument(buffer, fileName, depth = 0) {
  const declared = path.extname(fileName).toLowerCase();
  const extension = detectFormat(buffer, fileName);
  let text = "", ruleFileName = fileName, nestedPartial = false;
  const transformations = [];
  if (TEXT_EXTENSIONS.has(extension)) {
    const encoding = buffer[0] === 0xff && buffer[1] === 0xfe ? "utf-16le" : "utf-8";
    text = new TextDecoder(encoding, { fatal: true }).decode(buffer);
    if (text.includes("\0")) throw new Error("El contenido parece binario");
  } else if (extension === ".pdf") {
    if (!buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new Error("La firma no corresponde a PDF");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
    const doc = await task.promise;
    try {
      if (doc.numPages > 100) throw new Error("PDF superior al límite de 100 páginas");
      for (let i = 1; i <= doc.numPages; i += 1) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item) => item.str + (item.hasEOL ? "\n" : " ")).join("") + "\n";
        if (text.length > workerData.maxCharacters) break;
        page.cleanup();
      }
    } finally { await task.destroy(); }
    if (!text.trim()) throw new Error("PDF sin texto extraíble; requiere OCR");
  } else if (extension === ".docx") {
    validateOfficeZip(buffer);
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ buffer }, { externalFileAccess: false });
    if (result.messages.some((m) => m.type === "error")) throw new Error("Extracción Word incompleta");
    text = result.value;
    if (!text.trim()) throw new Error("Word sin texto extraíble");
  } else if (extension === ".xlsx") {
    validateOfficeZip(buffer);
    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    let cells = 0;
    for (const sheet of workbook.worksheets) {
      const headers = [];
      sheet.getRow(1).eachCell((cell, index) => { headers[index] = cell.text; });
      sheet.eachRow((row, index) => {
        row.eachCell((cell, column) => {
          cells += 1;
          if (cells > 50000) throw new Error("Excel superior al límite de celdas");
          text += index > 1 && headers[column] ? `${headers[column]}: ${cell.text}\n` : `${cell.text}\n`;
        });
      });
    }
    ruleFileName = "libro.txt";
    if (!text.trim()) throw new Error("Excel sin texto extraíble");
  } else throw new Error("Formato no admitido para inspección");

  if (depth < 2 && TEXT_EXTENSIONS.has(extension)) {
    const candidates = [...text.matchAll(/(?:[A-Za-z0-9+/]{24,}={0,2})/g)];
    if (candidates.length > 20) nestedPartial = true;
    for (const match of candidates.slice(0, 20)) {
      const encoded = match[0];
      if (encoded.length % 4 || encoded.length > 280000) continue;
      const decoded = Buffer.from(encoded, "base64");
      if (decoded.toString("base64") !== encoded) continue;
      const explicit = text.trim() === encoded || /(?:base64|data:[^\s]*;base64,)\s*["':=\s]*$/i.test(text.slice(Math.max(0, match.index - 80), match.index));
      let value;
      try {
        const decodedText = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
        if (/[\x00-\x08\x0e-\x1f]/.test(decodedText)) throw new Error();
        value = { text: decodedText, status: "COMPLETE" };
      } catch {
        if (!explicit) continue;
        value = await extractDocument(decoded, "decodificado.bin", depth + 1);
      }
      if (value.text) { text += `\n[CONTENIDO DECODIFICADO]\n${value.text}`; transformations.push("BASE64_DECODED"); }
      if (value.status !== "COMPLETE") nestedPartial = true;
      if (text.length > workerData.maxCharacters) break;
    }
  }

  const partial = text.length > workerData.maxCharacters || nestedPartial;
  return { status: partial ? "PARTIAL" : "COMPLETE", text: text.slice(0, workerData.maxCharacters), format: declared.slice(1), detectedFormat: extension.slice(1), formatMismatch: declared !== extension, transformations, ruleFileName, reason: partial ? "Extracción incompleta por límites de texto o codificación" : null };
}

extractDocument(Buffer.from(workerData.buffer), workerData.fileName).then((result) => parentPort.postMessage(result)).catch(() => parentPort.postMessage({ status: "UNANALYZABLE", text: "", reason: "No se pudo inspeccionar completamente el formato o el contenido", format: path.extname(workerData.fileName).slice(1) }));
