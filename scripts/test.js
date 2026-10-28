"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const files = fs.readdirSync(path.join(__dirname, "../test")).filter((p) => p.endsWith(".test.js")).map((p) => path.join(__dirname, "../test", p));
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit", env: { ...process.env, DLP_LLM_MODE: "off", DLP_FORWARD_EVENTS: "0", DLP_INSPECTION_BACKEND: "local" } });
process.exitCode = result.status ?? 1;
