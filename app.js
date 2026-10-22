"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { TextDecoder } = require("node:util");
const express = require("express");
const multer = require("multer");
const { rules, analyzeContent } = require("./lib/classifier");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const dataDirectory = process.env.DLP_DATA_DIR || __dirname;
const receivedDirectory = path.join(dataDirectory, "recibidos");
const logsDirectory = path.join(dataDirectory, "logs");
const eventsFile = path.join(logsDirectory, "eventos.jsonl");

fs.mkdirSync(receivedDirectory, { recursive: true });
fs.mkdirSync(logsDirectory, { recursive: true });

function safeFileName(originalName) {
  const baseName = path.basename(originalName);
  const normalized = baseName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);

  return normalized || "archivo_sin_nombre.txt";
}

function clientIp(request) {
  return (request.ip || request.socket.remoteAddress || "desconocida").replace(
    "::ffff:",
    ""
  );
}

function appendEvent(event) {
  fs.appendFileSync(eventsFile, `${JSON.stringify(event)}\n`, "utf8");
}

function readRecentEvents(limit = 50) {
  if (!fs.existsSync(eventsFile)) {
    return [];
  }

  return fs
    .readFileSync(eventsFile, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit)
    .reverse()
    .map((line) => JSON.parse(line));
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: 1024 * 1024,
  },
  fileFilter: (_request, file, callback) => {
    const allowedExtensions = new Set([".txt", ".csv", ".json"]);
    const extension = path.extname(file.originalname).toLowerCase();

    if (!allowedExtensions.has(extension)) {
      return callback(new Error("Solo se permiten archivos TXT, CSV y JSON."));
    }

    callback(null, true);
  },
});

app.disable("x-powered-by");
app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'"
  );
  next();
});
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "DLP académico" });
});

app.get("/api/policies", (_request, response) => {
  response.json(
    rules.map(({ id, name, description, points }) => ({
      id,
      name,
      description,
      points,
    }))
  );
});

app.get("/api/events", (_request, response, next) => {
  try {
    response.json(readRecentEvents());
  } catch (error) {
    next(error);
  }
});

app.post("/api/upload", upload.single("archivo"), (request, response, next) => {
  try {
    if (!request.file) {
      return response.status(400).json({
        decision: "ERROR",
        message: "No se recibió ningún archivo.",
      });
    }

    let content;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(
        request.file.buffer
      );
    } catch {
      return response.status(400).json({
        decision: "ERROR",
        message: "El archivo no contiene texto UTF-8 válido.",
      });
    }

    const originalName = safeFileName(request.file.originalname);
    const result = analyzeContent(content, request.file.originalname);
    const eventId = crypto.randomUUID();
    let storedName = null;

    if (result.decision !== "BLOQUEADO") {
      storedName = `${eventId}-${originalName}`;
      fs.writeFileSync(
        path.join(receivedDirectory, storedName),
        request.file.buffer,
        { flag: "wx" }
      );
    }

    const event = {
      id: eventId,
      timestamp: new Date().toISOString(),
      clientIp: clientIp(request),
      file: originalName,
      storedName,
      size: request.file.size,
      score: result.score,
      matches: result.matches,
      decision: result.decision,
    };

    appendEvent(event);

    const statusCode = result.decision === "BLOQUEADO" ? 403 : 200;
    return response.status(statusCode).json({
      ...event,
      message:
        result.decision === "BLOQUEADO"
          ? "Transferencia bloqueada por la política DLP. El archivo no fue almacenado."
          : result.decision === "ALERTA"
            ? "Transferencia permitida con alerta y registrada para revisión."
            : "Transferencia permitida y registrada.",
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  const isSizeError = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE";
  const statusCode = isSizeError || error.message.startsWith("Solo se permiten") ? 400 : 500;

  response.status(statusCode).json({
    decision: "ERROR",
    message: isSizeError
      ? "El archivo supera el límite de 1 MB."
      : statusCode === 400
        ? error.message
        : "Ocurrió un error interno al procesar el archivo.",
  });
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`DLP iniciado en http://localhost:${PORT}`);
    console.log(`Escuchando conexiones de laboratorio en ${HOST}:${PORT}`);
  });
}

module.exports = { app, analyzeContent, rules };
