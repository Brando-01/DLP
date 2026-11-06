"use strict";

const $ = (selector) => document.querySelector(selector);
let token = "", state = null, files = [], events = [], config = null, activeView = "summary";
let liveData = null, livePaused = false, liveBusy = false;
function renderProtection(value) {
  const labels = { NOT_APPLIED: "Sin perfil estricto aplicado: las aplicaciones nativas pueden conservar rutas de salida.", AUDIT_REQUIRED: "Hace falta una comprobación reciente del firewall y las políticas.", APPLIED_UNVERIFIED: "Perfil aplicado; falta comprobar su configuración y probar las salidas.", CONFIGURATION_VERIFIED: "Configuración comprobada. Aún debes validar los envíos y las rutas alternativas en el equipo.", DRIFT: "Se detectaron cambios en las restricciones. No atribuyas cobertura al perfil." };
  $("#protection-status").textContent = `${labels[value.state] || "Sin estado verificado."}${value.checkedAt ? " Comprobación: " + when(value.checkedAt) : ""}${value.findings?.length ? " " + value.findings.join("; ") : ""}`;
  const native = value.nativeApplications;
  if (native) $("#protection-status").textContent += ` Aplicaciones nativas: ${native.state === "CONFIGURATION_VERIFIED" ? "reglas por EXE comprobadas; valida el efecto y las rutas de proxy" : native.state === "NOT_APPLIED" ? "sin restricciones por EXE aplicadas" : native.state === "DRIFT" ? "hay cambios o versiones sin cubrir" : "pendiente de comprobar"}.`;
  const session = state?.session;
  $("#session-panel").classList.toggle("coverage-incomplete", !value.configurationVerified || session?.mode === "DEMO");
  $("#session-title").textContent = session?.mode === "INTEGRATED" ? "Arranque integrado · cobertura por canal" : session?.mode === "DEMO" ? "Modo de demostración · solo reglas locales" : "Componente individual · usa npm start para el arranque integrado";
  $("#session-detail").textContent = session?.mode === "DEMO" ? "La demo no consulta Groq ni instala controles de Windows. Las restricciones que hayas aplicado previamente permanecen activas; la demo no acredita protección general." : value.configurationVerified ? "Hay una configuración de salida verificada recientemente. Debes probar su efecto real; no existe inspección selectiva universal de archivos en todas las aplicaciones." : native?.configurationVerified ? "Hay reglas nativas comprobadas para los EXE/paquetes seleccionados; falta probar sus envíos. PROTECCIÓN GENERAL INCOMPLETA: otro navegador sin extensión ni proxy obligatorio conserva una ruta fuera del control." : "PROTECCIÓN DEL SISTEMA INCOMPLETA: WhatsApp/Discord y navegadores sin extensión o proxy obligatorio pueden enviar sin inspección. Iniciar los servicios no aplica esas restricciones.";
  const site = $("#session-site");
  site.classList.toggle("hidden", !session?.siteUrl);
  if (session?.siteUrl && /^http:\/\/127\.0\.0\.1:\d+$/.test(session.siteUrl)) site.href = session.siteUrl;
}
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
  if (!document.getElementById(`view-${view}`)) return;
  activeView = view;
  history.replaceState(null, "", `#${view}`);
  document.querySelectorAll(".view").forEach((node) => node.classList.toggle("hidden", node.id !== `view-${view}`));
  document.querySelectorAll("nav button").forEach((node) => node.classList.toggle("selected", node.dataset.view === view));
  if (view === "settings") loadConfig().catch((e) => notice(e.message, true));
  if (view === "browser") api("/api/pairing").then((v) => { $("#browser-token").value = v.browserToken; }).catch((e) => notice(e.message, true));
  if (view === "live") refreshLive();
}
function renderLive() {
  if (!liveData) return;
  const clients = liveData.browserClients.filter((c) => c.active);
  $("#live-browser").textContent = clients.length ? clients.map((c) => `Conectado · versión ${c.version} · latido ${when(c.lastSeen)} · navegación ${c.navigation ? "activada" : "desactivada"}`).join("\n") : "Sin latido de conexión reciente. Recarga la extensión 3.1 y pulsa Guardar y comprobar conexión en sus opciones.";
  const w = liveData.windows;
  const fresh = w.available && w.updatedAt && Date.now() - Date.parse(w.updatedAt) < 30000;
  $("#live-windows").textContent = fresh ? `Sensor activo · ${w.processCount ?? "—"} procesos en la última muestra · ${when(w.updatedAt)}. Sysmon: ${w.sysmon || "sin comprobar"}. Portapapeles: ${w.clipboard}. Impresión: ${w.printingObservation}.` : "Sin latido reciente del sensor Windows. Los eventos antiguos no acreditan que esté activo ahora.";
  const category = $("#live-filter").value;
  const filtered = liveData.events.filter((e) => category === "all" || category === "navigation" && e.channel === "browser_navigation" || category === "files" && ["filesystem", "local_copy"].includes(e.channel) || category === "windows" && ["process_observed", "sysmon", "print_observed", "clipboard_observed"].includes(e.channel) || category === "transfers" && ["usb", "network_share", "http_transfer", "browser_file", "browser_paste", "browser_drop", "print", "clipboard"].includes(e.channel));
  $("#live-events").innerHTML = filtered.length ? filtered.map((e) => `<tr><td>${escape(when(e.timestamp))}<span class="path">${escape(e.activity)}</span></td><td>${escape(e.origin || e.destination || e.file || e.program || "—")}${e.processId ? `<span class="path">PID ${escape(e.processId)}</span>` : ""}</td><td>${escape(e.channel)}</td><td>${e.outcome === "OBSERVED" ? "Observado" : pill(e.decision)}<span class="path">${escape(e.evidence || "—")}${e.prevented === true ? " · operación impedida" : ""}</span></td></tr>`).join("") : '<tr><td colspan="4">No hay eventos de esta categoría. Visita un sitio o realiza una prueba; no se fabrica actividad para llenar esta tabla.</td></tr>';
}
async function refreshLive() {
  if (livePaused || liveBusy || !token) return;
  liveBusy = true;
  try { liveData = await api("/api/live"); $("#live-updated").textContent = `Actualización cada 2 segundos · última respuesta ${when(liveData.serverTime)}`; renderLive(); }
  catch (error) { $("#live-updated").textContent = `Sin conexión: ${error.message}`; }
  finally { liveBusy = false; }
}
function renderInventory() {
  const query = $("#file-search").value.toLowerCase();
  const visible = files.filter((item) => `${item.name} ${item.path}`.toLowerCase().includes(query));
  $("#inventory").innerHTML = visible.length ? visible.map((item) => `<tr><td>${escape(item.name)}<span class="path">${escape(item.path)}</span></td><td>${pill(item.classification)}</td><td>${pill(item.inspectionStatus)}<span class="path">Semántica: ${escape(item.semantic?.status || "REGLAS_LOCALES")}${item.semantic?.cacheHit ? " · caché" : ""}</span>${item.reason ? `<span class="path">${escape(item.reason)}</span>` : ""}</td><td>${item.score}</td><td>${escape(item.matches.map((m) => m.id).join(", ") || "—")}</td></tr>`).join("") : '<tr><td colspan="5">Sin archivos en el inventario o sin coincidencias con la búsqueda.</td></tr>';
  const current = $("#transfer-file").value;
  $("#transfer-file").replaceChildren(...files.map((item) => new Option(`${item.name} · ${item.classification}`, item.id)));
  if (files.some((f) => f.id === current)) $("#transfer-file").value = current;
}
function renderEvents() {
  $("#events").innerHTML = events.length ? events.map((event) => `<tr><td>${escape(when(event.timestamp))}<span class="path">${escape(event.activity)}</span></td><td>${escape(event.channel)}<span class="path">${escape(event.origin || event.destination || event.file || event.program || event.message || "")}</span></td><td>${pill(event.decision)}</td><td>${escape(event.outcome || "REGISTRADO")}<span class="path">${event.prevented === true ? "Operación impedida" : event.prevented === null ? "Resultado pendiente" : "Sin prueba de bloqueo previo"}</span></td><td>${escape(event.evidence || "—")}</td></tr>`).join("") : '<tr><td colspan="5">Todavía no hay eventos.</td></tr>';
}
function renderStatus() {
  const coverageLabels = { DETECCION: "Vigilancia de carpetas", BLOQUEO_EN_OPERACION_MEDIADA: "Transferencia mediada", BLOQUEO_ANTES_DEL_ENVIO: "Envío mediado", COMPLEMENTO_REQUERIDO: "Requiere complemento", OBSERVACION_REACTIVA: "Observación posterior", BLOQUEO_EN_IMPRESION_MEDIADA: "Impresión mediada", ACTIVACION_ADMINISTRATIVA_SEPARADA: "Activación separada" };
  $("#count-files").textContent = state.inventory.total;
  $("#count-sensitive").textContent = state.inventory.sensitive;
  $("#count-unknown").textContent = state.inventory.unknown;
  $("#count-blocked").textContent = state.operations.prevented;
  $("#coverage").innerHTML = state.coverage.map((row) => `<tr><td>${escape(row.channel)}</td><td>${escape(row.active ? "Disponible" : "Requiere configuración o comprobación")}<span class="path">${escape(coverageLabels[row.mode] || row.mode)}</span></td><td>${escape(row.detail)}</td></tr>`).join("");
  $("#scan-status").textContent = `${state.scan.running ? "Exploración en curso" : "Última exploración: " + when(state.scan.completedAt)}. Revisados: ${state.scan.examined}; inaccesibles: ${state.scan.inaccessible}${state.scan.capped ? "; se alcanzó el límite de inventario" : ""}. Inventario semántico ${state.inventory.semanticEnabled ? "activado; presupuesto " + state.inventory.semanticBudget + " documentos por exploración" : "desactivado; solo reglas locales"}. ${state.classifier.backend === "central" ? "El control central realiza la clasificación; revisa allí el estado de Groq." : `Clasificador: ${state.classifier.mode}; Groq ${state.classifier.keyConfigured ? "con clave configurada" : "pendiente de clave"}.`}`;
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
    let protection;
    [state, files, events, protection] = await Promise.all([api("/api/status"), api("/api/files"), api("/api/events"), api("/api/protection")]);
    renderProtection(protection);
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
$("#audit-protection").addEventListener("click", async () => {
  const button = $("#audit-protection"); button.disabled = true;
  try { renderProtection(await api("/api/protection/audit", { method: "POST" })); }
  catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
});
$("#live-filter").addEventListener("change", renderLive);
$("#pause-live").addEventListener("click", () => { livePaused = !livePaused; $("#pause-live").textContent = livePaused ? "Reanudar vista" : "Pausar vista"; if (livePaused) $("#live-updated").textContent = "Vista pausada; la captura de eventos continúa"; else refreshLive(); });
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
$("#download-report").addEventListener("click", () => download("/api/report", "Informe_DLP_Administrado_v3.pdf").catch((e) => notice(e.message, true)));

(async () => {
  try { const bootstrap = await fetch("/api/bootstrap"); if (!bootstrap.ok) throw new Error("Abre este panel desde http://127.0.0.1:3001"); token = (await bootstrap.json()).token; await loadConfig(); await refresh(); show(location.hash.slice(1) || "summary"); setInterval(refresh, 8000); setInterval(() => { if (activeView === "live") refreshLive(); }, 2000); }
  catch (error) { notice(error.message, true); }
})();
