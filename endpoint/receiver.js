"use strict";

// Receptor para escenarios controlados. No es un destino de internet.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const { PROJECT } = require("./config");

function createReceiver(directory) {
  const app = express();
  const receipts = [];
  fs.mkdirSync(directory, { recursive: true });
  app.post("/upload", express.raw({ type: "application/octet-stream", limit: "10mb" }), (req, res) => {
    if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: "Se requiere contenido binario" });
    let name;
    try { name = decodeURIComponent(req.headers["x-dlp-file-name"] || "archivo.txt"); } catch { return res.sendStatus(400); }
    const id = crypto.randomUUID();
    const safe = path.basename(name).replace(/[^\p{L}\p{N}._-]/gu, "_").slice(0, 100);
    fs.writeFileSync(path.join(directory, `${id}-${safe || "archivo"}`), req.body, { flag: "wx" });
    const receipt = { id, file: safe, bytes: req.body.length, sha256: crypto.createHash("sha256").update(req.body).digest("hex"), timestamp: new Date().toISOString() };
    receipts.push(receipt);
    fs.appendFileSync(path.join(directory, "recepciones.jsonl"), JSON.stringify(receipt) + "\n");
    res.json(receipt);
  });
  return { app, receipts };
}

if (require.main === module) {
  const host = process.env.DLP_RECEIVER_HOST || "127.0.0.1";
  const port = Number(process.env.DLP_RECEIVER_PORT || 4100);
  const { app } = createReceiver(process.env.DLP_RECEIVER_DIR || path.join(PROJECT, "laboratorio", "receptor-http"));
  app.listen(port, host, () => console.log(`Receptor de laboratorio: http://${host}:${port}/upload`));
}

module.exports = { createReceiver };
