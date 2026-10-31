"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createConnector, validateAgentUrl, coveredDomain } = require("../extension/common/connector");

const sender = { id: "extension-de-prueba", tab: { id: 1 }, url: "https://destino.example/formulario" };
function connector(fetchImpl, settings = {}) {
  return createConnector({ readSettings: async () => ({ enabled: true, agentUrl: "http://127.0.0.1:3001", token: "a".repeat(64), failClosed: true, ...settings }), fetchImpl, extensionId: sender.id });
}
function response(value) { return { ok: true, json: async () => value }; }
test("el complemento no permite enviar el token del agente a un servidor externo", () => {
  assert.equal(validateAgentUrl("http://127.0.0.1:3001"), "http://127.0.0.1:3001");
  for (const url of ["https://example.com", "http://127.0.0.1.evil.example", "http://user:password@localhost:3001", "http://127.0.0.1:3001/api"]) assert.throws(() => validateAgentUrl(url));
});
test("el alcance de dominio no confunde subdominios con sufijos de otro dominio", () => {
  assert.equal(coveredDomain("https://a.example.com", ["*.example.com"]), true);
  assert.equal(coveredDomain("https://example.com.evil.test", ["*.example.com"]), false);
  assert.equal(coveredDomain("file:///C:/datos.txt", ["*"]), false);
});
test("la URL evaluada viene del emisor del navegador y no del documento", async () => {
  let payload;
  const handle = connector(async (url, options) => {
    if (url.endsWith("/config")) return response({ domains: ["*"], failClosed: true });
    payload = JSON.parse(options.body);
    return response({ allowed: false, decision: "BLOQUEADO", ticket: "prueba" });
  });
  const result = await handle({ type: "INSPECT", channel: "browser_paste", text: "DNI: 12345678", url: "https://mentira.example" }, sender);
  assert.equal(payload.url, sender.url);
  assert.equal(result.allowed, false);
  await assert.rejects(handle({ type: "INSPECT" }, { ...sender, id: "otro" }), /no autorizado/);
});
test("la indisponibilidad conserva la política de cierre ante fallo", async () => {
  const failingFetch = async () => { throw new Error("agente detenido"); };
  const strict = await connector(failingFetch)({ type: "INSPECT", channel: "browser_paste", text: "hola" }, sender);
  assert.equal(strict.allowed, false);
  assert.equal(strict.decision, "NO_ANALIZADO");
  const open = await connector(failingFetch, { failClosed: false })({ type: "INSPECT", channel: "browser_paste", text: "hola" }, sender);
  assert.equal(open.allowed, true);
  assert.equal(open.unavailable, true);
});
test("inspección espera al central; configuración y recibos mantienen tiempo acotado", async t => {
  const original = AbortSignal.timeout, timeouts = [];
  AbortSignal.timeout = (ms) => { timeouts.push(ms); return new AbortController().signal; };
  t.after(() => { AbortSignal.timeout = original; });
  const handle = connector(async (url) => url.endsWith("/config") ? response({ domains: ["*"], failClosed: true }) : response({ allowed: true }));
  await handle({ type: "INSPECT", channel: "browser_file", fileName: "publico.txt", text: "Horario público" }, sender);
  await handle({ type: "RESULT", ticket: "ficticio", outcome: "RELEASED" }, sender);
  assert.deepEqual(timeouts, [12000, 65000, 12000]);
});
test("un dominio excluido no envía el contenido al clasificador", async () => {
  let calls = 0;
  const handle = connector(async () => { calls += 1; return response({ domains: ["otro.example"], failClosed: true }); });
  const result = await handle({ type: "INSPECT", channel: "browser_paste", text: "privado" }, sender);
  assert.equal(result.decision, "FUERA_DE_ALCANCE");
  assert.equal(calls, 1);
});

test("navegación: usa el origen del evento nativo y elimina búsquedas y fragmentos antes de enviar", async () => {
  let payload;
  const handle = connector(async (url, options) => {
    if (url.endsWith("/config")) return response({ domains: ["*"], failClosed: true });
    payload = JSON.parse(options.body); return response({ recorded: true });
  }, { clientId: "d".repeat(36), logNavigation: true });
  const native = { ...sender, frameId: 0, navigationEvent: true, url: "https://destino.example/ruta/privada?q=SECRETO#oculto" };
  await handle({ type: "NAVIGATION", kind: "COMMITTED", url: "https://mentira.example" }, native);
  assert.equal(payload.url, "https://destino.example"); assert.ok(!JSON.stringify(payload).includes("SECRETO"));
  await assert.rejects(handle({ type: "NAVIGATION", kind: "COMMITTED" }, sender), /evento del navegador/);
});
