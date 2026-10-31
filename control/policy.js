"use strict";
const { validatePolicies, decide } = require("../lib/policy");
const CASES = [
  ["CU-01", "Copia a USB", "Windows: restricción del canal y operación mediada", "WINDOWS_POLICY"],
  ["CU-02", "Copia a ruta no autorizada", "Detección local y correlación de hash después de la copia", "ENDPOINT_OBSERVATION"],
  ["CU-03", "Correo con adjunto sensible", "Filtro SMTP antes de aceptación y relevo", "SMTP_FILTER"],
  ["CU-04", "Correo con datos en el cuerpo", "Decodificación MIME y clasificación antes de envío", "SMTP_FILTER"],
  ["CU-05", "Subida web HTTPS", "Proxy obligatorio con inspección TLS", "WEB_PROXY"],
  ["CU-06", "Texto sensible a sitio público", "Inspección de cuerpo y parámetros HTTP", "WEB_PROXY"],
  ["CU-07", "Sincronización rclone", "Proxy HTTP y restricción de rutas de salida; backend verificado por separado", "PROXY_AND_FIREWALL"],
  ["CU-08", "SFTP / SCP", "Restricción de canal y destino, sin lectura del contenido SSH", "FIREWALL"],
  ["CU-09", "FTP en claro", "Suricata: detección; prevención con IPS o bloqueo del canal", "SURICATA"],
  ["CU-10", "Túnel DNS", "Resolver autorizado, análisis de consultas y restricción de DNS externo", "DNS_FIREWALL"],
  ["CU-11", "Archivo cifrado", "Retener por no inspección, sin atribuir sensibilidad reconocida", "CONTENT_ENGINE"],
  ["CU-12", "Evasión por formato", "Firma real, base64 y rechazo de cargas parciales no inspeccionables", "CONTENT_ENGINE"],
].map(([id, name, coverage, integration]) => ({ id, name, coverage, integration }));
function defaults() { return { schemaVersion: 1, policies: validatePolicies(), blockedDomains: [], uploadDomains: ["*"], mailDomains: ["dlp.test", "example.test"], fragmentMode: "block", maxParts: 20 }; }
function validatePolicy(value) {
  if (!value || value.schemaVersion !== 1 || value.fragmentMode !== "block" || value.maxParts !== 20) throw new Error("Versión o límites de política no admitidos");
  const result = { ...defaults(), policies: validatePolicies(value.policies) };
  result.profile = value.profile || "standard";
  if (!["standard", "restricted"].includes(result.profile)) throw new Error("Perfil no admitido");
  for (const key of ["blockedDomains", "uploadDomains", "mailDomains"]) {
    if (!Array.isArray(value[key]) || value[key].length > 200 || value[key].some((x) => typeof x !== "string" || !/^(\*|(?:\*\.)?[a-z0-9.-]+)$/i.test(x))) throw new Error(`Lista inválida: ${key}`);
    result[key] = [...new Set(value[key].map((x) => x.toLowerCase()))];
  }
  if (result.profile === "restricted") {
    if (!result.uploadDomains.length || result.uploadDomains.includes("*") || !result.mailDomains.length || result.mailDomains.includes("*")) throw new Error("El perfil estricto requiere destinos explícitos de subida y correo, sin * global");
    for (const channel of ["web_proxy", "mail", "sync", "browser_file", "browser_paste", "browser_drop", "http_transfer"]) {
      if (result.policies[channel].mode !== "enforce") throw new Error("El perfil estricto requiere enforce en todos los canales de salida");
    }
  }
  return result;
}
const matchesHost = (host, list) => list.some((item) => item === "*" || host === item || item.startsWith("*.") && (host === item.slice(2) || host.endsWith("." + item.slice(2))));
function destinationDecision(input, policy) {
  if (["web_proxy", "sync", "browser_file", "browser_paste", "browser_drop", "http_transfer"].includes(input.channel)) {
    let url; try { url = new URL(input.destination); } catch { throw new Error("Destino web inválido"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Destino web no admitido");
    if (matchesHost(url.hostname, policy.blockedDomains)) return { allowed: false, decision: "BLOQUEADO", detected: false, reason: "Dominio prohibido por política", cause: "DESTINATION" };
    if ((input.parts?.length || policy.profile === "restricted" && input.outboundWrite) && !matchesHost(url.hostname, policy.uploadDomains)) return { allowed: false, decision: "BLOQUEADO", detected: false, reason: "Destino de subida no autorizado", cause: "DESTINATION" };
  }
  if (input.channel === "mail") {
    if (!Array.isArray(input.recipients) || !input.recipients.length || input.recipients.length > 50 || input.recipients.some((r) => typeof r !== "string" || !/^[^\s<>@]+@[^\s<>@]+$/.test(r))) throw new Error("Destinatarios inválidos");
    if (input.recipients.some((r) => !matchesHost(r.split("@")[1].toLowerCase(), policy.mailDomains))) return { allowed: false, decision: "BLOQUEADO", detected: false, reason: "Dominio de correo no autorizado", cause: "DESTINATION" };
  }
  if (input.fragmented || input.unsupported) return { allowed: false, decision: "BLOQUEADO", detected: false, reason: "Protocolo, formato o carga parcial no inspeccionable", cause: "NO_INSPECCIONABLE" };
  return null;
}
function combine(inspections, channel, policy) {
  const decisions = inspections.map((item) => decide(item, channel, policy.policies));
  const strongest = decisions.find((r) => !r.allowed) || decisions.find((r) => r.decision === "ALERTA") || decisions.find((r) => r.decision === "DETECTADO") || { allowed: true, decision: "PERMITIDO", detected: false, reason: "Operación sin contenido enviado" };
  return { ...strongest, detected: decisions.some((r) => r.detected), cause: inspections.some((r) => r.inspectionStatus !== "COMPLETE" || r.semantic?.required && r.semantic.status !== "COMPLETE") ? "NO_INSPECCIONABLE" : "CONTENT_POLICY" };
}
module.exports = { CASES, defaults, validatePolicy, matchesHost, destinationDecision, combine };
