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
  for (let i = 0; i < entries; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Directorio Office inválido");
    const flags = buffer.readUInt16LE(offset + 8);
    const expanded = buffer.readUInt32LE(offset + 24);
    if (flags & 1 || expanded > 16 * 1024 * 1024) throw new Error("Documento cifrado o expansión excesiva");
    total += expanded;
    if (total > 32 * 1024 * 1024) throw new Error("Expansión Office superior a 32 MiB");
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
}

async function extract() {
  const buffer = Buffer.from(workerData.buffer);
  const extension = path.extname(workerData.fileName).toLowerCase();
  let text = "", ruleFileName = workerData.fileName;
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

  const partial = text.length > workerData.maxCharacters;
  return { status: partial ? "PARTIAL" : "COMPLETE", text: text.slice(0, workerData.maxCharacters), format: extension.slice(1), ruleFileName, reason: partial ? "Texto superior al límite de inspección" : null };
}

extract().then((result) => parentPort.postMessage(result)).catch((error) => parentPort.postMessage({ status: "UNANALYZABLE", text: "", reason: String(error.message).slice(0, 160), format: path.extname(workerData.fileName).slice(1) }));
