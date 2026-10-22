"use strict";

// Generador de documentación: solo usa módulos incorporados en Node.js.
// Ejecutar desde cualquier carpeta: node docs/generar-diagramas.js
const fs = require("node:fs");
const path = require("node:path");
const output = path.join(__dirname, "diagramas");
fs.mkdirSync(output, { recursive: true });

const C = { ink: "#142c43", muted: "#51677b", line: "#cddbe6", teal: "#087f82", blue: "#2866b1", amber: "#976000", red: "#b92f49", green: "#167650" };
const escape = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

class Diagram {
  constructor(width, height, number, title, subtitle) {
    this.width = width;
    this.height = height;
    this.title = title;
    this.parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
      `<title id="title">${escape(title)}</title><desc id="desc">${escape(subtitle)}</desc>`,
      `<defs>${Object.entries(C).map(([key, value]) => `<marker id="arrow-${key}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${value}"/></marker>`).join("")}</defs>`,
      `<style>text{font-family:'Segoe UI',Arial,sans-serif} .mono{font-family:Consolas,'Courier New',monospace}</style>`,
      `<rect width="${width}" height="${height}" fill="#fff"/>`,
    ];
    this.text(34, 32, `DLP / ${number} / IMPLEMENTACIÓN ACTUAL`, { size: 13, color: C.teal, weight: 700 });
    this.text(34, 72, title, { size: 31, weight: 700 });
    this.text(34, 105, subtitle, { size: 17, color: C.muted });
    this.path(`M34 125 H${width - 34}`, { color: C.line, arrow: false });
  }
  text(x, y, lines, opts = {}) {
    const { size = 19, color = C.ink, weight = 400, anchor = "start", leading = size * 1.4, mono = false } = opts;
    const rows = Array.isArray(lines) ? lines : [lines];
    this.parts.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}" text-anchor="${anchor}"${mono ? ' class="mono"' : ""}>${rows.map((row, i) => `<tspan x="${x}" dy="${i ? leading : 0}">${escape(row)}</tspan>`).join("")}</text>`);
  }
  rect(x, y, w, h, { fill = "#f7fafc", stroke = C.line, radius = 16, dashed = false } = {}) {
    this.parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="1.7"${dashed ? ' stroke-dasharray="7 5"' : ""}/>`);
  }
  frame(x, y, w, h, title, color = C.teal) {
    this.rect(x, y, w, h, { fill: "#fbfdff", stroke: color });
    this.text(x + 20, y + 31, title, { size: 18, color, weight: 700 });
  }
  card(x, y, w, h, title, lines = [], color = C.teal) {
    this.rect(x, y, w, h, { fill: "#fff", stroke: color });
    this.text(x + 18, y + 32, title, { size: 20, weight: 700, color });
    this.text(x + 18, y + 62, lines, { size: 17, color: C.muted, leading: 25 });
  }
  path(d, { color = C.ink, arrow = true, dashed = false, start = false } = {}) {
    const key = Object.entries(C).find(([, val]) => val === color)?.[0] || "ink";
    this.parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"${dashed ? ' stroke-dasharray="7 6"' : ""}${arrow ? ` marker-end="url(#arrow-${key})"` : ""}${start ? ` marker-start="url(#arrow-${key})"` : ""}/>`);
  }
  oval(cx, cy, rx, ry, lines) {
    this.parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff" stroke="${C.teal}" stroke-width="2"/>`);
    const rows = Array.isArray(lines) ? lines : [lines];
    this.text(cx, cy - (rows.length - 1) * 12 + 7, rows, { size: 21, anchor: "middle", leading: 26 });
  }
  diamond(cx, cy, w, h, lines) {
    this.parts.push(`<polygon points="${cx},${cy - h / 2} ${cx + w / 2},${cy} ${cx},${cy + h / 2} ${cx - w / 2},${cy}" fill="#eef7f8" stroke="${C.teal}" stroke-width="2"/>`);
    this.text(cx, cy - 8, lines, { size: 20, anchor: "middle", leading: 27, weight: 600 });
  }
  actor(cx, y, name) {
    this.parts.push(`<circle cx="${cx}" cy="${y + 18}" r="17" fill="#fff" stroke="${C.ink}" stroke-width="2"/>`);
    this.path(`M${cx} ${y + 35} V${y + 81} M${cx - 29} ${y + 52} H${cx + 29} M${cx} ${y + 81} L${cx - 24} ${y + 113} M${cx} ${y + 81} L${cx + 24} ${y + 113}`, { arrow: false });
    this.text(cx, y + 140, name, { size: 18, anchor: "middle", weight: 600, leading: 24 });
  }
  footer(text) {
    this.text(34, this.height - 26, text, { size: 16, color: C.muted });
  }
  render() { return `${this.parts.join("\n")}\n</svg>\n`; }
}

