"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { temporary } = require("./helpers/fixtures.cjs");
const { LinuxProcessObserver } = require("../endpoint/linux-process-observer");
const { sensorReport } = require("../lib/sensor-report");

test("sensor Linux: muestra inicial, usuario, cambios, límites y pérdida explícita", async t => {
  const tmp = await temporary(); t.after(tmp.cleanup);
  const sensor = new LinuxProcessObserver({ platform: "linux", proc: tmp.root, uid: 1000 });
  t.after(() => sensor.stop());
  const events = []; sensor.on("sensor", e => events.push(e));
  async function proc(pid, name, uid = 1000) {
    const dir = path.join(tmp.root, String(pid)); await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "status"), `Uid:\t${uid}\t${uid}\t${uid}\t${uid}\n`);
    await fs.writeFile(path.join(dir, "comm"), name + "\n");
    await fs.writeFile(path.join(dir, "cmdline"), "ESTO_NO_DEBE_LEERSE");
  }
  await proc(101, "firefox"); await proc(102, "privado-otro-uid", 999);
  await sensor.poll(); assert.equal(events.length, 0); assert.equal(sensor.info.count, 1);
  assert.deepEqual(sensor.info.processes, [{ processId: 101, program: "firefox" }]);
  await proc(103, "discord"); await sensor.poll();
  assert.deepEqual(events.map(e => [e.phase, e.program, e.processId]), [["START", "discord", 103]]);
  await fs.rm(path.join(tmp.root, "103"), { recursive: true }); await sensor.poll();
  assert.equal(events.at(-1).phase, "EXIT");
  // Reutilización del PID con nombre distinto genera salida y entrada.
  await proc(101, "otro"); await sensor.poll();
  assert.deepEqual(events.slice(-2).map(e => [e.phase, e.program]), [["EXIT", "firefox"], ["START", "otro"]]);
  for (let i = 200; i < 310; i++) await proc(i, "muestra" + i);
  const before = events.length; await sensor.poll();
  assert.equal(events.length - before, 100); assert.equal(sensor.info.droppedEvents, 10);
  assert.equal(sensor.info.processes.length, 50); assert.equal(sensor.info.truncated, true);
  assert.ok(!JSON.stringify(sensor.info).includes("ESTO_NO_DEBE_LEERSE"));
  sensor.stop(); assert.equal(sensor.info.available, false);
});

test("Linux real observa un proceso propio y su salida, sin argumentos", { skip: process.platform !== "linux" }, async t => {
  const sensor = new LinuxProcessObserver(); t.after(() => sensor.stop());
  await sensor.poll(); const events = []; sensor.on("sensor", e => events.push(e));
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", "ARGUMENTO_NO_RECOLECTADO"], { stdio: "ignore" });
  t.after(() => child.kill()); await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  await sensor.poll(); assert.ok(events.some(e => e.phase === "START" && e.processId === child.pid));
  const exit = new Promise(r => child.once("exit", r)); child.kill(); await exit; await sensor.poll();
  assert.ok(events.some(e => e.phase === "EXIT" && e.processId === child.pid));
  assert.ok(!JSON.stringify(events).includes("ARGUMENTO_NO_RECOLECTADO"));
});

test("reporte de sensores descarta contenido libre y acota metadatos", () => {
  const report = sensorReport({ process: { available: true, count: 60, processes: Array.from({ length: 60 }, (_, i) => ({ processId: i + 1, program: "x".repeat(500), cmdline: "SECRETO" })) }, browser: { activeClients: 1, rawToken: "SECRETO" }, universalInterception: true, content: "SECRETO" });
  assert.equal(report.process.processes.length, 50); assert.equal(report.process.processes[0].program.length, 160);
  assert.equal(report.universalInterception, false); assert.ok(!JSON.stringify(report).includes("SECRETO"));
});
