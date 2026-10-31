"use strict";
// Regresión del content script real, con DOM mínimo; no simula Gmail ni su UI.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../extension/common/content.js"), "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));

function harness(decide, receipt = async () => ({})) {
  const listeners = new Map(), nodes = [], sent = [];
  class Event {
    constructor(type, options = {}) { this.type = type; Object.assign(this, options); }
    preventDefault() { this.prevented = true; }
    stopImmediatePropagation() { this.stopped = true; }
    composedPath() { return [this.target]; }
  }
  const window = { addEventListener(type, listener) { const list = listeners.get(type) || []; list.push(listener); listeners.set(type, list); } };
  class Element {
    constructor() { this.handlers = new Map(); this.events = []; this.value = ""; }
    setAttribute() {}
    appendChild(node) { nodes.push(node); return node; }
    attachShadow() { return new Element(); }
    remove() { this.removed = true; }
    addEventListener(type, listener) { this.handlers.set(type, listener); }
    dispatchEvent(event) {
      event.target = this;
      // Un closed shadow retargetea los eventos al host, no expone el input.
      if (!this.privatePicker) for (const listener of listeners.get(event.type) || []) { listener(event); if (event.stopped) return false; }
      this.events.push({ type: event.type, count: this.files?.length });
      this.handlers.get(event.type)?.(event);
      return true;
    }
    click() { this.dispatchEvent(new Event("click")); }
  }
  class Input extends Element {
    constructor() { super(); this.type = "file"; this.files = []; }
    set value(value) { this._value = value; if (!value) this.files = []; }
    get value() { return this._value; }
  }
  class DataTransfer {
    constructor() { this.files = []; this.items = { add: (file) => this.files.push(file) }; }
  }
  const document = {
    documentElement: new Element(), body: new Element(),
    getElementById: (id) => nodes.findLast((node) => node.id === id && !node.removed),
    createElement: (tag) => { const node = tag === "input" ? new Input() : new Element(); if (tag === "input") node.privatePicker = true; return node; },
    querySelectorAll: () => [],
  };
  const api = { storage: { local: { get: async () => ({ enabled: true }) }, onChanged: { addListener() {} } }, runtime: { sendMessage: async (message) => { sent.push(message); return message.type === "INSPECT" ? decide(message) : receipt(message); } } };
  vm.runInNewContext(source, { window, document, location: { hostname: "example.test", port: "443" }, chrome: api, Event, InputEvent: Event, DragEvent: Event, HTMLInputElement: Input, HTMLElement: Element, HTMLFormElement: class {}, HTMLTextAreaElement: class {}, DataTransfer, Uint8Array, btoa: (value) => Buffer.from(value, "binary").toString("base64"), setTimeout: () => 0 });
  const input = new Input();
  const choose = (files) => { input.click(); const picker = nodes.findLast((node) => node instanceof Input); picker.files = files; picker.dispatchEvent(new Event("change")); return picker; };
  const file = (name = "archivo.txt", size = 1) => ({ name, size, arrayBuffer: async () => new Uint8Array([65]).buffer });
  return { input, choose, file, sent, nodes, Input, Event };
}

test("rechazo limpia y notifica cancel/input/change; permite otra selección sin recargar", async () => {
  let calls = 0;
  const h = harness(async () => ({ allowed: ++calls > 1, decision: calls > 1 ? "PERMITIDO" : "BLOQUEADO", ticket: String(calls) }));
  h.choose([h.file()]); await tick();
  assert.equal(h.input.value, "");
  assert.deepEqual(h.input.events.map((e) => e.type), ["input", "change", "cancel"]);
  assert.ok(h.input.events.every((e) => e.count === 0));
  h.choose([h.file("publico.txt")]); await tick();
  assert.equal(h.input.files.length, 1);
  assert.equal(h.input.files[0].name, "publico.txt");
  assert.equal(calls, 2);
  assert.deepEqual(h.sent.filter((m) => m.type === "RESULT").map((m) => m.outcome), ["CANCELLED", "RELEASED"]);
});
test("cancelar el selector privado termina también el flujo del campo original", async () => {
  const h = harness(async () => { throw new Error("No inspeccionar cancelación"); });
  h.input.click();
  const picker = h.nodes.findLast((node) => node instanceof h.Input);
  picker.dispatchEvent(new h.Event("cancel"));
  await tick();
  assert.deepEqual(h.input.events.map((e) => e.type), ["input", "change", "cancel"]);
  assert.equal(h.sent.length, 0);
});
test("error o respuesta inválida no deja el campo ocupado ni expone los archivos", async () => {
  for (const fail of [async () => { throw new Error("offline"); }, async () => undefined]) {
    const h = harness(fail);
    h.choose([h.file()]); await tick(); h.choose([h.file()]); await tick();
    assert.equal(h.input.files.length, 0);
    assert.equal(h.sent.filter((m) => m.type === "INSPECT").length, 2);
    assert.equal(h.input.events.filter((e) => e.type === "cancel").length, 2);
  }
});
test("un recibo lento no bloquea otra selección, y un segundo clic no abre otro picker", async () => {
  let finish;
  const h = harness(() => new Promise((resolve) => { finish = resolve; }), () => new Promise(() => {}));
  h.choose([h.file()]); await tick();
  const before = h.nodes.filter((node) => node instanceof h.Input).length;
  h.input.click();
  assert.equal(h.nodes.filter((node) => node instanceof h.Input).length, before);
  finish({ allowed: false, decision: "BLOQUEADO", ticket: "prueba" }); await tick();
  h.choose([h.file()]); await tick();
  assert.equal(h.sent.filter((m) => m.type === "INSPECT").length, 2);
});
test("selección demasiado grande se cancela sin inspección ni publicación", async () => {
  const h = harness(async () => { throw new Error("No debe inspeccionar"); });
  h.choose([h.file("grande.txt", 11 * 1024 * 1024)]); await tick();
  assert.equal(h.sent.length, 0);
  assert.equal(h.input.files.length, 0);
  assert.ok(h.input.events.some((e) => e.type === "cancel"));
});
