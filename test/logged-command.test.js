"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loggedCommand } = require("../scripts/logged-command");

test("el progreso llega antes de terminar y oculta secretos divididos entre fragmentos", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dlp-progress-test-"));
  const marker = path.join(directory, "progreso-recibido");
  t.after(() => { fs.rmSync(marker, { force: true }); fs.rmdirSync(directory); });
  const messages = [];
  const secret = "credencial-ficticia-de-prueba";
  // El hijo solo termina bien si el padre recibió el progreso mientras seguía vivo.
  await loggedCommand(process.execPath, ["-e", `const fs=require('node:fs');process.stdout.write('Instalando\\n');process.stderr.write('credencial-ficticia-');setTimeout(()=>process.stderr.write('de-prueba\\n'),50);const timer=setTimeout(()=>process.exit(3),3000);setTimeout(()=>{if(fs.existsSync(process.argv[1])){clearTimeout(timer);process.stdout.write('Listo')}else{process.exit(4)}},180);`, marker], {
    secrets: [secret], heartbeatMs: 40, label: "Prueba", log: line => { messages.push(line); if (line.includes("Instalando")) fs.writeFileSync(marker, "recibido"); }
  });
  assert.equal(fs.existsSync(marker), true);
  assert.ok(messages.some(line => line.includes("Sigue en ejecución")));
  assert.ok(messages.some(line => line.includes("[OCULTO]")));
  assert.ok(messages.some(line => line.includes("Listo")));
  assert.equal(messages.join("\n").includes(secret), false);
});

test("un fallo conserva la causa visible y oculta credenciales en el error", async () => {
  await assert.rejects(loggedCommand(process.execPath, ["-e", "process.stderr.write('DESCARGA_FALLIDA clave-ficticia');process.exitCode=7"], {
    secrets: ["clave-ficticia"], log: () => {}
  }), error => /código 7/.test(error.message) && /DESCARGA_FALLIDA/.test(error.message) && !error.message.includes("clave-ficticia"));
});

test("el límite y la cancelación terminan el proceso de espera", async () => {
  await assert.rejects(loggedCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeout: 150, log: () => {} }), /tiempo límite/);
  const abort = new AbortController();
  const pending = loggedCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], { signal: abort.signal, log: () => {} });
  abort.abort();
  await assert.rejects(pending, /abort/i);
});
