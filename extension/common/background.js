"use strict";
if (typeof importScripts === "function") importScripts("connector.js");
const extensionApi = globalThis.browser || globalThis.chrome;
const readSettings = async () => {
  const settings = await extensionApi.storage.local.get({ enabled: true, agentUrl: "http://127.0.0.1:3001", token: "", failClosed: true, logNavigation: true, clientId: "" });
  if (!settings.clientId) { settings.clientId = crypto.randomUUID(); await extensionApi.storage.local.set({ clientId: settings.clientId }); }
  return settings;
};
const handler = DlpConnector.createConnector({
  readSettings,
  extensionId: extensionApi.runtime.id,
  onDecision(result) {
    extensionApi.action.setBadgeText({ text: result.unavailable ? "?" : !result.allowed ? "X" : result.decision === "ALERTA" ? "!" : "" });
    extensionApi.action.setBadgeBackgroundColor({ color: result.unavailable ? "#856008" : !result.allowed ? "#993747" : "#486879" });
  },
});
extensionApi.runtime.onMessage.addListener((message, sender, respond) => {
  if (["NAVIGATION", "HEARTBEAT"].includes(message.type)) { respond({ error: "Mensaje reservado al fondo del complemento" }); return false; }
  handler(message, sender).then(respond).catch((error) => respond({ allowed: false, decision: "ERROR", reason: error.message }));
  return true;
});
extensionApi.action.onClicked.addListener(() => extensionApi.runtime.openOptionsPage());
const heartbeat = () => handler({ type: "HEARTBEAT", version: extensionApi.runtime.getManifest().version }, { id: extensionApi.runtime.id }).catch(() => {});
extensionApi.alarms.create("dlp-heartbeat", { periodInMinutes: 1 });
extensionApi.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "dlp-heartbeat") heartbeat(); });
extensionApi.storage.onChanged.addListener((_changes, area) => { if (area === "local") heartbeat(); });
function navigation(details, kind) {
  if (details.frameId !== 0 || details.tabId < 0 || !/^https?:\/\//.test(details.url)) return;
  handler({ type: "NAVIGATION", kind }, { id: extensionApi.runtime.id, tab: { id: details.tabId }, url: details.url, frameId: 0, navigationEvent: true }).catch(() => {});
}
extensionApi.webNavigation.onCommitted.addListener((details) => navigation(details, "COMMITTED"));
extensionApi.webNavigation.onHistoryStateUpdated.addListener((details) => navigation(details, "HISTORY"));
heartbeat();
