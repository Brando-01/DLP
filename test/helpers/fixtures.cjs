"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { EventEmitter } = require("node:events");

function pdfBuffer(text = "", pages = 1) {
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream = `BT /F1 12 Tf 50 750 Td (${escaped}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${Array(pages).fill("3 0 R").join(" ")}] /Count ${pages} >>`, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let result = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(result)); result += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result);
}
async function docxBuffer(text) {
  const JSZip = require("jszip");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const xml = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${xml}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
async function xlsxBuffer(rows) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Datos ficticios").addRows(rows);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
class FakeBridge extends EventEmitter {
  constructor() { super(); this.calls = []; this.info = { available: true, clipboard: "OBSERVACION_REACTIVA", drives: [], printers: ["Impresora de prueba"], printingObservation: "OBSERVACION_POSTERIOR" }; }
  start() { this.emit("status", this.info); }
  async request(action, args) { this.calls.push({ action, args }); return { completed: true, cleared: action === "clearClipboard", written: action === "writeClipboard", submitted: action === "print" }; }
  async stop() {}
}
async function temporary() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dlp-endpoint-test-"));
  return { root, cleanup: async () => {
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith("dlp-endpoint-test-")) throw new Error("Destino temporal no válido");
    await fs.rm(resolved, { recursive: true, force: true });
  } };
}
module.exports = { pdfBuffer, docxBuffer, xlsxBuffer, FakeBridge, temporary };
