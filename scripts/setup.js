"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { prepareEnvironment } = require("../lib/setup-environment");
const root = path.resolve(__dirname, "..");
async function setup(directory = root) {
  const template = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  const { file, created, repaired, values } = prepareEnvironment(directory, template);
  console.log(created ? ".env creado. Las credenciales internas se generaron sin imprimirlas." : `.env existente conservado. Variables nuevas o vacías preparadas: ${repaired.length}.`);
  console.log("Solo necesitas aportar GROQ_API_KEY. No copies esa clave en la extensión; su token se obtiene del panel Navegador.");
  const state = path.join(directory, "deploy/state"); fs.mkdirSync(state, { recursive: true });
  if (values.DLP_WAZUH_ENROLLMENT_PASSWORD) fs.writeFileSync(path.join(state, "authd.pass"), values.DLP_WAZUH_ENROLLMENT_PASSWORD + "\n", { mode: 0o600 });
  const finance = path.join(directory, "laboratorio/Finanzas"), desktop = path.join(directory, "laboratorio/Escritorio");
  for (const folder of [finance, desktop]) fs.mkdirSync(folder, { recursive: true });
  const { xlsxBuffer, docxBuffer, pdfBuffer } = require("../test/helpers/fixtures.cjs");
  const samples = {
    "publico.txt": Buffer.from("Horario público de biblioteca"),
    "privado.txt": Buffer.from("DNI: 12345678\nExpediente ficticio"),
    "contexto_privado.txt": Buffer.from("María Torres obtuvo diecisiete en la evaluación del curso. Informe individual no publicado."),
    "publico.xlsx": await xlsxBuffer([["curso", "aula"], ["Redes", 301]]),
    "privado.xlsx": await xlsxBuffer([["DNI", "tarjeta"], ["12345678", "4111111111111111"]]),
    "publico.docx": await docxBuffer("Horario público de biblioteca"),
    "privado.docx": await docxBuffer("DNI: 12345678"),
    "renombrado.jpg": await docxBuffer("DNI: 12345678"),
    "vacio.txt": Buffer.alloc(0),
    "vacio.docx": await docxBuffer(""),
    "vacio.xlsx": await xlsxBuffer([]),
    "sin_texto.pdf": pdfBuffer(""),
    "base64_privado.txt": Buffer.from(Buffer.from("DNI: 12345678").toString("base64")),
    "formula_sensible.xlsx": await xlsxBuffer([[{ formula: '"DNI: 12345678"' }]]),
    "formula_publica.xlsx": await xlsxBuffer([[{ formula: "1+2", result: 3 }]]),
  };
  for (const [name, buffer] of Object.entries(samples)) { const destination = path.join(finance, name); if (!fs.existsSync(destination)) fs.writeFileSync(destination, buffer); }
  const { loadState, writeJsonAtomic } = require("../endpoint/config");
  const local = loadState(path.join(directory, "datos-endpoint"));
  if (!local.config.watchRoots.includes(finance) && local.config.watchRoots.length < 20) local.config.watchRoots.push(finance);
  if (!local.config.restrictedDestinations.includes(desktop) && local.config.restrictedDestinations.length < 20) local.config.restrictedDestinations.push(desktop);
  writeJsonAtomic(local.file, local.config);
  console.log("Muestras ficticias y carpetas de Finanzas/Escritorio preparadas. Las políticas del sistema no se han aplicado.");
  return file;
}
if (require.main === module) setup().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { setup };
