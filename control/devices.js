"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { writeJsonAtomic } = require("../endpoint/config");
const { sensorReport } = require("../lib/sensor-report");
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const equalHash = (value, hash) => typeof value === "string" && value.length === 64 && /^[a-f0-9]{64}$/.test(hash || "") && crypto.timingSafeEqual(Buffer.from(digest(value), "hex"), Buffer.from(hash, "hex"));
const short = (value, length = 100) => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, "").slice(0, length) : "";

class DeviceStore {
  constructor(directory, options = {}) {
    this.file = path.join(directory, "equipos.json");
    this.now = options.now || Date.now;
    this.state = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, "utf8")) : { schemaVersion: 1, devices: [], legacy: [] };
    if (this.state.schemaVersion !== 1 || !Array.isArray(this.state.devices) || !Array.isArray(this.state.legacy) || this.state.devices.length > 1000 || this.state.devices.some(d => !/^[a-f0-9-]{36}$/.test(d.id || ""))) throw new Error("Registro de equipos incompatible; no se reemplazó.");
  }
  save() { writeJsonAtomic(this.file, this.state); }
  get(id) { return this.state.devices.find(d => d.id === id); }
  invite({ name, platform, serverUrl, allowLabHttp = false }) {
    if (typeof name !== "string" || name.trim().length < 1 || name.length > 80 || /[\x00-\x1f]/.test(name) || !["win32", "linux"].includes(platform)) throw new Error("Indica nombre y plataforma Windows/Linux válidos.");
    const url = new URL(serverUrl);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || !["http:", "https:"].includes(url.protocol)) throw new Error("Dirección central inválida.");
    if (url.protocol === "http:" && !allowLabHttp) throw new Error("Usa HTTPS; HTTP requiere el modo de laboratorio aislado del servidor.");
    if (this.state.devices.length >= 1000) throw new Error("Límite de equipos alcanzado.");
    const token = crypto.randomBytes(32).toString("hex");
    const createdAt = new Date(this.now()).toISOString(), expiresAt = new Date(this.now() + 30 * 60000).toISOString();
    const device = { id: crypto.randomUUID(), name: name.trim(), platform, createdAt, expiresAt, invitationHash: digest(token), lastSeen: null, enrolledAt: null, revokedAt: null };
    this.state.devices.push(device); this.save();
    return { device: this.public(device), invitation: { schemaVersion: 1, deviceId: device.id, serverUrl: url.origin, token, expiresAt, allowLabHttp: url.protocol === "http:" } };
  }
  enroll({ deviceId, token, hostname, platform, version }) {
    const device = this.get(deviceId);
    if (!device || device.revokedAt || device.enrolledAt || Date.parse(device.expiresAt) <= this.now() || !equalHash(token, device.invitationHash)) throw new Error("Invitación inválida, usada o caducada.");
    if (platform !== device.platform || !short(hostname)) throw new Error("La plataforma o el nombre del equipo no corresponden a la invitación.");
    const inspectToken = crypto.randomBytes(32).toString("hex"), telemetryToken = crypto.randomBytes(32).toString("hex");
    Object.assign(device, { enrolledAt: new Date(this.now()).toISOString(), hostname: short(hostname), version: short(version, 30), inspectHash: digest(inspectToken), telemetryHash: digest(telemetryToken) });
    delete device.invitationHash; this.save();
    return { deviceId: device.id, name: device.name, inspectToken, telemetryToken };
  }
  authenticate(token, role) {
    if (!["inspect", "telemetry"].includes(role) || typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
    return this.state.devices.find(d => !d.revokedAt && d.enrolledAt && equalHash(token, d[role + "Hash"])) || null;
  }
  revoke(id) {
    const device = this.get(id); if (!device) throw new Error("Equipo no encontrado.");
    device.revokedAt ||= new Date(this.now()).toISOString();
    delete device.invitationHash; delete device.inspectHash; delete device.telemetryHash;
    this.save(); return this.public(device);
  }
  heartbeat(device, input) {
    if (input.platform && input.platform !== device.platform) throw new Error("Plataforma del reporte incompatible.");
    Object.assign(device, { lastSeen: new Date(this.now()).toISOString(), hostname: short(input.hostname || device.hostname), version: short(input.version, 30), coverage: short(input.coverage, 200), startMode: short(input.startMode || "MANUAL", 40) });
    device.sensors = sensorReport(input.sensors);
    this.save();
  }
  legacyHeartbeat(name, coverage) {
    let device = this.state.legacy.find(d => d.device === name);
    if (!device) { device = { device: name }; this.state.legacy.push(device); }
    Object.assign(device, { lastSeen: new Date(this.now()).toISOString(), coverage: short(coverage, 200) });
    if (this.state.legacy.length > 1000) this.state.legacy.shift();
    this.save();
  }
  connection(lastSeen) {
    const age = this.now() - Date.parse(lastSeen);
    return !Number.isFinite(age) || age > 120000 ? "OFFLINE" : age > 30000 ? "STALE" : "ONLINE";
  }
  public(device) {
    const { id, name, platform, hostname, version, createdAt, expiresAt, enrolledAt, revokedAt, lastSeen, coverage, startMode, sensors } = device;
    return { device: id, id, name, platform, hostname, version, createdAt, expiresAt, enrolledAt, revokedAt, lastSeen, coverage, startMode, sensors: sensorReport(sensors), identity: "INDIVIDUAL", connection: revokedAt ? "REVOKED" : !enrolledAt ? Date.parse(expiresAt) <= this.now() ? "EXPIRED" : "PENDING" : this.connection(lastSeen) };
  }
  list() {
    return [...this.state.devices.map(d => this.public(d)), ...this.state.legacy.map(d => ({ ...d, name: d.device, identity: "SHARED_LEGACY", connection: this.connection(d.lastSeen) }))];
  }
}
module.exports = { DeviceStore };
