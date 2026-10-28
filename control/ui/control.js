"use strict";
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
let token = "", timer;
async function api(route, options = {}) {
  const response = await fetch(route, { ...options, headers: { "X-DLP-Token": token, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || "Solicitud no válida"); return value;
}
async function refresh(first = false) {
  try {
    const status = await api("/v1/admin/status");
    $("console").hidden = false; $("login").hidden = true; $("logout").hidden = false; $("notice").textContent = "";
    const cls = status.classifier;
    $("provider").textContent = `Clasificador: ${cls.mode === "hybrid" ? "híbrido" : "reglas locales"}. ${cls.keyConfigured ? "Clave de Groq configurada; conectividad y exactitud pendientes de cada consulta." : "Groq pendiente de clave."} Modelo: ${cls.model}. Consultas: ${cls.calls}; errores: ${cls.failures}.`;
    $("event-count").textContent = status.audit.events; $("agent-count").textContent = status.agents.length; $("pending-count").textContent = status.pendingDecisions;
    $("agents").innerHTML = status.agents.length ? status.agents.map((a) => `<p><b>${esc(a.device)}</b> · último reporte ${esc(new Date(a.lastSeen).toLocaleString("es-PE"))}<small>${esc(a.coverage)}</small></p>`).join("") : "Sin agentes conectados. El panel central puede inspeccionar solicitudes de los filtros mientras se despliega el agente.";
    $("cases").innerHTML = status.cases.map((v) => `<tr><td>${esc(v.id)}</td><td>${esc(v.name)}</td><td>${esc(v.coverage)}</td></tr>`).join("");
    $("events").innerHTML = status.events.map((v) => `<tr><td>${esc(new Date(v.timestamp).toLocaleString("es-PE"))}<small>${esc(v.device || "control")}</small></td><td>${esc(v.activity)}<small>${esc(v.channel)}</small></td><td>${esc(v.destination || v.file || "—")}</td><td><span class="badge ${/^[A-Z_]+$/.test(v.decision || "") ? v.decision : ""}">${esc(v.decision)}</span><small>${esc(v.outcome || "Pendiente")} · ${v.prevented === true ? "Cancelado por conector" : v.prevented === null ? "Sin recibo" : "Sin prevención acreditada"}</small></td><td>${esc(v.evidence)}<small>${esc(v.cause || "")}</small></td></tr>`).join("");
    if (first) $("policy").value = JSON.stringify(status.policy, null, 2);
  } catch (error) { $("notice").textContent = error.message; }
}
$("login-form").addEventListener("submit", async (event) => { event.preventDefault(); token = $("token").value; $("token").value = ""; await refresh(true); clearInterval(timer); timer = setInterval(refresh, 8000); });
$("logout").addEventListener("click", () => { token = ""; clearInterval(timer); $("console").hidden = true; $("login").hidden = false; $("logout").hidden = true; });
$("refresh").addEventListener("click", () => refresh());
$("policy-form").addEventListener("submit", async (event) => { event.preventDefault(); try { const result = await api("/v1/admin/policy", { method: "PUT", body: JSON.stringify(JSON.parse($("policy").value)) }); $("policy").value = JSON.stringify(result, null, 2); await refresh(); } catch (error) { $("notice").textContent = error.message; } });
