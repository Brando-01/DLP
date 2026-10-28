"use strict";
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const files = { endpoint: "evaluar-endpoint.js", browser: "browser-e2e.js", windows: "windows-smoke.js" };
const file = files[process.argv[2]];
if (!file) throw new Error("Evaluación local no reconocida");
const result = spawnSync(process.execPath, [path.join(__dirname, "../evaluacion", file)], { stdio: "inherit", env: { ...process.env, DLP_LLM_MODE: "off", DLP_INSPECTION_BACKEND: "local", DLP_FORWARD_EVENTS: "0" } });
process.exitCode = result.status ?? 1;
