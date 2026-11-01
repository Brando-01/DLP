"use strict";
// Demostración por reglas locales: no edita .env ni instala políticas del SO.
require("../lib/environment");
process.env.DLP_LLM_MODE = "off";
process.env.DLP_INSPECTION_BACKEND = "local";
process.env.DLP_FORWARD_EVENTS = "0";
const fs = require("node:fs");
const path = require("node:path");
const { PROJECT } = require("../endpoint/config");
const { startEndpoint } = require("../endpoint/server");
const { createDemoSite } = require("../endpoint/demo-site");
const { createReceiver } = require("../endpoint/receiver");

async function listen(app, port) {
  const server = app.listen(port, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  return server;
}
async function startDemo(options = {}) {
  const root = options.root || PROJECT;
  const lab = path.join(root, "laboratorio");
  const source = path.join(lab, "Finanzas");
  if (!fs.existsSync(path.join(source, "vacio.docx"))) throw new Error("Ejecuta npm.cmd run setup para preparar las muestras ficticias.");
  let endpoint, siteServer, receiverServer, stopping;
  const stop = () => stopping ||= (async () => {
    for (const server of [siteServer, receiverServer]) if (server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    await endpoint?.stop();
  })();
  try {
    const site = createDemoSite(path.join(lab, "sitio-independiente"));
    siteServer = await listen(site.app, options.sitePort ?? 4200);
    const receiver = createReceiver(path.join(lab, "receptor-http"));
    receiverServer = await listen(receiver.app, options.receiverPort ?? 4100);
    endpoint = await startEndpoint({ port: options.agentPort ?? 3001, native: false, dataDirectory: path.join(root, "datos-endpoint", "demo"), config: {
      watchRoots: [source], restrictedDestinations: [path.join(lab, "Escritorio")],
      inventorySemantic: false, clipboardMonitor: false, clipboardRemediation: false, notifications: false,
      targets: [
        { id: "usb-laboratorio", name: "USB: carpeta de prueba, no dispositivo físico", channel: "usb", path: path.join(lab, "salida-usb"), lab: true },
        { id: "red-laboratorio", name: "Red: carpeta de prueba", channel: "network_share", path: path.join(lab, "salida-red"), lab: true },
        { id: "http-laboratorio", name: "Receptor HTTP local", channel: "http_transfer", url: `http://127.0.0.1:${receiverServer.address().port}/upload`, lab: true },
      ],
    } });
    endpoint.runtime.session = { mode: "DEMO", nativeSensitiveOnly: false, siteUrl: `http://127.0.0.1:${siteServer.address().port}` };
    endpoint.runtime.once("exit-request", stop);
    console.log(`DEMO LOCAL: solo reglas, sin Groq, proxy, firewall ni sensores nativos. No equivale a protección completa.`);
    console.log(`Agente: http://127.0.0.1:${endpoint.server.address().port}`);
    console.log(`Receptor independiente: http://127.0.0.1:${siteServer.address().port}`);
    console.log(`Muestras: ${source}`);
    console.log("Vincula la extensión con el token de Navegador de este agente DEMO. Ctrl+C para detener. .env no se modifica.");
    return { endpoint, site, siteServer, receiver, receiverServer, stop };
  } catch (error) { await stop(); throw error; }
}
if (require.main === module) startDemo().then((demo) => {
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => demo.stop().catch(console.error));
}).catch((error) => { console.error(`No se inició la demo: ${error.message}`); process.exitCode = 1; });
module.exports = { startDemo };
