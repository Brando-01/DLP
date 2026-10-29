"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");
const { WindowsBridge } = require("../endpoint/windows-bridge");
async function until(predicate, timeout = 18000) { const at = Date.now(); while (!predicate()) { if (Date.now() - at > timeout) throw new Error("El sensor no produjo el evento esperado sin recibir órdenes"); await new Promise((r) => setTimeout(r, 150)); } }
async function run() {
  if (process.platform !== "win32") throw new Error("Esta comprobación necesita Windows interactivo");
  const bridge = new WindowsBridge(); let child; let statuses = 0; const events = [];
  bridge.on("status", () => statuses++); bridge.on("sensor", (e) => events.push(e));
  try {
    bridge.start(); await until(() => bridge.info.available);
    await bridge.request("configure", { clipboardMonitor: false, printingMonitor: false });
    child = spawn(process.execPath, ["-e", "setTimeout(()=>{},30000)"], { windowsHide: true, stdio: "ignore" });
    await until(() => events.some((e) => e.type === "process-observed" && e.processId === child.pid && e.phase === "START"));
    await until(() => statuses >= 2);
    assert.ok(!["NO_COMPROBADO", undefined].includes(bridge.info.sysmon));
    const pid = child.pid; child.kill();
    await until(() => events.some((e) => e.type === "process-observed" && e.processId === pid && e.phase === "EXIT"));
    const report = { generatedAt: new Date().toISOString(), heartbeatWithoutCommands: true, actualProcessStartObserved: true, actualProcessExitObserved: true, clipboardReadForTest: false, sysmon: bridge.info.sysmon, evidence: "REAL_WINDOWS_SENSOR_IDLE_AND_PROCESS_LIFECYCLE" };
    await fs.writeFile("output/evaluacion/resultado-observador-windows.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally { child?.kill(); await bridge.stop(); }
}
run().catch((e) => { console.error(e.message); process.exitCode = 1; });
