"use strict";

const { app } = require("./app");
const { startEndpoint } = require("./endpoint/server");

async function start() {
  const endpoint = await startEndpoint();
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || "0.0.0.0";
  let web;
  try { web = app.listen(port, host); await new Promise((resolve, reject) => { web.once("listening", resolve); web.once("error", reject); }); }
  catch (error) { await endpoint.stop(); throw error; }
  console.log(`Panel del agente: http://127.0.0.1:${endpoint.server.address().port}`);
  console.log(`Portal de pruebas: http://localhost:${port} (escucha ${host})`);
  console.log("El agente no aplica automáticamente restricciones generales USB, SMB o de impresión.");
  let stopped = false;
  const stop = async () => {
    if (stopped) return; stopped = true;
    await endpoint.stop();
    await new Promise((resolve) => web.close(resolve));
  };
  endpoint.runtime.once("exit-request", stop);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop().catch(() => {}));
  return { endpoint, web, stop };
}

if (require.main === module) start().catch((error) => { console.error(`Arranque incompleto: ${error.message}`); process.exitCode = 1; });
module.exports = { start };
