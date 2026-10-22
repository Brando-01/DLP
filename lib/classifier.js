"use strict";

function hasCardNumber(text) {
  const candidates = text.match(/\b(?:\d[ -]?){13,19}\b/g) || [];
  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
    let sum = 0;
    let double = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
      let value = Number(digits[i]);
      if (double) value = value * 2 > 9 ? value * 2 - 9 : value * 2;
      sum += value;
      double = !double;
    }
    return sum % 10 === 0;
  });
}

const rules = [
  { id: "DLP-001", name: "Clasificación confidencial", description: "Campo de clasificación confidencial.", pattern: /["']?CLASIFICACI[OÓ]N["']?\s*:\s*["']?CONFIDENCIAL\b/i, points: 3 },
  { id: "DLP-002", name: "Clasificación restringida", description: "Campo de clasificación restringida.", pattern: /["']?CLASIFICACI[OÓ]N["']?\s*:\s*["']?RESTRINGID[OA]\b/i, points: 5 },
  { id: "DLP-003", name: "Código de estudiante", description: "Código de ocho dígitos en un campo de estudiante.", pattern: /["']?C[OÓ]DIGO[_\s]+(?:DE[_\s]+)?(?:ESTUDIANTE|ALUMNO)["']?\s*:\s*["']?\d{8}\b/i, points: 2 },
  { id: "DLP-004", name: "Nota académica", description: "Nota final con patrón de valor entre 0 y 20.", pattern: /["']?NOTA[_\s]+FINAL["']?\s*:\s*["']?(?:20(?:[.,]0+)?|1?\d(?:[.,]\d+)?)(?![\d.,])/i, points: 2 },
  { id: "DLP-005", name: "Correo institucional", description: "Correo del dominio ficticio universidad.edu.pe.", pattern: /[a-z0-9._%+-]+@universidad\.edu\.pe\b/i, points: 1 },
  { id: "DLP-006", name: "Contraseña temporal", description: "Etiqueta de contraseña temporal.", pattern: /CONTRASE[NÑ]A_TEMPORAL\s*:/i, points: 3 },
  { id: "DLP-007", name: "Estudiante con calificación en texto", description: "Coexistencia de nombre de estudiante y calificación final en el contenido.", patterns: [/\b(?:ESTUDIANTE|ALUMN[OA])(?:\s+FICTICI[OA])?\s*:\s*\p{L}+(?:\s+\p{L}+){1,3}/iu, /\b(?:CALIFICACI[OÓ]N|NOTA)\s+FINAL\s*(?:FUE|ES|:)?\s*(?:20(?:[.,]0+)?|1?\d(?:[.,]\d+)?)(?![\d.,])/i], points: 3 },
  { id: "DLP-008", name: "Documento de identidad", description: "Campo DNI con ocho dígitos; no verifica su titularidad.", pattern: /\b["']?DNI["']?\s*[:=]\s*["']?\d{8}\b/i, points: 3 },
  { id: "DLP-009", name: "Secreto o credencial", description: "Campo de clave, contraseña o token con un valor no vacío.", pattern: /["']?\b(?:API[_ -]?KEY|SECRET[_ -]?KEY|ACCESS[_ -]?TOKEN|PASSWORD|CONTRASE[NÑ]A)["']?\s*[:=]\s*["']?[^\s"',;}{]{6,}/i, points: 4 },
  { id: "DLP-010", name: "Número de tarjeta", description: "Secuencia de 13 a 19 dígitos que satisface Luhn; puede ser un número de prueba.", test: hasCardNumber, points: 5 },
  { id: "DLP-011", name: "Información clínica", description: "Campo de diagnóstico o historia clínica asociado a contenido.", pattern: /\b(?:DIAGN[OÓ]STICO|HISTORIA[_\s]+CL[IÍ]NICA)\s*[:=]\s*\S.{3,}/i, points: 3 },
];

function parseCsvRows(content) {
  const rows = [];
  const firstLine = content.split(/\r?\n/, 1)[0] || "";
  const delimiter = firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (char === '"') {
      if (quoted && content[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\r" || char === "\n") && !quoted) {
      if (char === "\r" && content[i + 1] === "\n") i += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (quoted) return [];
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function csvFieldsAsText(content) {
  const rows = parseCsvRows(content.replace(/^\uFEFF/, ""));
  if (rows.length < 2 || rows[0].length < 2) return "";
  return rows.slice(1).map((row) => rows[0].map((header, i) => `${header.trim()}: ${row[i] || ""}`).join("\n")).join("\n");
}

function analyzeContent(content, fileName = "") {
  const normalized = String(content).normalize("NFC");
  const scanText = /\.csv$/i.test(fileName) ? `${normalized}\n${csvFieldsAsText(normalized)}` : normalized;
  const matches = rules.filter((rule) => rule.test ? rule.test(scanText) : rule.pattern ? rule.pattern.test(scanText) : rule.patterns.every((p) => p.test(scanText))).map(({ id, name, points }) => ({ id, name, points }));
  const score = matches.reduce((total, match) => total + match.points, 0);
  const decision = score >= 3 ? "BLOQUEADO" : score > 0 ? "ALERTA" : "PERMITIDO";
  const classification = matches.some((m) => m.id === "DLP-002" || m.id === "DLP-010") ? "RESTRINGIDO" : score >= 3 ? "CONFIDENCIAL" : score > 0 ? "INTERNO" : "PUBLICO";
  return { decision, classification, score, matches };
}

module.exports = { rules, analyzeContent, parseCsvRows, csvFieldsAsText, hasCardNumber };
