"use strict";
// Fuentes vectoriales de las figuras de la arquitectura administrada.
// node docs/generar-diagramas-v3.js
const fs = require('node:fs');
const path = require('node:path');
const out = path.join(__dirname, 'diagramas', 'v3');
fs.mkdirSync(out, { recursive: true });
const C = { ink:'#162d43', muted:'#53697b', teal:'#087f83', blue:'#2864ad', amber:'#986208', red:'#ae3550', green:'#167958', line:'#cbd8e3', bg:'#f4f7fa', white:'#ffffff' };
const esc = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
class Fig {
  constructor(w,h,title,sub,n) {
    this.w=w; this.h=h;
    this.a=[`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"><title>${esc(title)}</title><desc>${esc(sub)}</desc><defs>${Object.entries(C).map(([k,v])=>`<marker id="${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10Z" fill="${v}"/></marker>`).join('')}</defs><style>text{font-family:'Segoe UI',Arial,sans-serif}</style>`];
    this.box(0,0,w,h,C.white,C.white,0);
    this.text(64,53,`DLP ADMINISTRADO  /  FIGURA ${n}`,23,C.teal,700);
    this.text(64,112,title,47,C.ink,700);
    this.text(64,159,sub,25,C.muted);
    this.line('M64 191H'+(w-64),C.line,false);
  }
  text(x,y,s,size=25,color=C.ink,weight=400) {this.a.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}">${esc(s)}</text>`);}
  lines(x,y,rows,size=24,color=C.muted,step=34,weight=400){rows.forEach((s,i)=>this.text(x,y+i*step,s,size,color,weight));}
  box(x,y,w,h,fill=C.white,stroke=C.line,r=16){this.a.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`);}
  line(d,c=C.teal,arrow=true,dash=false){const key=Object.keys(C).find(k=>C[k]===c)||'ink';this.a.push(`<path d="${d}" fill="none" stroke="${c}" stroke-width="3" stroke-linejoin="round"${dash?' stroke-dasharray="10 8"':''}${arrow?` marker-end="url(#${key})"`:''}/>`);}
  label(x,y,s,c=C.teal){this.text(x,y,s,22,c,600);}
  card(x,y,w,h,title,rows,c=C.teal){this.box(x,y,w,h,C.white,c);this.text(x+24,y+38,title,27,c,700);this.lines(x+24,y+77,rows,24,C.muted,33);}
  case(x,y,w,id,title,rows,c=C.teal){this.box(x,y,w,140,C.white,C.line,12);this.text(x+20,y+31,id,21,c,700);this.text(x+20,y+67,title,26,C.ink,650);this.lines(x+20,y+100,rows,22,C.muted,29);}
  footer(rows){this.line(`M64 ${this.h-114}H${this.w-64}`,C.line,false);this.lines(64,this.h-76,rows,22,C.muted,31);}
  save(name){fs.writeFileSync(path.join(out,name+'.svg'),this.a.join('\n')+'\n</svg>\n');}
}

function useCases(){
  const d=new Fig(2400,1950,'Casos de uso y funcionamiento del DLP','Los 12 escenarios se relacionan con su punto de control, la decisión y la evidencia final.','01');
  const xs=[64,650,1236,1822], w=514;
  d.card(64,223,720,113,'Usuario del laboratorio',['Realiza acciones con documentos y datos ficticios.'],C.blue);
  d.card(840,223,720,113,'Administrador',['Configura destinos, modos, reglas y conectores.'],C.teal);
  d.card(1616,223,720,113,'Evaluador',['Define etiquetas reales y contrasta FP / FN.'],C.amber);
  ['EQUIPO Y ARCHIVOS','CORREO ELECTRÓNICO','WEB Y NUBE','PROTOCOLOS DE RED'].forEach((s,i)=>{
    d.box(xs[i],383,w,636,C.bg,C.line);
    d.text(xs[i]+23,425,s,25,i===3?C.blue:C.teal,700);
  });
  d.case(xs[0]+18,454,w-36,'CU-01','Copia a USB',['Agente: copia mediada por el motor.','USB nativo: política del canal.']);
  d.case(xs[0]+18,616,w-36,'CU-02','Copia a ruta no autorizada',['Agente: correlación por hash.','Samba full_audit: lectura de origen.']);
  d.box(xs[0]+18,778,w-36,140,'#fff9ed','#dec98c');
  d.lines(xs[0]+38,812,['La copia nativa se observa después','de escribirse. USB físico y políticas','del Windows destino requieren','validación en ese equipo.'],22,C.amber,29);
  d.label(xs[0]+23,966,'Agente Node.js + sensor PowerShell');
  d.text(xs[0]+23,997,'Mediado ≠ toda operación nativa',22,C.muted);
  d.case(xs[1]+18,454,w-36,'CU-03','Adjunto sensible',['XLSX con DNI / tarjetas ficticias.','Postfix → filtro Python de MIME.']);
  d.case(xs[1]+18,616,w-36,'CU-04','Datos en cuerpo o asunto',['Texto, base64 y quoted-printable.','El filtro consulta al motor central.']);
  d.box(xs[1]+18,778,w-36,140,'#eef8f5','#95c7b8');
  d.lines(xs[1]+38,812,['Se analiza antes del relevo SMTP.','250: aceptado · 550: rechazado.','451: fallo temporal del motor.','Se comprueba el buzón receptor.'],22,C.green,29);
  d.label(xs[1]+23,966,'Postfix + filtro MIME antes de cola');
  d.text(xs[1]+23,997,'Cuerpo y adjuntos → inspección',22,C.muted);
  d.case(xs[2]+18,454,w-36,'CU-05','Subida web por HTTPS',['Archivo hacia un destino de prueba.','mitmproxy retiene antes de reenviar.']);
  d.case(xs[2]+18,616,w-36,'CU-06','Texto en un sitio público',['Formulario, pegado o parámetros.','Proxy + extensión para flujos cubiertos.']);
  d.case(xs[2]+18,778,w-36,'CU-07','Sincronización con rclone',['WebDAV real por el proxy HTTPS.','Otros backends: validar por separado.']);
  d.label(xs[2]+23,966,'mitmproxy + certificado de laboratorio');
  d.text(xs[2]+23,997,'Firewall obligatorio para evitar bypass',22,C.muted);
  d.case(xs[3]+18,454,w-36,'CU-08','SFTP / SCP sobre SSH',['Firewall: restricción del canal.','El contenido SSH no se descifra.'],C.blue);
  d.case(xs[3]+18,616,w-36,'CU-09','FTP en claro',['Suricata IDS → firma → Wazuh.','Detectar no equivale a bloquear.'],C.blue);
  d.case(xs[3]+18,778,w-36,'CU-10','Canal o túnel DNS',['DNS guard + dnsmasq + firewall.','Reglas de dominio, tipo y frecuencia.'],C.blue);
  d.label(xs[3]+23,966,'Control del canal y telemetría');
  d.text(xs[3]+23,997,'Sin clasificación del contenido cifrado',22,C.muted);
  [321,907,1493].forEach(x=>d.line(`M${x} 1019V1062`));
  d.line('M2079 1019V1079',C.blue);
  d.box(64,1079,1686,463,'#f3faf9',C.teal);
  d.text(89,1121,'MOTOR CENTRAL · CONTENIDO QUE SÍ LLEGA A INSPECCIÓN',27,C.teal,700);
  d.card(89,1152,783,120,'CU-11 · Archivo cifrado',['ZIP / 7z / GPG no inspeccionable → retener en enforce.'],C.amber);
  d.card(907,1152,817,120,'CU-12 · Evasión por formato',['Firma real, base64 limitado; fragmento incompleto → retener.'],C.amber);
  d.card(89,1311,482,166,'1 · Extraer y analizar',['TXT, Office, PDF compatibles.','Aplicar reglas y límites.','Sin OCR ni descifrado.']);
  d.card(654,1311,505,166,'2 · Clasificación híbrida',['Groq si corresponde.','Nunca rebaja reglas fuertes.','Fallo o duda → pendiente.']);
  d.card(1242,1311,482,166,'3 · Política del canal',['Modo audit / alert / enforce.','Destino y umbrales.','Decisión + ticket.']);
  d.line('M571 1394H654'); d.line('M1159 1394H1242');
  d.text(89,1518,'Groq recibe texto extraído para clasificar; no ejecuta ni analiza malware en la PC.',23,C.muted);
  d.card(1822,1079,514,463,'RED / OBSERVACIÓN',[
    'SSH: permitir o negar el canal.','FTP: firma IDS y alerta.','DNS: permitir / rechazar consulta.','','Copias nativas y procesos:','registrar actividad observada.','','Los metadatos llegan a auditoría.','No prueban por sí solos una fuga.'],C.blue);
  d.line('M1483 1542V1590H322V1621');
  d.label(90,1579,'Conector: ejecutar la decisión y confirmar el resultado');
  d.box(64,1621,1686,137,C.white,C.line);
  const states=[['PERMITIDO','Se libera la operación.',C.green],['DETECTADO','Actividad observada.',C.blue],['ALERTA','Se avisa; puede liberarse.',C.amber],['BLOQUEADO','Se cancela / retiene.',C.red]];
  states.forEach(([a,b,c],i)=>{let x=88+i*414;d.text(x,1667,a,26,c,700);d.text(x,1710,b,22,C.muted);});
  d.line('M2079 1542V1621',C.blue);
  d.card(1822,1621,514,137,'AUDITORÍA Y EVALUACIÓN',['Recibos + hashes del receptor.','Wazuh · precisión, recall, FP / FN.'],C.blue);
  d.line('M1750 1688H1822',C.blue);
  d.footer(['Lectura: casos → conectores → inspección o control de canal → efecto comprobado → auditoría.',
    'Alcance: laboratorio controlado. La cobertura depende de conectores, permisos y políticas de salida activadas.']);
  d.save('01-casos-de-uso-dlp-v3');
}

function network(){
  const d=new Fig(2600,2260,'Arquitectura de red del proyecto','Despliegue del laboratorio: Windows + WSL2 / Docker; separación de datos, control y observación.','02');
  d.box(64,339,2472,1528,C.bg,C.line,22);
  d.text(89,323,'EQUIPO FÍSICO DEL LABORATORIO',26,C.ink,700);
  d.box(89,359,565,1440,C.white,C.blue);
  d.text(114,404,'WINDOWS · EQUIPO PROTEGIDO',26,C.blue,700);
  d.card(114,455,515,216,'Navegador y aplicaciones',['Chrome / Edge o Firefox.','Extensión → agente local.','Token del navegador (no Groq).','Navegación: solo origen del sitio.'],C.blue);
  d.card(114,730,515,216,'Agente local · Node.js',['127.0.0.1:3001 · panel endpoint.','Carpetas, copias mediadas, eventos.','Actividad en vivo y recibos.','Credencial de extensión separada.'],C.teal);
  d.line('M371 671V730',C.blue);d.label(392,709,'loopback');
  d.card(114,1006,515,216,'Sensores del equipo',['PowerShell: procesos observados.','Portapapeles / impresión: cobertura','según configuración y permisos.','Sysmon + Wazuh: opcionales.'],C.blue);
  d.line('M371 1006V946',C.blue,true,true);
  d.card(114,1282,515,249,'Salida administrada',['Proxy HTTPS + CA confiable.','Firewall limita salida directa.','SMTP y DNS autorizados.','','En el anfitrión: aplicar políticas','solo tras revisar el plan.'],C.amber);
  d.box(114,1593,515,156,'#fff9ed','#dec98c');
  d.lines(138,1630,['USB nativo: política del canal.','Copia nativa: alerta posterior.','No hay driver universal de archivos.','USB físico: prueba pendiente.'],23,C.amber,32);
  d.box(710,359,1798,1440,'#fbfdfd',C.teal);
  d.text(737,404,'DLP-Control-WSL · WSL2 / LINUX / DOCKER',28,C.teal,700);
  d.text(737,440,'Red interna Docker: 172.30.50.0/24 · red de administración adicional · salida externa selectiva',24,C.muted);
  d.box(737,478,1742,191,'#eaf5f4',C.teal);
  d.text(763,517,'CONTROL CENTRAL  ·  172.30.50.10:3100',28,C.teal,700);
  d.lines(763,557,['Consola / políticas → firma real y extracción → reglas → Groq cuando corresponde → decisión y ticket.',
    'Roles separados: ADMIN / INSPECT / TELEMETRY. Auditoría encadenada y recibos de ejecución.',
    'La clave Groq permanece en el servidor; no se coloca en la extensión del navegador.'],24,C.muted,35);
  d.line('M629 811H685V572H737',C.teal);
  d.label(659,703,'API');
  const xs=[737,1331,1925], bw=554;
  d.card(xs[0],741,bw,194,'HTTPS · mitmproxy',['172.30.50.11:8080','Retiene carga y consulta al motor.','CU-05 / 06 / 07 · CA requerida.','No reenvía lo denegado.']);
  d.card(xs[1],741,bw,194,'SMTP · Postfix + filtro MIME',['Postfix 172.30.50.12:25','Filtro 172.30.50.13:2525','CU-03 / 04 · inspección antes','del relevo al receptor.']);
  d.card(xs[2],741,bw,194,'DNS guard + dnsmasq',['Guard 172.30.50.53:53/UDP','dnsmasq 172.30.50.54:5353','CU-10 · dominios, tipos, tamaño','y frecuencia de consultas.'],C.blue);
  d.line('M1240 741V669');d.line('M1845 741V669');
  d.line('M629 1370H682V838H737',C.blue);
  d.label(743,712,'HTTPS / SMTP: consulta al motor');
  d.label(1945,712,'DNS: política del canal');
  d.card(xs[0],1007,bw,167,'Receptor de laboratorio',['172.30.50.20','HTTPS / WebDAV :4201','SMTP :2526 · recibos y hashes.'],C.green);
  d.line('M1014 935V1007',C.green);d.label(1035,978,'solo permitido');
  d.line('M1608 935V978H1306V1090H1291',C.green);
  d.card(xs[1],1007,bw,167,'Samba · Finanzas',['172.30.50.21:445','CU-02 · registro full_audit.','Acredita lectura, no copia final.'],C.blue);
  d.card(xs[2],1007,bw,167,'FTP y SSH de prueba',['FTP 172.30.50.22:21 · CU-09','SSH 172.30.50.23:22 · CU-08','Cifrados: restricción del canal.'],C.blue);
  d.card(xs[0],1250,bw,190,'Cliente aislado de pruebas',['172.30.50.30 · iptables','Solo proxy, SMTP y DNS autorizados.','SSH / FTP: excepciones explícitas.','Control negativo: probar bypass.'],C.blue);
  d.line('M1014 1250V1237H725V900H737',C.blue);
  d.label(739,1220,'Destinos ficticios: evidencia independiente');
  d.card(xs[1],1250,bw,190,'Suricata · IDS pasivo',['Observa la interfaz del cliente.','eve.json: firmas sobre FTP / DNS.','Detecta y alerta; no es un IPS.','Comparte la red del cliente.'],C.amber);
  d.line('M1291 1345H1331',C.amber,false,true);
  d.card(xs[2],1250,bw,190,'Wazuh manager',['Correlación de registros y alertas.','Entradas: SIEM, DNS, Samba, IDS.','1514: agentes · 1515: enrolamiento.','Sin dashboard de indexador.'],C.blue);
  d.line('M1885 1345H1925',C.amber,true,true);
  d.box(737,1516,1742,219,'#f1f5fa',C.blue);
  d.text(763,1558,'EVIDENCIA Y RETORNO DE ALERTAS',27,C.blue,700);
  d.lines(763,1599,['Auditoría completa → siem.jsonl → Wazuh → alerts.json → forwarder → control central.',
    'Los conectores confirman liberación, cancelación o fallo; el receptor verifica bytes / hash.',
    'Los paneles distinguen: decisión, efecto de la operación, navegación observada y alertas de sensores.',
    'CU-01 / 02 se originan en el endpoint; CU-11 / 12 se aplican dentro del motor al contenido recibido.'],24,C.muted,36);
  d.line('M2202 1440V1516',C.blue,true,true);
  d.line('M1608 1516V1478H708V647H737',C.blue,true,true);
  d.text(114,1838,'127.0.0.1 en Windows usa los puertos publicados por WSL; las IP 172.30.50.x pertenecen a los contenedores.',24,C.muted);
  d.card(1700,211,808,104,'GROQ · SERVICIO EXTERNO',['HTTPS 443 · texto extraído · API key solo en servidor.'],C.amber);
  d.line('M2110 478V334H2110V315',C.amber);
  d.label(2134,343,'clasificación semántica');
  d.box(64,1917,2472,172,C.white,C.line);
  d.text(89,1958,'ACCESO DESDE WINDOWS',26,C.ink,700);
  d.lines(89,1998,['3001  agente local   |   3100  control central   |   8080  proxy   |   2525 → 25  SMTP',
    '5300/UDP → 53  DNS de prueba   |   1445 → 445  SMB de prueba   |   1514 / 1515  Wazuh'],25,C.muted,39);
  d.footer(['Leyenda: línea continua = solicitud / control; discontinua = observación o retorno de alertas. IP de Wazuh: dinámica.',
    'VirtualBox se conserva como alternativa apagada. Kali u otro equipo necesitan una red privada y acceso explícito; localhost es su propio equipo.']);
  d.save('02-red-dlp-v3');
}
useCases();network();
console.log('Generadas 2 fuentes SVG actuales en docs/diagramas/v3.');
