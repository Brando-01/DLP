"use strict";

const { app } = require("./app");
const { startEndpoint } = require("./endpoint/server");
const { startControl } = require("./control/server");

async function start() {
  const control = process.env.DLP_CONTROL_ADMIN_TOKEN && process.env.DLP_CONTROL_EMBEDDED !== "0" ? await startControl() : null;
  let endpoint;
  try { endpoint = await startEndpoint(); } catch (error) { await control?.stop(); throw error; }
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || "0.0.0.0";
  let web;
  try { web = app.listen(port, host); await new Promise((resolve, reject) => { web.once("listening", resolve); web.once("error", reject); }); }
  catch (error) { await endpoint.stop(); await control?.stop(); throw error; }
  console.log(`Panel del agente: http://127.0.0.1:${endpoint.server.address().port}`);
  console.log(`Portal de pruebas: http://localhost:${port} (escucha ${host})`);
  if (control) console.log(`Consola central: http://127.0.0.1:${control.server.address().port}`);
  console.log("El agente no aplica automáticamente restricciones generales USB, SMB o de impresión.");
  let stopped = false;
  const stop = async () => {
    if (stopped) return; stopped = true;
    await endpoint.stop();
    await control?.stop();
    await new Promise((resolve) => web.close(resolve));
  };
  endpoint.runtime.once("exit-request", stop);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop().catch(() => {}));
  return { endpoint, web, control, stop };
}

if (require.main === module) {
  const abort = new AbortController(); let service;
  const stop = () => { abort.abort(); service?.stop().catch(error => console.error(error.message)); };
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop);
  require("./scripts/run-all").main(process.argv.slice(2), { signal: abort.signal }).then(value => {
    service = value;
    if (abort.signal.aborted) return service.stop();
  }).catch(error => {
    console.error(abort.signal.aborted ? "Arranque cancelado. Si quedó un backend iniciado, comprueba su estado con wsl:status o Lab-WSL.ps1 -Action Status." : `Arranque incompleto: ${error.message}`);
    process.exitCode = abort.signal.aborted ? 0 : 1;
  });
}
module.exports = { start };
