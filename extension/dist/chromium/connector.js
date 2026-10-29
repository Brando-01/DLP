"use strict";

(function (root, factory) {
  const exports = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = exports;
  else root.DlpConnector = exports;
})(globalThis, function () {
  function validateAgentUrl(value) {
    const url = new URL(value || "http://127.0.0.1:3001");
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("El agente debe estar en una dirección HTTP de bucle local, sin ruta adicional");
    return url.origin;
  }
  function coveredDomain(url, domains) {
    let host;
    try { const target = new URL(url); if (!["http:", "https:"].includes(target.protocol)) return false; host = target.hostname.toLowerCase(); } catch { return false; }
    return (domains || ["*"]).some((domain) => domain === "*" || domain.toLowerCase() === host || domain.startsWith("*.") && (host === domain.slice(2).toLowerCase() || host.endsWith("." + domain.slice(2).toLowerCase())));
  }
  function createConnector({ readSettings, fetchImpl = fetch, extensionId, onDecision = () => {} }) {
    let cached = null;
    async function request(route, options = {}) {
      const settings = await readSettings();
      const base = validateAgentUrl(settings.agentUrl);
      if (!/^[a-f0-9]{64}$/.test(settings.token || "")) throw new Error("Vincula el complemento con el token del panel local");
      const response = await fetchImpl(base + route, { ...options, headers: { "X-DLP-Token": settings.token, ...(options.body ? { "Content-Type": "application/json" } : {}) }, signal: AbortSignal.timeout(12000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "El agente no pudo completar la inspección");
      return result;
    }
    async function browserConfig() {
      if (!cached || cached.expires < Date.now()) {
        const value = await request("/api/browser/config");
        cached = { value, expires: Date.now() + 15000 };
      }
      return cached.value;
    }
    return async function handle(message, sender) {
      if (!sender || sender.id !== extensionId) throw new Error("Emisor no autorizado");
      if (["PING", "HEARTBEAT"].includes(message.type) && !sender.tab) {
        const settings = await readSettings();
        if (settings.enabled === false) {
          try { await request("/api/browser/heartbeat", { method: "POST", body: JSON.stringify({ clientId: settings.clientId, version: message.version || "3.1.0", navigation: false, enabled: false }) }); } catch {}
          return { ok: true, disabled: true };
        }
        const heartbeat = await request("/api/browser/heartbeat", { method: "POST", body: JSON.stringify({ clientId: settings.clientId, version: message.version || "3.1.0", navigation: settings.logNavigation !== false }) });
        return { ok: true, config: await browserConfig(), heartbeat };
      }
      if (!sender.tab || !/^https?:\/\//.test(sender.url || "")) throw new Error("Solo se aceptan interacciones de una página HTTP o HTTPS");
      const settings = await readSettings();
      if (settings.enabled === false) return { allowed: true, decision: "FUERA_DE_ALCANCE", reason: "Complemento desactivado" };
      if (message.type === "NAVIGATION") {
        if (sender.navigationEvent !== true || sender.frameId !== 0) throw new Error("La navegación debe proceder del evento del navegador");
        if (settings.logNavigation === false) return { recorded: false };
        const cfg = await browserConfig();
        if (!coveredDomain(sender.url, cfg.domains)) return { recorded: false };
        const target = new URL(sender.url);
        return request("/api/browser/navigation", { method: "POST", body: JSON.stringify({ clientId: settings.clientId, url: target.origin, kind: message.kind, tabId: sender.tab.id }) });
      }
      if (message.type === "RESULT") {
        return request("/api/browser/result", { method: "POST", body: JSON.stringify({ ticket: message.ticket, outcome: message.outcome }) });
      }
      if (message.type !== "INSPECT" || !["browser_file", "browser_paste", "browser_drop"].includes(message.channel)) throw new Error("Mensaje no admitido");
      let cfg;
      try {
        cfg = await browserConfig();
        if (!coveredDomain(sender.url, cfg.domains)) return { allowed: true, decision: "FUERA_DE_ALCANCE", reason: "Dominio no incluido en la política" };
        const fileName = String(message.fileName || "portapapeles.txt").split(/[\\/]/).pop().slice(0, 160);
        const payload = { channel: message.channel, fileName, url: sender.url };
        if (typeof message.base64 === "string") {
          if (message.base64.length > 14 * 1024 * 1024) throw new Error("Archivo superior al límite del conector");
          payload.base64 = message.base64;
        } else if (typeof message.text === "string" && message.text.length <= 1000000) payload.text = message.text;
        else throw new Error("Contenido no admitido o superior al límite");
        const result = await request("/api/browser/inspect", { method: "POST", body: JSON.stringify(payload) });
        onDecision(result);
        return result;
      } catch (error) {
        const failClosed = cfg ? cfg.failClosed : settings.failClosed !== false;
        const result = { allowed: !failClosed, decision: "NO_ANALIZADO", unavailable: true, reason: error.message, failClosed };
        onDecision(result);
        return result;
      }
    };
  }
  return { validateAgentUrl, coveredDomain, createConnector };
});
