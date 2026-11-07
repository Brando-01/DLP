"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const { parseEnv } = require("node:util");
const sha = data => crypto.createHash("sha256").update(data).digest("hex");

function analyzeAudit(buffer) {
  let start = 0, line = 0, records = 0, previous = "0".repeat(64);
  while (start < buffer.length) {
    let end = buffer.indexOf(10, start); if (end < 0) end = buffer.length;
    line++; const content = buffer.subarray(start, end).toString("utf8").replace(/\r$/, "");
    if (content) {
      let event;
      try { event = JSON.parse(content); }
      catch {
        const later = buffer.subarray(Math.min(end + 1, buffer.length)).toString("utf8");
        if (later.trim()) return { recoverable: false, reason: "INVALID_RECORD_NOT_LAST", line, validRecords: records };
        if (!records) return { recoverable: false, reason: "NO_VERIFIED_PREFIX", line, validRecords: 0 };
        return { recoverable: true, reason: "INVALID_FINAL_RECORD", line, validRecords: records, prefixBytes: start, previousHash: previous };
      }
      if (!event || typeof event !== "object" || Array.isArray(event)) return { recoverable: false, reason: "INVALID_RECORD_STRUCTURE", line, validRecords: records };
      const { auditHash, ...payload } = event;
      if (payload.previousHash !== previous || sha(JSON.stringify(payload)) !== auditHash) return { recoverable: false, reason: "HASH_CHAIN_INVALID", line, validRecords: records };
      previous = auditHash; records++;
    }
    start = end + 1;
  }
  return { recoverable: false, reason: "ALREADY_VALID", validRecords: records };
}
function durableWrite(file, data) { fs.writeFileSync(file, data, { flag: "wx", mode: 0o600, flush: true }); }
function pidActive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== "ESRCH"; } }
function portOpen(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", e => { socket.destroy(); e.code === "ECONNREFUSED" ? resolve(false) : reject(new Error("No se pudo comprobar que el agente está detenido.")); });
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error("No se pudo comprobar que el agente está detenido.")); });
  });
}
async function ensureIdle(directory, port) {
  const lock = path.join(directory, "supervisor.json");
  if (fs.existsSync(lock)) {
    let value; try { value = JSON.parse(fs.readFileSync(lock, "utf8")); } catch { throw new Error("El estado del supervisor no es válido; no se repara la auditoría mientras sea ambiguo."); }
    if (!Number.isInteger(value.pid) || value.pid <= 0 || pidActive(value.pid)) throw new Error("Detén primero el agente con npm run client:stop. No se modificó la auditoría.");
  }
  if (await portOpen(port) || await portOpen(3002)) throw new Error("Hay un servicio local activo. Detén el agente antes de recuperar la auditoría.");
}
async function recoverAudit(options = {}) {
  const root = options.root || path.resolve(__dirname, ".."), envFile = path.join(root, ".env");
  const env = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : {};
  const directory = path.resolve(options.directory || process.env.DLP_ENDPOINT_DATA_DIR || env.DLP_ENDPOINT_DATA_DIR || path.join(root, "datos-endpoint"));
  const source = path.join(directory, "auditoria.jsonl"), marker = path.join(directory, "auditoria-recuperacion.lock");
  const read = () => {
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) throw new Error("Se requiere un archivo regular de auditoría de hasta 64 MiB; no se modificó.");
    return fs.readFileSync(source);
  };
  const initial = read(), analysis = analyzeAudit(initial);
  const plan = { applied: false, ...analysis, originalSha256: sha(initial), contentsIncluded: false };
  if (!options.apply) return plan;
  if (!analysis.recoverable) {
    if (analysis.reason === "ALREADY_VALID") return { ...plan, alreadyValid: true };
    throw new Error(`Recuperación automática rechazada: ${analysis.reason}. Se conserva la auditoría íntegra para revisión.`);
  }
  await (options.ensureIdle || ensureIdle)(directory, Number(env.DLP_AGENT_PORT || 3001));
  const recoveryId = crypto.randomUUID();
  durableWrite(marker, JSON.stringify({ pid: process.pid, recoveryId }));
  let temporary;
  try {
    if (sha(read()) !== plan.originalSha256) throw new Error("La auditoría cambió durante la comprobación; no se modificó.");
    const archiveRoot = path.join(directory, "recuperacion-auditoria");
    if (fs.existsSync(archiveRoot) && (fs.lstatSync(archiveRoot).isSymbolicLink() || !fs.lstatSync(archiveRoot).isDirectory())) throw new Error("El directorio de respaldo no es seguro; no se modificó la auditoría.");
    fs.mkdirSync(archiveRoot, { recursive: true, mode: 0o700 });
    const archive = path.join(archiveRoot, recoveryId); fs.mkdirSync(archive, { mode: 0o700 });
    const prefix = initial.subarray(0, analysis.prefixBytes), fragment = initial.subarray(analysis.prefixBytes);
    const relative = path.relative(directory, archive);
    const payload = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), channel: "agent", activity: "AUDITORIA_RECUPERADA_CON_CUARENTENA", decision: "ALERTA", detected: false, prevented: false, outcome: "LOCAL_RECOVERY_REQUIRES_REVIEW", evidence: "INVALID_FINAL_RECORD_PRESERVED", recoveryId, validRecordsRetained: analysis.validRecords, originalSha256: plan.originalSha256, fragmentSha256: sha(fragment), evidenceDirectory: relative, manualReviewRequired: true, previousHash: analysis.previousHash };
    const event = { ...payload, auditHash: sha(JSON.stringify(payload)) };
    const candidate = Buffer.concat([prefix, Buffer.from(JSON.stringify(event) + "\n")]);
    const validated = analyzeAudit(candidate);
    if (validated.reason !== "ALREADY_VALID" || validated.validRecords !== analysis.validRecords + 1) throw new Error("No se pudo validar la cadena candidata; no se modificó la auditoría.");
    durableWrite(path.join(archive, "auditoria-original.jsonl"), initial);
    durableWrite(path.join(archive, "registro-final.bin"), fragment);
    const manifest = { schemaVersion: 1, recoveryId, phase: "PREPARED", originalSha256: plan.originalSha256, candidateSha256: sha(candidate), fragmentSha256: sha(fragment), invalidLine: analysis.line, retainedRecords: analysis.validRecords, manualReviewRequired: true, causeNotDetermined: true };
    const manifestFile = path.join(archive, "manifest.json"); durableWrite(manifestFile, JSON.stringify(manifest, null, 2));
    if (sha(fs.readFileSync(path.join(archive, "auditoria-original.jsonl"))) !== plan.originalSha256 || sha(read()) !== plan.originalSha256) throw new Error("El origen o respaldo cambió; no se modificó la auditoría activa.");
    temporary = path.join(directory, `auditoria.jsonl.recuperando-${recoveryId}.tmp`);
    durableWrite(temporary, candidate);
    // Mismo directorio: sustituye un único archivo; conserva todos sus bytes previos en respaldo.
    fs.renameSync(temporary, source); temporary = null;
    const finalValid = analyzeAudit(read());
    if (finalValid.reason !== "ALREADY_VALID" || finalValid.validRecords !== validated.validRecords) throw new Error("Revisión necesaria: el archivo cambió después de la recuperación. El respaldo se conserva.");
    const completed = path.join(archive, "completed.json"); durableWrite(completed, JSON.stringify({ ...manifest, phase: "COMPLETED", completedAt: new Date().toISOString() }, null, 2));
    return { applied: true, preservedRecords: analysis.validRecords, totalRecords: finalValid.validRecords, invalidLine: analysis.line, chainValid: true, evidenceDirectory: relative, originalPreserved: true, manualReviewRequired: true, causeNotDetermined: true, contentsIncluded: false };
  } finally {
    // No borrar respaldos ni candidatos incompletos: permiten revisar una interrupción.
    try { if (JSON.parse(fs.readFileSync(marker, "utf8")).recoveryId === recoveryId) fs.unlinkSync(marker); } catch {}
  }
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(a => a !== "--apply")) { console.error("Uso: npm run client:recover-audit -- [--apply]"); process.exitCode = 1; }
  else recoverAudit({ apply: args.includes("--apply") }).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => { console.error(e.code === "EEXIST" ? "Ya existe una recuperación pendiente; conserva sus archivos para revisión." : e.message); process.exitCode = 1; });
}
module.exports = { recoverAudit, analyzeAudit };
