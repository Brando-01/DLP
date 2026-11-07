"use strict";
const { X509Certificate } = require("node:crypto");
function publicProxyCA(raw, now = Date.now()) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 65536 || /PRIVATE KEY/i.test(raw) || (raw.match(/-----BEGIN CERTIFICATE-----/g) || []).length !== 1) throw new Error("Se requiere un único certificado público de CA, sin clave privada.");
  let cert;
  try { cert = new X509Certificate(raw); } catch { throw new Error("El certificado público de CA no es válido."); }
  if (!cert.ca || now < Date.parse(cert.validFrom) || now > Date.parse(cert.validTo)) throw new Error("La CA no está vigente o no es una autoridad certificadora.");
  return { pem: cert.toString(), fingerprint256: cert.fingerprint256 };
}
module.exports = { publicProxyCA };
