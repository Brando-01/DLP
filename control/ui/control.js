"use strict";
const $ = id => document.getElementById(id);
const esc = v => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const when = v => v ? new Date(v).toLocaleString("es-PE") : "Sin reporte";
const connection = { ONLINE: "Conectado", STALE: "Sin reporte reciente", OFFLINE: "Desconectado", PENDING: "Pendiente de inscripción", EXPIRED: "Invitación caducada", REVOKED: "Revocado" };
let token = "", timer, selected = "", snapshot, invitation, refreshVersion = 0;
async function api(route, options = {}) {
  const access = token;
  const response = await fetch(route, { ...options, headers: { "X-DLP-Token": access, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
  const value = await response.json(); if (access !== token) throw new Error("La sesión ha cambiado."); if (!response.ok) throw new Error(value.error || "Solicitud no válida"); return value;
}
function renderEvents() {
  if (!snapshot) return;
  const devices = new Map(snapshot.agents.map(d => [d.device, d]));
  const rows = snapshot.events.filter(e => !$("decision-filter").value || e.decision === $("decision-filter").value);
  const visibleDevice = snapshot.selectedDevice;
  $("activity-title").textContent = "Actividad reciente · " + (visibleDevice ? devices.get(visibleDevice)?.name || visibleDevice : "todos los equipos");
  $("event-summary").textContent = `${rows.length} eventos visibles de los últimos ${snapshot.events.length} del equipo/filtro. Total registrado en este filtro: ${snapshot.filteredEvents}. Los estados y eventos son reportes de los canales configurados.`;
  $("events").innerHTML = rows.length ? rows.map(v => {
    const files = Array.isArray(v.files) ? v.files : [];
    const file = v.file || files.map(f => f.file).join(", ");
    const semantic = v.semanticStatus || files.map(f => f.semanticStatus).filter(Boolean).join(", ");
    const label = devices.get(v.device)?.name || v.deviceName || v.device || "control";
    const target = v.destination || (v.destinationAddress ? v.destinationAddress + (v.destinationPort ? ":" + v.destinationPort : "") : "");
    const program = v.program ? `Programa: ${v.program}${v.processId ? " · PID " + v.processId : ""}` : "";
    return `<tr><td>${esc(when(v.sourceTime || v.timestamp))}<small>${esc(label)}</small></td><td>${esc(v.activity)}<small>${esc(v.sourceChannel || v.channel)}</small></td><td>${esc(file || program || "—")}${file && program ? `<small>${esc(program)}</small>` : ""}<small>${esc(target)}</small></td><td><span class="badge ${/^[A-Z_]+$/.test(v.decision || "") ? v.decision : ""}">${esc(v.decision || "REGISTRO")}</span><small>${esc(v.outcome || "Sin recibo")} · ${v.prevented === true ? "Cancelado por conector" : v.reportedPrevented ? "Bloqueo reportado por agente" : v.prevented === null ? "Pendiente de recibo" : "Sin prevención acreditada"}</small></td><td>${esc(v.evidence || "—")}<small>${esc(v.cause || semantic || "")}</small></td></tr>`;
  }).join("") : '<tr><td colspan="5">No hay eventos para esta selección.</td></tr>';
}
function renderDeviceDetails(status) {
  const device = status.agents.find(d => d.device === status.selectedDevice);
  const container = $("device-details");
  if (!device) { container.textContent = "Selecciona Ver actividad para consultar sensores, procesos y clasificación de un equipo."; return; }
  const sensors = device.sensors, semantic = device.semantic;
  const semanticText = semantic ? `Resultados semánticos completos: ${semantic.complete}. Otros estados: ${semantic.other}. Último: ${semantic.lastStatus} (${when(semantic.lastAt)}). COMPLETE puede proceder de caché; no equivale a una llamada nueva ni demuestra bloqueo.` : "Sin resultados semánticos centrales registrados para este equipo. Tener la clave configurada no acredita análisis en esta máquina.";
  if (!sensors) { container.innerHTML = `<h3>${esc(device.name)}</h3><p>Este agente no reporta aún el estado de sus sensores. Actualiza el cliente.</p><p>${esc(semanticText)}</p>`; return; }
  const p = sensors.process;
  const recent = device.connection === "ONLINE" && p.available && Number.isFinite(Date.parse(p.sampledAt)) && Date.parse(status.serverTime) - Date.parse(p.sampledAt) <= 30000;
  container.innerHTML = `<h3>${esc(device.name)} · sensores reportados</h3><p>Procesos: ${recent ? "muestra reciente" : "sin muestra reciente"}. ${esc(p.count)} visibles; alcance: ${esc(p.scope)}. Última muestra: ${esc(when(p.sampledAt))}.<br>Extensiones activas: ${esc(sensors.browser.activeClients)}; con navegación habilitada: ${esc(sensors.browser.navigationClients)}.<br>Inventario: ${esc(sensors.inventory.files)} archivos en ${esc(sensors.inventory.roots)} carpetas configuradas. Clasificación semántica del inventario: ${sensors.inventory.semanticEnabled ? "habilitada" : "deshabilitada"}. Backend: ${esc(sensors.inspectionBackend)}.<br>Relay estricto de laboratorio: ${sensors.strictRelay?.available ? "activo" : sensors.strictRelay?.enabled ? "sin respuesta" : "deshabilitado"}. Este estado no acredita el firewall; ejecuta strict:audit y strict:verify en la VM.</p><p>${esc(semanticText)}</p><p class="muted">Son muestras de metadatos; no describen cada acción dentro de una aplicación. Procesos breves pueden no aparecer. La navegación requiere extensión vinculada. No hay interceptación universal.</p><details><summary>Última lista de procesos reportada (máximo 50)</summary><p>${p.truncated ? "Lista parcial. " : ""}Cambios omitidos por límite del sensor: ${esc(p.droppedEvents)}.</p><ul>${p.processes.map(v => `<li>${esc(v.program)} · PID ${esc(v.processId)}</li>`).join("") || "<li>Sin muestra de procesos.</li>"}</ul></details>`;
}
async function refresh(first = false) {
  const version = ++refreshVersion, filter = selected;
  try {
    const status = await api("/v1/admin/status" + (filter ? "?device=" + encodeURIComponent(filter) : ""));
    if (version !== refreshVersion || filter !== selected) return;
    snapshot = status;
    $("console").hidden = false; $("login").hidden = true; $("logout").hidden = false; $("notice").textContent = "";
    const cls = status.classifier;
    $("provider").textContent = `Clasificador: ${cls.mode === "hybrid" ? "híbrido" : "reglas locales"}. ${cls.keyConfigured ? "Clave Groq configurada; comprobar el resultado semántico de cada operación." : "Groq pendiente de clave."} Modelo: ${cls.model}. Consultas: ${cls.calls}; errores: ${cls.failures}.`;
    $("event-count").textContent = status.filteredEvents;
    $("agent-count").textContent = status.agents.filter(d => d.connection === "ONLINE").length;
    $("pending-count").textContent = status.pendingDecisions;
    $("agents").innerHTML = status.agents.length ? status.agents.map(a => `<section class="device-card ${a.device === selected ? "selected" : ""}"><span class="connection ${esc(a.connection)}">${esc(connection[a.connection] || a.connection)}</span><h3>${esc(a.name)}</h3><p>${esc(a.hostname || a.platform || "Equipo anterior")}<small>Último reporte: ${esc(when(a.lastSeen))}</small><small>${a.identity === "INDIVIDUAL" ? "Credencial individual" : "Credencial compartida · migración pendiente"} · ${esc(a.startMode || "Inicio no reportado")}</small><small>${esc(a.coverage || "Sin cobertura reportada")}</small></p><button type="button" data-device="${esc(a.device)}">Ver actividad</button>${a.identity === "INDIVIDUAL" && a.connection !== "REVOKED" ? ` <button class="secondary" type="button" data-revoke="${esc(a.id)}">Revocar credencial</button>` : ""}</section>`).join("") : "Sin equipos registrados. Crea una invitación o espera al agente existente.";
    $("device-filter").innerHTML = '<option value="">Todos los equipos</option>' + status.agents.map(d => `<option value="${esc(d.device)}">${esc(d.name)}</option>`).join("");
    $("device-filter").value = selected;
    renderDeviceDetails(status);
    $("cases").innerHTML = status.cases.map(v => `<tr><td>${esc(v.id)}</td><td>${esc(v.name)}</td><td>${esc(v.coverage)}</td></tr>`).join("");
    if (first) $("policy").value = JSON.stringify(status.policy, null, 2);
    renderEvents();
  } catch (error) { $("notice").textContent = error.message; }
}
$("login-form").addEventListener("submit", async event => { event.preventDefault(); token = $("token").value; $("token").value = ""; await refresh(true); clearInterval(timer); timer = setInterval(refresh, 8000); });
$("logout").addEventListener("click", () => { token = ""; refreshVersion++; clearInterval(timer); snapshot = null; invitation = null; $("invitation-result").hidden = true; $("console").hidden = true; $("login").hidden = false; $("logout").hidden = true; });
$("refresh").addEventListener("click", () => refresh());
$("device-filter").addEventListener("change", () => { selected = $("device-filter").value; refresh(); });
$("decision-filter").addEventListener("change", renderEvents);
$("all-devices").addEventListener("click", () => { selected = ""; refresh(); });
$("agents").addEventListener("click", async event => {
  const button = event.target.closest("button"); if (!button) return;
  if (button.dataset.device) { selected = button.dataset.device; await refresh(); $("activity-title").scrollIntoView({ block: "start" }); }
  if (button.dataset.revoke) { try { await api(`/v1/admin/devices/${encodeURIComponent(button.dataset.revoke)}/revoke`, { method: "POST" }); await refresh(); } catch (error) { $("notice").textContent = error.message; } }
});
$("enroll-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const result = await api("/v1/admin/devices", { method: "POST", body: JSON.stringify({ name: $("device-name").value, platform: $("device-platform").value, serverUrl: $("enroll-url").value }) });
    invitation = result.invitation;
    $("invitation-detail").textContent = `Invitación creada para ${result.device.name}. Vence: ${when(invitation.expiresAt)}. Descarga el archivo ahora; el servidor conserva solo su huella.`;
    $("invitation-result").hidden = false;
    await refresh();
  } catch (error) { $("notice").textContent = error.message; }
});
$("download-invitation").addEventListener("click", () => {
  if (!invitation) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(invitation, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `DLP-invitacion-${invitation.deviceId}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$("policy-form").addEventListener("submit", async event => { event.preventDefault(); try { const result = await api("/v1/admin/policy", { method: "PUT", body: JSON.stringify(JSON.parse($("policy").value)) }); $("policy").value = JSON.stringify(result, null, 2); await refresh(); } catch (error) { $("notice").textContent = error.message; } });
