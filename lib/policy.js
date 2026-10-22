"use strict";

const CHANNELS = ["web_upload", "browser_file", "browser_paste", "browser_drop", "usb", "network_share", "clipboard", "print", "http_transfer"];
const DEFAULT_POLICY = Object.fromEntries(CHANNELS.map((channel) => [channel, { mode: "enforce", blockScore: 3 }]));

function validatePolicies(value = {}) {
  const result = structuredClone(DEFAULT_POLICY);
  for (const [channel, config] of Object.entries(value)) {
    if (!CHANNELS.includes(channel) || !config || !["audit", "alert", "enforce"].includes(config.mode)) throw new Error("Política de canal no válida");
    const blockScore = Number(config.blockScore);
    if (!Number.isInteger(blockScore) || blockScore < 1 || blockScore > 100) throw new Error("Umbral de bloqueo no válido");
    result[channel] = { mode: config.mode, blockScore };
  }
  return result;
}

function decide(inspection, channel, policies = DEFAULT_POLICY) {
  if (!CHANNELS.includes(channel)) throw new Error("Canal no reconocido");
  const policy = policies[channel] || DEFAULT_POLICY[channel];
  if (inspection.inspectionStatus && inspection.inspectionStatus !== "COMPLETE") {
    return { decision: policy.mode === "enforce" ? "BLOQUEADO" : "ALERTA", allowed: policy.mode !== "enforce", detected: inspection.score > 0, alerted: true, reason: "Contenido no inspeccionado completamente", policyMode: policy.mode };
  }
  const detected = inspection.score > 0;
  let decision = "PERMITIDO";
  if (detected) decision = policy.mode === "audit" ? "DETECTADO" : policy.mode === "enforce" && inspection.score >= policy.blockScore ? "BLOQUEADO" : "ALERTA";
  return { decision, allowed: decision !== "BLOQUEADO", detected, alerted: decision === "ALERTA" || decision === "BLOQUEADO", reason: decision === "BLOQUEADO" ? "La política impide esta salida" : decision === "DETECTADO" ? "Detección en modo auditoría; salida permitida" : decision === "ALERTA" ? "Salida permitida con alerta" : "Sin coincidencias con las reglas configuradas", policyMode: policy.mode };
}

module.exports = { CHANNELS, DEFAULT_POLICY, validatePolicies, decide };
