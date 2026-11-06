"use strict";
const os = require("node:os");
function deviceIdentity() {
  return { device: process.env.DLP_DEVICE_ID || os.hostname(), hostname: os.hostname(), platform: process.platform, version: "3.0.0", startMode: process.env.DLP_AGENT_START_MODE || "MANUAL" };
}
module.exports = { deviceIdentity };