function network() {
  const d = new Diagram(1440, 890, "01", "Arquitectura de red", "Un equipo físico: Kali origina la carga y Windows inspecciona y decide el almacenamiento.");
  d.frame(34, 150, 1372, 650, "PC FÍSICA · WINDOWS ALOJA EL SERVICIO Y LA VM KALI", C.blue);
  d.frame(62, 211, 330, 430, "VM Kali Linux");
  d.card(84, 265, 286, 83, "Cliente del laboratorio", ["IP: 192.168.56.X"], C.blue);
  d.card(84, 380, 286, 80, "Archivo ficticio", ["TXT / CSV / JSON"]);
  d.card(84, 500, 286, 100, "Firefox o curl", ["Selecciona y envía", "el contenido del archivo"]);
  d.path("M227 460 V500");
  d.card(456, 392, 252, 153, "Red Host-only", ["192.168.56.0/24", "ICMP: prueba de ping", "TCP: puerto destino 3000"], C.blue);
  d.path("M370 525 H456", { color: C.blue });
  d.text(405, 500, "HTTP", { size: 16, anchor: "middle", color: C.blue });
  d.frame(776, 211, 601, 430, "Servicio DLP en Windows");
  d.card(802, 265, 548, 83, "Host: 192.168.56.1", ["Node.js / Express · escucha 0.0.0.0:3000"], C.blue);
  d.card(802, 390, 548, 105, "POST /api/upload", ["Recibe en memoria → valida → aplica reglas", "Decide si guarda el archivo"]);
  d.path("M708 445 H802", { color: C.blue });
  d.card(802, 542, 259, 76, "recibidos/", ["Solo permitido / alerta"], C.green);
  d.card(1090, 542, 260, 76, "eventos.jsonl", ["Decisiones analizadas"], C.amber);
  d.path("M930 495 V542", { color: C.green });
  d.path("M1210 495 V542", { color: C.amber });
  d.path("M1080 641 V692 H227 V600", { color: C.teal });
  d.text(655, 681, "Respuesta HTTP 200 (permitido / alerta) o 403 (bloqueado)", { anchor: "middle", size: 18, color: C.teal });
  d.text(72, 746, "Windows también puede usar el portal mediante http://localhost:3000", { size: 19, weight: 600 });
  d.text(72, 776, "Kali usa http://192.168.56.1:3000 · El análisis actual no consulta internet.", { size: 18, color: C.muted });
  d.footer("IP de Windows comprobada: 21/10/2026. La X de Kali es un marcador, no una dirección verificada.");
  return d;
}

function useCases() {
  const d = new Diagram(1440, 990, "02", "Casos de uso y actores", "Las funciones web y las tareas técnicas locales se muestran en límites separados.");
  d.frame(250, 160, 920, 460, "PORTAL DLP · INTERACCIÓN WEB");
  d.actor(104, 285, ["Participante", "de prueba"]);
  d.actor(1300, 285, ["Evaluador /", "auditor"]);
  d.path("M135 337 L305 270", { arrow: false });
  d.path("M135 337 L305 465", { arrow: false });
  d.path("M1269 337 L1100 270", { arrow: false });
  d.path("M1269 337 L1100 465", { arrow: false });
  d.oval(490, 270, 182, 65, ["CU-01 Transferir", "y ver decisión"]);
  d.oval(490, 465, 182, 65, ["CU-04 Descargar", "ejemplos ficticios"]);
  d.oval(935, 270, 174, 65, ["CU-02 Consultar", "políticas activas"]);
  d.oval(935, 465, 174, 65, ["CU-03 Revisar", "eventos recientes"]);
  d.text(278, 585, "CU-01 comprende validación, análisis, decisión, almacenamiento condicional y registro.", { size: 17, color: C.muted });
  d.text(250, 664, "Los actores son responsabilidades: el portal actual no implementa usuarios, login ni roles.", { size: 18, color: C.muted });
  d.frame(250, 730, 920, 185, "OPERACIÓN TÉCNICA LOCAL · TERMINAL Y CÓDIGO", C.blue);
  d.actor(104, 743, ["Operador", "técnico"]);
  d.actor(1300, 743, ["Evaluador"]);
  d.path("M135 795 H280", { arrow: false });
  d.path("M1269 795 H1135", { arrow: false });
  d.card(282, 782, 390, 98, "CU-05 Configurar políticas", ["Editar app.js, probar y reiniciar"], C.blue);
  d.card(735, 782, 400, 98, "CU-06 Evaluar el control", ["Pruebas y 20 casos ficticios"], C.blue);
  d.footer("Participante y evaluador pueden consultar las mismas pantallas. No hay separación de permisos en la aplicación actual.");
  return d;
}

