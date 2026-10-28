"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
async function setup(directory = root) {
  const file = path.join(directory, ".env");
  const template = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  if (!fs.existsSync(file)) {
    const value = template.replace(/^(DLP_CONTROL_ADMIN_TOKEN|DLP_INSPECT_TOKEN|DLP_TELEMETRY_TOKEN|DLP_LAB_PASSWORD|DLP_WAZUH_ENROLLMENT_PASSWORD)=$/gm, (_, name) => `${name}=${crypto.randomBytes(32).toString("hex")}`);
    fs.writeFileSync(file, value, { flag: "wx", mode: 0o600 });
    console.log("Configuración local creada: .env. GROQ_API_KEY está vacía. Las credenciales se generaron sin imprimirlas.");
  } else {
    let existing = fs.readFileSync(file, "utf8");
    if (!/^DLP_INSPECTION_BACKEND=/m.test(existing)) { existing += "\nDLP_INSPECTION_BACKEND=central\n"; fs.writeFileSync(file, existing, { mode: 0o600 }); }
    if (!/^DLP_CONTROL_EMBEDDED=/m.test(existing)) { existing += "\nDLP_CONTROL_EMBEDDED=0\n"; fs.writeFileSync(file, existing, { mode: 0o600 }); }
    console.log(".env existente conservado; backend central preparado.");
  }
  const values = process.env;
  // loadEnvFile conserva las variables explícitas del proceso y no imprime valores.
  process.loadEnvFile(file);
  const state = path.join(directory, "deploy/state"); fs.mkdirSync(state, { recursive: true });
  if (values.DLP_WAZUH_ENROLLMENT_PASSWORD) fs.writeFileSync(path.join(state, "authd.pass"), values.DLP_WAZUH_ENROLLMENT_PASSWORD + "\n", { mode: 0o600 });
  const finance = path.join(directory, "laboratorio/Finanzas"), desktop = path.join(directory, "laboratorio/Escritorio");
  for (const folder of [finance, desktop]) fs.mkdirSync(folder, { recursive: true });
  const { xlsxBuffer, docxBuffer } = require("../test/helpers/fixtures.cjs");
  const samples = { "publico.txt": Buffer.from("Horario público de biblioteca"), "privado.txt": Buffer.from("DNI: 12345678\nExpediente ficticio"), "contexto_privado.txt": Buffer.from("María Torres obtuvo diecisiete en la evaluación del curso. Informe individual no publicado."), "publico.xlsx": await xlsxBuffer([["curso", "aula"], ["Redes", 301]]), "privado.xlsx": await xlsxBuffer([["DNI", "tarjeta"], ["12345678", "4111111111111111"]]), "renombrado.jpg": await docxBuffer("DNI: 12345678") };
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
