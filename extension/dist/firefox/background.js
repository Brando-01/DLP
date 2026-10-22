"use strict";
if (typeof importScripts === "function") importScripts("connector.js");
const extensionApi = globalThis.browser || globalThis.chrome;
const readSettings = () => extensionApi.storage.local.get({ enabled: true, agentUrl: "http://127.0.0.1:3001", token: "", failClosed: true });
const handler = DlpConnector.createConnector({
  readSettings,
  extensionId: extensionApi.runtime.id,
  onDecision(result) {
    extensionApi.action.setBadgeText({ text: result.unavailable ? "?" : !result.allowed ? "X" : result.decision === "ALERTA" ? "!" : "" });
    extensionApi.action.setBadgeBackgroundColor({ color: result.unavailable ? "#856008" : !result.allowed ? "#993747" : "#486879" });
  },
});
extensionApi.runtime.onMessage.addListener((message, sender, respond) => {
  handler(message, sender).then(respond).catch((error) => respond({ allowed: false, decision: "ERROR", reason: error.message }));
  return true;
});
extensionApi.action.onClicked.addListener(() => extensionApi.runtime.openOptionsPage());
