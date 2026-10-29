"use strict";
const fs = require("node:fs");
const path = require("node:path");
const files = ["connector.js", "background.js", "content.js", "content.css", "options.html", "options.css", "options.js"];
const common = {
  manifest_version: 3, name: "DLP de laboratorio · Conector", version: "3.1.0",
  description: "Inspecciona interacciones manuales soportadas mediante el agente DLP local.",
  permissions: ["storage", "webNavigation", "alarms"], host_permissions: ["http://127.0.0.1/*", "http://localhost/*"],
  content_scripts: [{ matches: ["http://*/*", "https://*/*"], js: ["content.js"], css: ["content.css"], run_at: "document_start", all_frames: true }],
  options_ui: { page: "options.html", open_in_tab: true },
  action: { default_title: "Configurar el conector DLP" },
};
for (const browser of ["chromium", "firefox"]) {
  const target = path.join(__dirname, "dist", browser);
  fs.mkdirSync(target, { recursive: true });
  files.forEach((file) => fs.copyFileSync(path.join(__dirname, "common", file), path.join(target, file)));
  const manifest = structuredClone(common);
  if (browser === "chromium") { manifest.background = { service_worker: "background.js" }; manifest.minimum_chrome_version = "121"; }
  else {
    manifest.background = { scripts: ["connector.js", "background.js"] };
    manifest.browser_specific_settings = { gecko: { id: "dlp-laboratorio@brando.local", strict_min_version: "128.0" } };
  }
  fs.writeFileSync(path.join(target, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Complemento generado: ${target}`);
}
