"use strict";

(() => {
  // El panel administrativo no es un destino de exfiltración del conector.
  if (["127.0.0.1", "localhost"].includes(location.hostname) && location.port === "3001") return;
  const api = globalThis.browser || globalThis.chrome;
  const released = new WeakSet();
  const busy = new WeakSet();
  const picking = new WeakSet();
  let enabled = true;
  api.storage.local.get({ enabled: true }).then((value) => { enabled = value.enabled; });
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.enabled) {
      enabled = changes.enabled.newValue !== false;
      if (enabled) document.querySelectorAll('input[type="file"]').forEach((input) => { input.value = ""; });
    }
  });

  function notify(message) {
    document.getElementById("dlp-agent-notice")?.remove();
    const node = document.createElement("div"); node.id = "dlp-agent-notice"; node.setAttribute("role", "alert"); node.textContent = message;
    (document.body || document.documentElement).appendChild(node);
    setTimeout(() => node.remove(), 9000);
  }
  async function inspect(data) {
    try {
      const result = await api.runtime.sendMessage({ type: "INSPECT", ...data });
      if (!result || typeof result.allowed !== "boolean") throw new Error("Respuesta incompleta");
      return result;
    }
    catch { return { allowed: false, decision: "NO_ANALIZADO", reason: "No se pudo consultar al conector DLP" }; }
  }
  async function report(result, outcome) {
    if (!result.ticket) return;
    try { await api.runtime.sendMessage({ type: "RESULT", ticket: result.ticket, outcome }); } catch {}
  }
  function explain(result) {
    if (!result.allowed && (result.decision === "NO_ANALIZADO" || result.cause === "NO_INSPECCIONABLE" || result.inspectionStatus && result.inspectionStatus !== "COMPLETE" || result.semantic?.required && result.semantic.status !== "COMPLETE")) {
      const indicators = result.detected === true || result.score > 0;
      return `DLP: interacción retenida por análisis incompleto${indicators ? "; también hay indicadores sensibles" : ", sin una detección confirmada de datos sensibles"}. ${result.reason || result.decision}. Puedes volver a seleccionar un archivo.`;
    }
    return `${result.allowed ? "DLP: operación permitida con observación" : "DLP: interacción retenida"}. ${result.reason || result.decision}${result.score != null ? ` · ${result.score} puntos` : ""}`;
  }
  function fileEvents(input, cancelled = false) {
    // La página debe terminar su flujo de selección incluso al rechazar o
    // cancelar. El guard impide que nuestros eventos vuelvan a inspeccionarse.
    released.add(input);
    try {
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      if (cancelled) input.dispatchEvent(new Event("cancel", { bubbles: true, composed: true }));
    } finally { released.delete(input); }
  }
  function resetFile(input) { input.value = ""; fileEvents(input, true); }
  function reportBatch(batch, outcome) {
    // Los recibos de auditoría no mantienen ocupado el control de la página.
    for (const result of batch?.results || []) void report(result, outcome === "CANCELLED" && result.allowed ? "FAILED" : outcome);
  }
  async function encode(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunks = [];
    for (let i = 0; i < bytes.length; i += 32768) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
    return btoa(chunks.join(""));
  }
  async function checkFiles(files, channel) {
    if (files.length > 20 || files.some((file) => file.size > 10 * 1024 * 1024)) {
      notify("DLP: no se libera la selección. El conector admite hasta 20 archivos de 10 MiB cada uno; no se ha inspeccionado este contenido.");
      return { allowed: false, results: [] };
    }
    const results = [];
    for (const file of files) results.push(await inspect({ channel, fileName: file.name, base64: await encode(file) }));
    return { allowed: results.every((result) => result.allowed), results };
  }
  async function releaseFiles(input, chosen) {
    if (busy.has(input)) return;
    busy.add(input);
    let batch;
    try {
      notify("DLP: analizando la selección. Puedes seguir usando la página; espera el resultado antes de adjuntar.");
      batch = await checkFiles(chosen, "browser_file");
      if (!batch.allowed) {
        resetFile(input);
        reportBatch(batch, "CANCELLED");
        if (batch.results.length) notify(explain(batch.results.find((r) => !r.allowed)));
        return;
      }
      const transfer = new DataTransfer(); chosen.forEach((file) => transfer.items.add(file));
      input.files = transfer.files;
      fileEvents(input);
      document.getElementById("dlp-agent-notice")?.remove();
      reportBatch(batch, "RELEASED");
      for (const result of batch.results) if (["ALERTA", "DETECTADO"].includes(result.decision)) notify(explain(result));
    } catch {
      resetFile(input);
      reportBatch(batch, "FAILED");
      notify("DLP: no se pudo completar la interacción. La selección permanece vacía; puedes volver a intentarlo sin recargar.");
    } finally { busy.delete(input); }
  }
  function findInput(event) { return event.composedPath().find((node) => node instanceof HTMLInputElement && node.type === "file"); }
  window.addEventListener("click", (event) => {
    if (!enabled) return;
    const input = findInput(event);
    if (!input || input.disabled || released.has(input)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (busy.has(input) || picking.has(input)) { notify("DLP: ya hay una selección en curso para este campo."); return; }
    input.value = "";
    if (input.webkitdirectory) { resetFile(input); notify("DLP: la selección de directorios no está soportada por este conector."); return; }
    // El selector privado evita exponer los archivos al DOM de la página antes de decidir.
    const host = document.createElement("div"); host.className = "dlp-private-picker";
    const shadow = host.attachShadow({ mode: "closed" });
    const picker = document.createElement("input"); picker.type = "file"; picker.multiple = input.multiple; picker.accept = input.accept;
    shadow.appendChild(picker); document.documentElement.appendChild(host);
    picking.add(input);
    let settled = false;
    const settle = (chosen) => {
      if (settled) return;
      settled = true; host.remove(); picking.delete(input);
      if (chosen.length) void releaseFiles(input, chosen); else resetFile(input);
    };
    picker.addEventListener("change", () => settle([...picker.files]), { once: true });
    picker.addEventListener("cancel", () => settle([]), { once: true });
    try { picker.click(); } catch { settle([]); notify("DLP: el navegador no abrió el selector. Vuelve a intentarlo."); }
  }, true);
  window.addEventListener("change", (event) => {
    if (!enabled) return;
    const input = findInput(event);
    if (!input || released.has(input) || !input.files.length) return;
    event.stopImmediatePropagation();
    const chosen = [...input.files]; input.value = "";
    releaseFiles(input, chosen);
  }, true);
  window.addEventListener("submit", (event) => {
    if (!enabled || released.has(event.target) || !(event.target instanceof HTMLFormElement)) return;
    const form = event.target;
    const inputs = [...form.querySelectorAll('input[type="file"]')];
    const chosen = inputs.flatMap((input) => [...input.files]);
    if (!chosen.length) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (busy.has(form)) return;
    busy.add(form);
    checkFiles(chosen, "browser_file").then(async (batch) => {
      if (!batch.allowed) {
        inputs.forEach(resetFile);
        reportBatch(batch, "CANCELLED");
        if (batch.results.length) notify(explain(batch.results.find((r) => !r.allowed)));
        return;
      }
      try {
        released.add(form);
        try { form.requestSubmit(event.submitter || undefined); } finally { released.delete(form); }
        reportBatch(batch, "RELEASED");
      } catch { inputs.forEach(resetFile); reportBatch(batch, "FAILED"); notify("DLP: no se pudo completar el envío. Puedes volver a seleccionar el archivo."); }
    }).catch(() => { inputs.forEach(resetFile); notify("DLP: falló la inspección; no se liberó el envío."); }).finally(() => busy.delete(form));
  }, true);
  window.addEventListener("paste", (event) => {
    if (!enabled || !event.clipboardData) return;
    const text = event.clipboardData.getData("text/plain");
    // Un portapapeles vacío no debe inutilizar campos/atajos de la página.
    if (!text && !event.clipboardData.files.length && !event.clipboardData.types.length) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const target = event.composedPath()[0];
    if (!text) { notify("DLP: el pegado no contiene texto analizable. No se libera este formato."); return; }
    inspect({ channel: "browser_paste", fileName: "portapapeles.txt", text }).then(async (result) => {
      if (!result.allowed) { await report(result, "CANCELLED"); notify(explain(result)); return; }
      try {
        if ((target instanceof HTMLInputElement && ["text", "search", "email", "url", "tel", "password"].includes(target.type)) || target instanceof HTMLTextAreaElement) {
          target.setRangeText(text, target.selectionStart ?? target.value.length, target.selectionEnd ?? target.value.length, "end");
          target.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertFromPaste", data: text }));
        } else if (target instanceof HTMLElement && target.isContentEditable) {
          target.focus(); if (!document.execCommand("insertText", false, text)) throw new Error();
        } else throw new Error();
        await report(result, "RELEASED");
        if (["ALERTA", "DETECTADO"].includes(result.decision)) notify(explain(result));
      } catch { await report(result, "FAILED"); notify("DLP: el campo no permite reinsertar el pegado inspeccionado. Usa un campo de texto compatible."); }
    });
  }, true);
  window.addEventListener("drop", (event) => {
    if (!enabled || !event.dataTransfer?.files.length) return;
    if (released.has(event.composedPath()[0])) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const target = event.composedPath()[0]; const files = [...event.dataTransfer.files];
    checkFiles(files, "browser_drop").then(async (batch) => {
      if (!batch.allowed) { for (const result of batch.results) await report(result, "CANCELLED"); if (batch.results.length) notify(explain(batch.results.find((r) => !r.allowed))); return; }
      try {
        const transfer = new DataTransfer(); files.forEach((file) => transfer.items.add(file));
        if (target instanceof HTMLInputElement && target.type === "file") {
          target.files = transfer.files; fileEvents(target);
          for (const result of batch.results) await report(result, "RELEASED");
          return;
        }
        const replay = new DragEvent("drop", { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer });
        released.add(target); try { target.dispatchEvent(replay); } finally { released.delete(target); }
        for (const result of batch.results) await report(result, "RELEASED");
        notify("DLP: archivos inspeccionados y liberados al sitio. Confirma que la página acepte el arrastre reemitido.");
      } catch { for (const result of batch.results) await report(result, "FAILED"); notify("DLP: la página no aceptó la interacción de arrastre inspeccionada."); }
    });
  }, true);
})();
