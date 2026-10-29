"use strict";
const api = globalThis.browser || globalThis.chrome;
const get = (id) => document.getElementById(id);
const navigationLabel = document.createElement("label"); navigationLabel.className = "check";
const navigationCheckbox = document.createElement("input"); navigationCheckbox.type = "checkbox"; navigationCheckbox.id = "log-navigation"; navigationCheckbox.checked = true;
navigationLabel.append(navigationCheckbox, " Registrar dominios visitados en la vista de actividad (sin búsquedas ni contenido)");
get("settings").insertBefore(navigationLabel, get("settings").querySelector("button"));
const explanation = document.createElement("p"); explanation.textContent = "Versión 3.1: vínculo con latido y navegación observada. Las inspecciones de transferencias pueden consultar Groq a través del control central, según su configuración."; document.querySelector("main").append(explanation);
const coverageParagraphs = document.querySelectorAll("main > p");
for (const p of coverageParagraphs) if (p.textContent.includes("no se envía a un servicio de IA")) p.textContent = "El conector consulta al agente local. Según la política central, el texto extraído puede analizarse con Groq. El conector no impide que un administrador lo desactive.";
api.storage.local.get({ agentUrl: "http://127.0.0.1:3001", token: "", enabled: true, failClosed: true, logNavigation: true }).then((value) => {
  get("agent").value = value.agentUrl; get("token").value = value.token; get("enabled").checked = value.enabled; get("fail-closed").checked = value.failClosed;
  navigationCheckbox.checked = value.logNavigation;
});
get("settings").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const agentUrl = DlpConnector.validateAgentUrl(get("agent").value);
    const token = get("token").value.trim();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Introduce el token de 64 caracteres del panel local, sección Navegador");
    await api.storage.local.set({ agentUrl, token, enabled: get("enabled").checked, failClosed: get("fail-closed").checked, logNavigation: navigationCheckbox.checked });
    const response = await api.runtime.sendMessage({ type: "PING" });
    if (!response.ok) throw new Error(response.reason || "No se pudo comprobar la conexión");
    get("status").textContent = response.disabled ? "Conector desactivado." : "Conexión comprobada. Abre Actividad en vivo en el panel del agente y visita un sitio.\nDominios de la política: " + response.config.domains.join(", ");
  } catch (error) { get("status").textContent = error.message; }
});