function components() {
  const d = new Diagram(1440, 920, "03", "Arquitectura de componentes", "Una aplicación Node.js coordina el portal, el motor de reglas y los archivos de evidencia.");
  d.card(40, 275, 275, 180, "Navegador cliente", ["HTML + CSS", "public/app.js", "FormData + fetch", "Kali o Windows"], C.blue);
  d.frame(370, 155, 667, 637, "UN PROCESO NODE.JS EN WINDOWS");
  d.card(398, 208, 612, 85, "Recursos estáticos: public/", ["Portal, estilos, JavaScript y ejemplos ficticios"], C.blue);
  d.card(398, 340, 612, 95, "Express · API HTTP", ["/api/upload · /api/policies · /api/events · /api/health"]);
  d.path("M315 310 H350 V250 H398", { color: C.blue });
  d.path("M315 388 H398", { color: C.blue });
  d.text(343, 372, "API", { size: 15, anchor: "middle", color: C.blue });
  d.card(398, 490, 274, 115, "Recepción y validación", ["Multer: archivo en memoria", "Extensión, tamaño y UTF-8"]);
  d.card(735, 490, 275, 115, "analyzeContent", ["7 reglas · normalización CSV", "Suma de puntos → decisión"]);
  d.path("M535 435 V490");
  d.path("M672 548 H735");
  d.card(398, 661, 612, 88, "Aplicar la decisión y registrar", ["Guardar si corresponde → appendEvent → responder"]);
  d.path("M870 605 V661");
  d.card(1100, 445, 298, 120, "recibidos/", ["Archivos con UUID", "PERMITIDO y ALERTA"], C.green);
  d.card(1100, 660, 298, 120, "logs/eventos.jsonl", ["Metadatos y decisiones", "Consulta: últimos 50"], C.amber);
  d.path("M1010 692 H1063 V510 H1100", { color: C.green });
  d.path("M1010 722 H1100", { color: C.amber });
  d.text(1050, 845, "Sistema de archivos local", { size: 20, color: C.muted, anchor: "middle" });
  d.footer("No requiere base de datos. El motor actual usa patrones de texto; Groq y el análisis antivirus aún no forman parte del sistema.");
  return d;
}

