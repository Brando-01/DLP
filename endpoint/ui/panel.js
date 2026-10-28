"use strict";

const $ = (selector) => document.querySelector(selector);
let token = "", state = null, files = [], events = [], config = null, activeView = "summary";
const escape = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const pill = (s) => `<span class="pill ${/^[A-Z_]+$/.test(s || "") ? s : ""}">${escape(s)}</span>`;
const when = (value) => value ? new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "Pendiente";

function notice(message, error = false) {
  const node = $("#notice"); node.textContent = message; node.className = `notice${error ? " error" : ""}`;
  if (!error) setTimeout(() => node.classList.add("hidden"), 7000);
}
async function api(route, options = {}) {
  const response = await fetch(route, { ...options, headers: { "X-DLP-Token": token, ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || body.message || `Error HTTP ${response.status}`);
  return body;
}
function show(view) {
  activeView = view;
  document.querySelectorAll(".view").forEach((node) => node.classList.toggle("hidden", node.id !== `view-${view}`));
  document.querySelectorAll("nav button").forEach((node) => node.classList.toggle("selected", node.dataset.view === view));
  if (view === "settings") loadConfig().catch((e) => notice(e.message, true));
  if (view === "browser") api("/api/pairing").then((v) => { $("#browser-token").value = v.browserToken; }).catch((e) => notice(e.message, true));
}
function renderInventory() {
  const query = $("#file-search").value.toLowerCase();
  const visible = files.filter((item) => `${item.name} ${item.path}`.toLowerCase().includes(query));
  $("#inventory").innerHTML = visible.length ? visible.map((item) => `<tr><td>${escape(item.name)}<span class="path">${escape(item.path)}</span></td><td>${pill(item.classification)}</td><td>${pill(item.inspectionStatus)}${item.reason ? `<span class="path">${escape(item.reason)}</span>` : ""}</td><td>${item.score}</td><td>${escape(item.matches.map((m) => m.id).join(", ") || "—")}</td></tr>`).join("") : '<tr><td colspan="5">Sin archivos en el inventario o sin coincidencias con la búsqueda.</td></tr>';
  const current = $("#transfer-file").value;
  $("#transfer-file").replaceChildren(...files.map((item) => new Option(`${item.name} · ${item.classification}`, item.id)));
  if (files.some((f) => f.id === current)) $("#transfer-file").value = current;
}
function renderEvents() {
  $("#events").innerHTML = events.length ? events.map((event) => `<tr><td>${escape(when(event.timestamp))}<span class="path">${escape(event.activity)}</span></td><td>${escape(event.channel)}<span class="path">${escape(event.file || event.message || "")}</span></td><td>${pill(event.decision)}</td><td>${escape(event.outcome || "REGISTRADO")}<span class="path">${event.prevented === true ? "Operación impedida" : event.prevented === null ? "Resultado pendiente" : "Sin prueba de bloqueo previo"}</span></td><td>${escape(event.evidence || "—")}</td></tr>`).join("") : '<tr><td colspan="5">Todavía no hay eventos.</td></tr>';
}
function renderStatus() {
  const coverageLabels = { DETECCION: "Vigilancia de carpetas", BLOQUEO_EN_OPERACION_MEDIADA: "Transferencia mediada", BLOQUEO_ANTES_DEL_ENVIO: "Envío mediado", COMPLEMENTO_REQUERIDO: "Requiere complemento", OBSERVACION_REACTIVA: "Observación posterior", BLOQUEO_EN_IMPRESION_MEDIADA: "Impresión mediada", ACTIVACION_ADMINISTRATIVA_SEPARADA: "Activación separada" };
  $("#count-files").textContent = state.inventory.total;
  $("#count-sensitive").textContent = state.inventory.sensitive;
  $("#count-unknown").textContent = state.inventory.unknown;
  $("#count-blocked").textContent = state.operations.prevented;
  $("#coverage").innerHTML = state.coverage.map((row) => `<tr><td>${escape(row.channel)}</td><td>${escape(row.active ? "Disponible" : "Requiere configuración o comprobación")}<span class="path">${escape(coverageLabels[row.mode] || row.mode)}</span></td><td>${escape(row.detail)}</td></tr>`).join("");
  $("#scan-status").textContent = `${state.scan.running ? "Exploración en curso" : "Última exploración: " + when(state.scan.completedAt)}. Revisados: ${state.scan.examined}; inaccesibles: ${state.scan.inaccessible}${state.scan.capped ? "; se alcanzó el límite de inventario" : ""}. ${state.classifier.backend === "central" ? "Las salidas consultan el control central; revisa allí el estado de Groq." : `Clasificador de salidas: ${state.classifier.mode}; Groq ${state.classifier.keyConfigured ? "con clave configurada" : "pendiente de clave"}.`}`;
  $("#audit-status").textContent = `${state.audit.events} eventos. Cadena: ${state.audit.chainValid ? "válida en la última comprobación" : "ALTERADA: revisar registros"}.`;
  const printerValue = $("#printer").value;
  $("#printer").replaceChildren(...(state.windows.printers || []).map((name) => new Option(name, name)));
  if ([...$("#printer").options].some((o) => o.value === printerValue)) $("#printer").value = printerValue;
}
function renderTargets() {
  const current = $("#transfer-target").value;
  const options = config.targets.map((target) => new Option(`${target.name}${target.lab ? " · LABORATORIO" : " · DESTINO REAL"}`, `target:${target.id}`));
  options.push(new Option("Portapapeles Windows · copia mediada", "channel:clipboard"), new Option("Impresora instalada · impresión mediada", "channel:print"));
  $("#transfer-target").replaceChildren(...options);
  if (options.some((o) => o.value === current)) $("#transfer-target").value = current;
  $("#printer-field").classList.toggle("hidden", $("#transfer-target").value !== "channel:print");
}
async function loadConfig() {
  config = await api("/api/config");
  $("#config-json").value = JSON.stringify(config, null, 2);
  renderTargets();
}
async function refresh() {
  try {
    [state, files, events] = await Promise.all([api("/api/status"), api("/api/files"), api("/api/events")]);
    renderStatus(); renderInventory(); renderEvents();
    $("#connection").textContent = `Agente conectado · ${state.windows.available ? "sensor Windows disponible" : "sensor Windows sin comprobar"}`;
  } catch (error) { $("#connection").textContent = "Sin conexión con el agente"; notice(error.message, true); }
}
async function download(route, fileName) {
  const response = await fetch(route, { headers: { "X-DLP-Token": token } });
  if (!response.ok) { const result = await response.json(); throw new Error(result.error || "No se pudo obtener el archivo"); }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a"); link.href = url; link.download = fileName; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
document.querySelectorAll("nav button").forEach((node) => node.addEventListener("click", () => show(node.dataset.view)));
$("#refresh").addEventListener("click", refresh);
$("#file-search").addEventListener("input", renderInventory);
$("#scan").addEventListener("click", async () => { try { await api("/api/scan", { method: "POST" }); notice("Exploración solicitada. El inventario se actualizará conforme avance."); await refresh(); } catch (e) { notice(e.message, true); } });
$("#transfer-target").addEventListener("change", () => $("#printer-field").classList.toggle("hidden", $("#transfer-target").value !== "channel:print"));
$("#transfer-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#transfer-submit"); button.disabled = true;
  const [type, value] = $("#transfer-target").value.split(":");
  const body = { fileId: $("#transfer-file").value, ...(type === "target" ? { targetId: value } : { channel: value, printer: $("#printer").value }) };
  try {
    const response = await fetch("/api/transfer", { method: "POST", headers: { "Content-Type": "application/json", "X-DLP-Token": token }, body: JSON.stringify(body) });
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    $("#transfer-result").classList.remove("hidden");
    $("#transfer-result").textContent = `${result.decision} · ${result.outcome}\n${result.message || result.reason}\nClasificación: ${result.classification}; puntaje: ${result.score}\nReglas: ${(result.matches || []).map((m) => m.id).join(", ") || "ninguna"}\nEvidencia: ${result.evidence}${result.receipt?.storedPath ? "\nDestino: " + result.receipt.storedPath : ""}`;
    await refresh();
  } catch (error) { notice(error.message, true); } finally { button.disabled = false; }
});
$("#config-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { config = await api("/api/config", { method: "PUT", body: JSON.stringify(JSON.parse($("#config-json").value)) }); renderTargets(); notice("Configuración guardada. Las restricciones generales de Windows siguen requiriendo su activación separada."); await refresh(); }
  catch (error) { notice(error.message, true); }
});
$("#reload-config").addEventListener("click", () => loadConfig().catch((e) => notice(e.message, true)));
$("#add-personal").addEventListener("click", () => {
  try { const input = JSON.parse($("#config-json").value); input.watchRoots = [...new Set([...input.watchRoots, ...state.suggestedRoots])]; $("#config-json").value = JSON.stringify(input, null, 2); notice("Rutas añadidas al editor. Revisa las carpetas y guarda la configuración para activar su vigilancia."); }
  catch (error) { notice(error.message, true); }
});
$("#show-token").addEventListener("click", () => { $("#browser-token").type = $("#browser-token").type === "password" ? "text" : "password"; });
$("#copy-token").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("#browser-token").value); notice("Token copiado. Pégalo únicamente en las opciones del complemento."); } catch { notice("No se pudo copiar. Muéstralo y cópialo manualmente.", true); } });
$("#export-events").addEventListener("click", () => download("/api/events.csv", "eventos-dlp.csv").catch((e) => notice(e.message, true)));
$("#download-report").addEventListener("click", () => download("/api/report", "Informe_DLP_Endpoint.pdf").catch((e) => notice(e.message, true)));

(async () => {
  try { const bootstrap = await fetch("/api/bootstrap"); if (!bootstrap.ok) throw new Error("Abre este panel desde http://127.0.0.1:3001"); token = (await bootstrap.json()).token; await loadConfig(); await refresh(); setInterval(refresh, 8000); }
  catch (error) { notice(error.message, true); }
})();
