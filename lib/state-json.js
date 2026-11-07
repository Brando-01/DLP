"use strict";
const fs = require("node:fs");
const path = require("node:path");
function parseStateJson(text, file, line) {
  try { return JSON.parse(text); }
  catch {
    // SyntaxError.message puede incluir fragmentos de tokens o documentos.
    const error = new Error(`JSON_INVALIDO: ${path.basename(file)}${line ? "; línea " + line : ""}. Ejecuta npm run client:diagnose; no borres el archivo.`);
    error.code = "DLP_STATE_JSON_INVALID";
    throw error;
  }
}
function readStateJson(file) { return parseStateJson(fs.readFileSync(file, "utf8"), file); }
module.exports = { parseStateJson, readStateJson };
