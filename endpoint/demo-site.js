"use strict";
// Sitio receptor independiente del motor DLP para ensayar el complemento.
const express = require("express");
const multer = require("multer");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { PROJECT } = require("./config");

function createDemoSite(directory) {
  const app = express();
  const receipts = [];
  fs.mkdirSync(directory, { recursive: true });
  const receive = (kind, name, buffer) => {
    const id = crypto.randomUUID();
    const safe = path.basename(name).replace(/[^\p{L}\p{N}._-]/gu, "_").slice(0, 100);
    fs.writeFileSync(path.join(directory, `${id}-${safe}`), buffer, { flag: "wx" });
    const receipt = { id, kind, file: safe, size: buffer.length, sha256: crypto.createHash("sha256").update(buffer).digest("hex"), timestamp: new Date().toISOString() };
    receipts.push(receipt);
    fs.appendFileSync(path.join(directory, "recepciones.jsonl"), JSON.stringify(receipt) + "\n");
    return receipt;
  };
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 20 } });
  app.post("/upload", upload.array("archivo", 20), (req, res) => {
    if (!req.files?.length) return res.status(400).json({ error: "Sin archivos" });
    res.json({ receipts: req.files.map((file) => receive("file", file.originalname, file.buffer)) });
  });
  app.post("/text", express.json({ limit: "1mb" }), (req, res) => {
    if (typeof req.body.text !== "string") return res.sendStatus(400);
    res.json({ receipt: receive("text", "texto.txt", Buffer.from(req.body.text)) });
  });
  app.use(express.static(path.join(__dirname, "demo-site")));
  return { app, receipts };
}
if (require.main === module) {
  const { app } = createDemoSite(process.env.DLP_DEMO_DIR || path.join(PROJECT, "laboratorio", "sitio-independiente"));
  const host = process.env.DLP_DEMO_HOST || "127.0.0.1", port = Number(process.env.DLP_DEMO_PORT || 4200);
  app.listen(port, host, () => console.log(`Sitio de pruebas independiente: http://${host}:${port}`));
}
module.exports = { createDemoSite };
