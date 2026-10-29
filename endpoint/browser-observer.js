"use strict";
const { coveredDomain } = require("../extension/common/connector");
class BrowserObserver {
  constructor(runtime) { this.runtime = runtime; this.clients = new Map(); this.seen = new Map(); }
  heartbeat(input) {
    if (!input || typeof input.clientId !== "string" || !/^[a-f0-9-]{36}$/i.test(input.clientId) || typeof input.version !== "string" || !/^\d+\.\d+\.\d+$/.test(input.version) || typeof input.navigation !== "boolean") throw new Error("Identificación de conector inválida; recarga la extensión actualizada");
    if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new Error("Estado de conector inválido");
    const client = { clientId: input.clientId, version: input.version, enabled: input.enabled !== false, navigation: input.navigation, lastSeen: new Date().toISOString() };
    this.clients.set(input.clientId, client);
    while (this.clients.size > 32) this.clients.delete(this.clients.keys().next().value);
    return { connected: true, lastSeen: client.lastSeen };
  }
  navigation(input) {
    const client = this.clients.get(input?.clientId);
    if (!client || Date.now() - Date.parse(client.lastSeen) > 150000) throw new Error("Conector sin latido reciente; vuelve a comprobar la conexión");
    if (!client.navigation || !client.enabled) return { recorded: false };
    if (!input || !Number.isInteger(input.tabId) || input.tabId < 0 || !["COMMITTED", "HISTORY"].includes(input.kind) || typeof input.url !== "string" || input.url.length > 4096) throw new Error("Navegación no válida");
    const url = new URL(input.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Solo se observan sitios HTTP/HTTPS sin credenciales en URL");
    if (!coveredDomain(url.origin, this.runtime.config.browserDomains)) return { recorded: false };
    const key = `${input.clientId}:${input.tabId}:${url.origin}:${input.kind}`;
    if (Date.now() - (this.seen.get(key) || 0) < 2000) return { recorded: false, duplicate: true };
    this.seen.set(key, Date.now()); while (this.seen.size > 1000) this.seen.delete(this.seen.keys().next().value);
    const event = this.runtime.audit.record({ channel: "browser_navigation", activity: input.kind === "HISTORY" ? "CAMBIO_DE_RUTA_WEB" : "SITIO_WEB_VISITADO", origin: url.origin, destination: url.origin, clientId: input.clientId, tabId: input.tabId, decision: "DETECTADO", detected: false, prevented: false, outcome: "OBSERVED", evidence: "BROWSER_NAVIGATION_REPORT" });
    return { recorded: true, id: event.id };
  }
  status() { return [...this.clients.values()].map((c) => ({ ...c, active: c.enabled && Date.now() - Date.parse(c.lastSeen) <= 150000 })); }
}
module.exports = { BrowserObserver };