function decisionFlow() {
  const d = new Diagram(1200, 1530, "04", "Flujo de procesamiento", "La política decide el almacenamiento después de recibir y analizar el contenido.");
  d.card(350, 152, 500, 80, "Carga del participante", ["POST /api/upload · campo archivo"], C.blue);
  d.path("M600 232 V278");
  d.card(350, 278, 500, 103, "Multer y decodificación", ["TXT / CSV / JSON · hasta 1 MiB", "Archivo en memoria · texto UTF-8"]);
  d.path("M600 381 V420");
  d.diamond(600, 485, 280, 130, ["¿Entrada válida", "para analizar?"]);
  d.path("M460 485 H305", { color: C.red });
  d.text(377, 470, "No", { color: C.red, size: 18 });
  d.card(40, 422, 265, 165, "ERROR", ["Ej.: extensión o tamaño", "HTTP 400 en esos casos", "No genera evento DLP", "No es bloqueo por política"], C.red);
  d.path("M600 550 V595");
  d.text(621, 579, "Sí", { color: C.teal, size: 18 });
  d.card(350, 595, 500, 95, "Preparar el texto", ["CSV: columnas → campos; TXT / JSON: texto"]);
  d.path("M600 690 V735");
  d.card(350, 735, 500, 95, "Evaluar las siete reglas", ["Cada regla aporta sus puntos una vez"]);
  d.path("M600 830 V865");
  d.diamond(600, 930, 260, 130, ["Puntaje", "total"]);
  d.path("M470 930 H200 V1040", { color: C.green });
  d.path("M600 995 V1040", { color: C.amber });
  d.path("M730 930 H1000 V1040", { color: C.red });
  d.text(200, 1005, "0 puntos", { anchor: "middle", color: C.green, size: 18 });
  d.text(620, 1023, "1–2 puntos", { color: C.amber, size: 18 });
  d.text(1000, 1005, "3 o más", { anchor: "middle", color: C.red, size: 18 });
  d.card(50, 1040, 300, 130, "PERMITIDO", ["Guardar en recibidos/", "HTTP 200"], C.green);
  d.card(450, 1040, 300, 130, "ALERTA", ["Guardar en recibidos/", "HTTP 200 · mostrar alerta"], C.amber);
  d.card(850, 1040, 300, 130, "BLOQUEADO", ["No guardar el archivo", "HTTP 403"], C.red);
  d.path("M200 1170 V1210 H600 V1245", { color: C.green });
  d.path("M600 1170 V1245", { color: C.amber });
  d.path("M1000 1170 V1210 H600 V1245", { color: C.red });
  d.card(350, 1245, 500, 85, "Registrar la decisión", ["Agregar metadatos a logs/eventos.jsonl"]);
  d.path("M600 1330 V1375");
  d.card(350, 1375, 500, 85, "Responder al cliente", ["Mostrar decisión, puntaje y reglas activadas"], C.blue);
  d.footer("Se asume procesamiento sin fallos internos. Archivo y auditoría son escrituras separadas; no hay transacción atómica.");
  return d;
}

function sequence() {
  const d = new Diagram(1440, 1100, "05", "Secuencia de una transferencia", "Orden real de la carga, la decisión, las escrituras y la actualización de la tabla del portal.");
  const xs = [195, 545, 895, 1245];
  const labels = [["Navegador", "Kali o Windows"], ["API Express", "app.js"], ["Motor de reglas", "analyzeContent"], ["Disco local", "recibidos/ y logs/"]];
  xs.forEach((x, i) => {
    d.card(x - 125, 160, 250, 82, labels[i][0], [labels[i][1]], i === 0 ? C.blue : C.teal);
    d.path(`M${x} 242 V1015`, { arrow: false, dashed: true, color: C.line });
  });
  const message = (from, to, y, label, color = C.ink, dashed = false) => {
    d.path(`M${from} ${y} H${to}`, { color, dashed });
    d.text((from + to) / 2, y - 12, label, { size: 17, anchor: "middle", color });
  };
  message(195, 545, 292, "1. POST /api/upload");
  d.path("M545 322 H592 V352 H545");
  d.text(608, 344, "2. Validar entrada y decodificar UTF-8", { size: 17 });
  message(545, 895, 395, "3. Analizar contenido y reglas");
  message(895, 545, 445, "4. Devolver puntaje y decisión", C.teal, true);
  d.rect(392, 476, 987, 168, { fill: "#f8fbfd", stroke: C.line });
  d.text(410, 502, "ALTERNATIVAS DE ALMACENAMIENTO", { size: 14, weight: 700, color: C.muted });
  message(545, 1245, 550, "5a. PERMITIDO / ALERTA → guardar archivo", C.green);
  d.path("M545 582 H591 V613 H545", { color: C.red });
  d.text(615, 603, "5b. BLOQUEADO → omitir escritura del archivo", { size: 17, color: C.red });
  message(545, 1245, 695, "6. Agregar evento a eventos.jsonl", C.amber);
  message(1245, 545, 739, "Escritura completada", C.muted, true);
  message(545, 195, 791, "7. HTTP 200 o 403 + resultado", C.blue, true);
  message(195, 545, 848, "8. GET /api/events", C.blue);
  message(545, 1245, 889, "9. Leer los eventos recientes");
  message(1245, 545, 933, "Hasta 50 eventos, más recientes primero", C.muted, true);
  message(545, 195, 980, "10. JSON → actualizar tabla", C.blue, true);
  d.footer("La secuencia muestra una carga válida y sin fallos internos. Los errores previos al análisis siguen un recorrido separado.");
  return d;
}

