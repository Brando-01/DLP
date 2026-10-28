"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { validatePolicies, DEFAULT_POLICY } = require("../lib/policy");
const PROJECT = path.resolve(__dirname, "..");

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function defaultConfig() {
  const lab = path.join(PROJECT, "laboratorio");
  return {
    schemaVersion: 1,
    watchRoots: [path.join(lab, "protegidos")],
    restrictedDestinations: [],
    maxFiles: 2500,
    scanIntervalSeconds: 120,
    clipboardMonitor: true,
    clipboardRemediation: false,
    notifications: true,
    browserDomains: ["*"],
    browserFailClosed: true,
    policies: structuredClone(DEFAULT_POLICY),
    targets: [
      { id: "usb-laboratorio", name: "USB: directorio de prueba", channel: "usb", path: path.join(lab, "salida-usb"), lab: true },
      { id: "red-laboratorio", name: "Carpeta compartida: directorio de prueba", channel: "network_share", path: path.join(lab, "salida-red"), lab: true },
      { id: "http-laboratorio", name: "Receptor HTTP de laboratorio", channel: "http_transfer", url: "http://127.0.0.1:4100/upload", lab: true },
    ],
  };
}

function validateConfig(value) {
  if (!value || !Array.isArray(value.watchRoots) || value.watchRoots.length > 20) throw new Error("Especifica de 1 a 20 carpetas vigiladas");
  const config = { ...defaultConfig(), ...value };
  config.watchRoots = [...new Set(value.watchRoots.map((p) => {
    if (typeof p !== "string" || !path.isAbsolute(p) || p.includes("\0")) throw new Error("La carpeta vigilada debe ser una ruta absoluta");
    return path.resolve(p);
  }))];
  if (!config.watchRoots.length) throw new Error("Debe existir al menos una carpeta vigilada");
  if (!Array.isArray(config.restrictedDestinations) || config.restrictedDestinations.length > 20 || config.restrictedDestinations.some((p) => typeof p !== "string" || !path.isAbsolute(p) || p.includes("\0"))) throw new Error("Destinos observados no válidos");
  config.restrictedDestinations = [...new Set(config.restrictedDestinations.map((p) => path.resolve(p)))];
  if (config.restrictedDestinations.some((p) => config.watchRoots.some((root) => isWithin(p, root) || isWithin(root, p)))) throw new Error("Las carpetas de origen y destinos no autorizados deben estar separadas");
  if (!Number.isInteger(config.maxFiles) || config.maxFiles < 1 || config.maxFiles > 20000) throw new Error("Límite de inventario inválido");
  if (!Number.isInteger(config.scanIntervalSeconds) || config.scanIntervalSeconds < 10 || config.scanIntervalSeconds > 3600) throw new Error("Intervalo de exploración inválido");
  for (const key of ["clipboardMonitor", "clipboardRemediation", "notifications", "browserFailClosed"]) if (typeof config[key] !== "boolean") throw new Error(`Configuración inválida: ${key}`);
  config.policies = validatePolicies(config.policies);
  if (!Array.isArray(config.browserDomains) || config.browserDomains.length > 100 || config.browserDomains.some((d) => typeof d !== "string" || !/^(\*|(?:\*\.)?[a-z0-9.-]+)$/i.test(d))) throw new Error("Lista de dominios no válida");
  if (!Array.isArray(config.targets) || config.targets.length > 20) throw new Error("Destinos no válidos");
  const ids = new Set();
  config.targets = config.targets.map((target) => {
    if (!target || !/^[a-z0-9_-]{1,50}$/i.test(target.id || "") || ids.has(target.id)) throw new Error("Identificador de destino no válido o repetido");
    ids.add(target.id);
    if (!["usb", "network_share", "http_transfer"].includes(target.channel) || typeof target.name !== "string" || target.name.length > 100 || typeof target.lab !== "boolean") throw new Error("Destino no válido");
    const clean = { id: target.id, name: target.name, channel: target.channel, lab: target.lab };
    if (target.channel === "http_transfer") {
      const url = new URL(target.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error("URL de destino no admitida");
      clean.url = url.href;
    } else {
      if (typeof target.path !== "string" || !path.isAbsolute(target.path) || target.path.includes("\0")) throw new Error("Ruta de destino no válida");
      clean.path = path.resolve(target.path);
      if (!target.lab && target.channel === "network_share" && !/^\\\\[^\\]+\\[^\\]+/.test(target.path)) throw new Error("El destino SMB real debe ser una ruta UNC");
    }
    return clean;
  });
  return config;
}

function loadState(dataDirectory, overrides = {}) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const file = path.join(dataDirectory, "config.json");
  const config = validateConfig({ ...(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : defaultConfig()), ...overrides });
  writeJsonAtomic(file, config);
  const credentialsFile = path.join(dataDirectory, "credenciales.json");
  if (!fs.existsSync(credentialsFile)) writeJsonAtomic(credentialsFile, { admin: crypto.randomBytes(32).toString("hex"), browser: crypto.randomBytes(32).toString("hex") });
  const credentials = JSON.parse(fs.readFileSync(credentialsFile, "utf8"));
  for (const key of ["admin", "browser"]) if (!/^[a-f0-9]{64}$/.test(credentials[key] || "")) throw new Error("Archivo de credenciales no válido");
  return { config, credentials, file };
}

function isWithin(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function suggestedRoots() {
  return ["Documents", "Desktop", "Downloads"].map((name) => path.join(os.homedir(), name)).filter((p) => fs.existsSync(p));
}

module.exports = { PROJECT, defaultConfig, validateConfig, loadState, writeJsonAtomic, isWithin, suggestedRoots };
