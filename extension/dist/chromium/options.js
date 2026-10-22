"use strict";
const api = globalThis.browser || globalThis.chrome;
const get = (id) => document.getElementById(id);
api.storage.local.get({ agentUrl: "http://127.0.0.1:3001", token: "", enabled: true, failClosed: true }).then((value) => {
  get("agent").value = value.agentUrl; get("token").value = value.token; get("enabled").checked = value.enabled; get("fail-closed").checked = value.failClosed;
});
get("settings").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const agentUrl = DlpConnector.validateAgentUrl(get("agent").value);
    const token = get("token").value.trim();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Introduce el token de 64 caracteres del panel local, sección Navegador");
    await api.storage.local.set({ agentUrl, token, enabled: get("enabled").checked, failClosed: get("fail-closed").checked });
    const response = await api.runtime.sendMessage({ type: "PING" });
    if (!response.ok) throw new Error(response.reason || "No se pudo comprobar la conexión");
    get("status").textContent = "Conexión comprobada. Recarga las páginas de prueba después de instalar el complemento.\nDominios de la política: " + response.config.domains.join(", ");
  } catch (error) { get("status").textContent = error.message; }
});