const diagrams = [
  { name: "01-arquitectura-red", build: network, detail: "Kali y Windows comparten la red Host-only. El participante carga archivos hacia el puerto TCP 3000 del servicio; el receptor inspecciona antes de guardar. La dirección exacta de Kali debe verificarse en su terminal." },
  { name: "02-casos-de-uso", build: useCases, detail: "Seis casos de uso: transferir y ver la decisión, consultar políticas, revisar eventos, descargar ejemplos, configurar reglas y evaluar el control. Los papeles son responsabilidades humanas; la aplicación actual no tiene login ni separación de permisos." },
  { name: "03-componentes", build: components, detail: "El navegador consume la API de una única aplicación Node.js. Multer recibe en memoria, el motor calcula la decisión y el servidor escribe archivos permitidos o en alerta, además de sus eventos de auditoría." },
  { name: "04-flujo-decision", build: decisionFlow, detail: "Con cero puntos se permite; con uno o dos se permite con alerta; con tres o más se bloquea el almacenamiento. Los errores de formato, tamaño o UTF-8 son distintos de una decisión de bloqueo por contenido." },
  { name: "05-secuencia", build: sequence, detail: "Primero se analiza, después se guarda el archivo cuando corresponde, se registra la decisión y se responde. El navegador solicita después los eventos recientes para refrescar la tabla." },
].map((item) => ({ ...item, diagram: item.build() }));

for (const item of diagrams) fs.writeFileSync(path.join(output, `${item.name}.svg`), item.diagram.render(), "utf8");

