"use strict";
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const file = path.join(ROOT, ".env");
if (fs.existsSync(file)) process.loadEnvFile(file);
module.exports = { ROOT };