const caseRows = [
  ["CU-01", "Transferir un archivo y conocer la decisión", "Participante", "Portal o POST /api/upload"],
  ["CU-02", "Consultar políticas activas", "Participante / evaluador", "Portal · GET /api/policies"],
  ["CU-03", "Revisar eventos recientes", "Evaluador / participante", "Portal · GET /api/events"],
  ["CU-04", "Descargar ejemplos ficticios", "Participante", "Enlaces del portal"],
  ["CU-05", "Configurar y activar políticas", "Operador técnico", "Editar app.js, probar y reiniciar"],
  ["CU-06", "Evaluar el control", "Evaluador", "Terminal · npm test / npm run evaluate"],
];

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Laboratorio DLP · Arquitectura y casos de uso</title>
<style>
:root{font-family:Segoe UI,Arial,sans-serif;color:#142c43;background:#edf3f7;font-size:17px;line-height:1.65}*{box-sizing:border-box}body{margin:0}header,main,footer{max-width:1240px;margin:auto;padding:32px}header{padding-top:64px}h1{font-size:clamp(2.2rem,5vw,3.8rem);line-height:1.08;letter-spacing:-.04em;margin:16px 0}h2{font-size:1.65rem;line-height:1.25}p{max-width:1000px}a{color:#087f82}nav{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}nav a{border:1px solid #cddbe6;border-radius:8px;padding:8px 12px;text-decoration:none;background:#fff}.eyebrow{color:#087f82;letter-spacing:.14em;font-weight:700;font-size:.8rem}.intro{font-size:1.15rem;color:#51677b}.note{background:#e6f2f3;border-left:4px solid #087f82;padding:16px 22px;border-radius:6px}.section{background:#fff;margin-bottom:26px;padding:26px;border:1px solid #d9e3eb;border-radius:14px;break-inside:avoid}.graphic svg{width:100%;height:auto;display:block}.graphic{margin:16px -8px 0}table{width:100%;border-collapse:collapse;font-size:.94rem}th,td{padding:12px 10px;text-align:left;border-bottom:1px solid #dae3eb;vertical-align:top}th{background:#f2f7fa;color:#51677b}code{background:#edf3f7;padding:2px 5px;border-radius:4px}.wide{overflow:auto}.links{font-size:.88rem}footer{font-size:.9rem;color:#51677b}li{margin:10px 0}@media(max-width:650px){header,main,footer{padding:20px}.section{padding:16px}.graphic{overflow:auto}.graphic svg{min-width:820px}}@media print{:root{background:white;font-size:11pt}header,main,footer{padding:12px;max-width:none}header{padding-top:20px}nav,.links{display:none}.section{border:0;padding:0;margin:0 0 22px;break-before:page;border-radius:0}.graphic{margin:0}.graphic svg{max-height:225mm;min-width:0}h1{font-size:30pt}.note{background:#f2f7fa}a{color:inherit}footer{break-before:avoid}}
</style></head><body>
<header><span class="eyebrow">DOCUMENTACIÓN DEL PROYECTO · 21 OCT 2026</span>
<h1>Así funciona<br>el laboratorio DLP</h1>
<p class="intro">Casos de uso, arquitectura de red, componentes y recorrido completo de una transferencia. Esta guía representa la implementación actual, previa a integrar Groq.</p>
<p class="note">El archivo se recibe en memoria y se inspecciona antes de guardarlo. Un bloqueo evita su almacenamiento en <code>recibidos/</code>. El alcance del control es el portal de carga.</p>
<nav>${diagrams.map((item, i) => `<a href="#${item.name}">${i + 1}. ${escape(item.diagram.title)}</a>`).join("")}<a href="#casos">Fichas de casos</a></nav></header>
<main>${diagrams.map((item) => `<section class="section" id="${item.name}"><h2>${escape(item.diagram.title)}</h2><p>${escape(item.detail)}</p><div class="graphic">${item.diagram.render().replace(/id="([^"]+)"/g, `id="${item.name}-$1"`).replace(/url\(#([^)]+)\)/g, `url(#${item.name}-$1)`).replace('aria-labelledby="title desc"', `aria-labelledby="${item.name}-title ${item.name}-desc"`)}</div><p class="links"><a href="diagramas/${item.name}.svg">Abrir gráfico SVG independiente</a></p></section>`).join("")}
<section class="section" id="casos"><h2>Los seis casos de uso</h2><div class="wide"><table><thead><tr><th>ID</th><th>Objetivo</th><th>Actor</th><th>Interacción</th></tr></thead><tbody>${caseRows.map((row) => `<tr>${row.map((v) => `<td>${escape(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div><p>Las precondiciones, el flujo principal y las alternativas están desarrollados en <a href="ARQUITECTURA_Y_CASOS_DE_USO.md">el documento de casos de uso y arquitectura</a>.</p></section>
<section class="section"><h2>Cómo explicarlo en una demostración</h2><ol><li>Windows ejecuta el servicio y Kali abre el portal a través de la red Host-only.</li><li>Se selecciona un archivo ficticio TXT, CSV o JSON y se pulsa «Analizar y transferir».</li><li>El servidor valida la carga y aplica siete reglas, que aportan puntos una vez cada una.</li><li>Con 0 puntos permite; con 1–2 permite con alerta; con 3 o más bloquea el almacenamiento.</li><li>Se contrasta el resultado con los eventos, la carpeta de recibidos y la clasificación de referencia.</li></ol><p>Una alerta detecta pero permite guardar. Un archivo con datos sensibles puede pasar si las reglas no reconocen su forma de escritura; un ejemplo didáctico puede activar una regla indebidamente. Por eso se evalúan falsos positivos y negativos.</p></section>
<section class="section"><h2>Qué está implementado y qué viene después</h2><p>La versión actual usa patrones, archivos locales y HTTP. Admite texto UTF-8 de hasta 1 MiB; no dispone de autenticación, cuarentena, análisis antivirus ni lectura PDF/Office. Groq es una ampliación futura para evaluar contexto.</p><p>La dirección de Windows <code>192.168.56.1</code> se comprobó con <code>ipconfig</code>. La IP exacta de Kali, el estado de la VM y el firewall no se verificaron en esta revisión. El proceso escucha por defecto en <code>0.0.0.0:3000</code>, es decir, en todas sus interfaces IPv4.</p><p>Las cargas inválidas antes del análisis no generan evento DLP. Las escrituras de archivo y auditoría son separadas: si falla la segunda, puede existir un archivo guardado aunque la respuesta sea de error.</p></section>
</main><footer>Fuente: implementación del repositorio · Datos de prueba ficticios · Diagramas editables generados con Node.js, sin dependencias adicionales.</footer></body></html>`;
fs.writeFileSync(path.join(__dirname, "guia-visual.html"), html, "utf8");
console.log(`Generados ${diagrams.length} diagramas SVG y docs/guia-visual.html.`);
