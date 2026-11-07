# Modo estricto de red para WIN-01 y LIN-01

Perfil de prueba acordado: **solo receptor del laboratorio**. PC servidor 192.168.56.1; VM Windows 192.168.56.101; VM Kali 192.168.56.102. No aplicar el perfil de cliente al servidor físico.

## Comportamiento y alcance

Cada agente ofrece un relay explícito en 127.0.0.1:3002. Inyecta su credencial individual únicamente hacia el proxy estricto del servidor en 8081. El navegador no necesita otra clave ni extensión para esta transferencia. La CA pública del proxy permite inspeccionar TLS. La clave Groq permanece en el central.

Este perfil utiliza HTTP para autenticar el CONNECT entre VM y proxy, y entre conectores y central. Las credenciales de esos tramos no están cifradas; es una concesión del laboratorio aislado con datos ficticios. La inspección HTTPS del archivo no convierte esos tramos en transporte apto para una red empresarial compartida.

El firewall de la VM deniega salidas alternativas en todas sus interfaces: NAT, host-only e IPv6. Se conservan loopback, DHCP limitado y las conexiones necesarias al central/proxy. Windows autoriza esos puertos solo al ejecutable Node instalado en Program Files. Linux autoriza el UID del agente, también restringido a esos puertos; bloquea reenvío para que Docker/puentes no sean una salida alternativa. Un proxy anterior en 8080 y SMTP 2525 no quedan autorizados en este perfil.

El listener 8081 exige identidad individual válida, impide túneles TCP/UDP sin inspección y solo admite HTTPS a sink.dlp.test:4201, rutas / y /upload, sin consultas arbitrarias. El addon rechaza cualquier otro destino y cualquier túnel TCP/UDP no HTTP; la red de publicación del contenedor por sí sola no aplica esa restricción. Retiene el cuerpo completo y consulta al motor antes de reenviarlo. En este canal aplica enforce aunque la política general estuviera en auditoría. Credenciales compartidas no abren este listener; una revocación impide nuevas inspecciones/túneles.

| Prueba | Resultado esperado | Motivo |
|---|---|---|
| Documento público al receptor | Permitido y recibido | Clasificación completa compatible con la política |
| Archivo sensible al receptor | Bloqueado, sin bytes en el receptor | Reglas o clasificación semántica |
| TXT vacío válido | Permitido | No requiere LLM |
| Archivo opaco, cifrado, parcial o formato no admitido | Retenido | No inspeccionable; no se afirma que se reconoció sensibilidad |
| WhatsApp, Discord, nube, IA, conversor o web externos | Sin conexión/sin transferencia | Destino/canal completo no autorizado, incluso para datos públicos |
| SSH/SCP, FTP, SMTP directo, DNS externo, QUIC y salida IPv6 | Restringidos | No pasan por el único canal autorizado |

**No es un DLP universal del kernel.** No añade bloqueo selectivo de lecturas/copias locales, USB, pantalla, impresión de otras aplicaciones, canales físicos o todo canal encubierto. La observación de procesos no prueba qué archivos leyó una aplicación. Un administrador local puede quitar las políticas. Las VM deben usarse con una cuenta de trabajo estándar; la elevación se utiliza solo para activar/restaurar controles. Las aplicaciones con cifrado extremo a extremo quedan restringidas como canal, no clasificadas por documento. Este laboratorio no acredita uso empresarial en producción.

## 1. Preparar el servidor físico

Desde la carpeta del proyecto, `npm.cmd run wsl:sync` despliega el central, receiver y nuevo strict-proxy. Conserva el servidor en funcionamiento. Si ya tienes npm start ejecutándose, no abras otro agente; basta sincronizar el backend. La CA sigue en datos-control/certs-public/mitmproxy-ca-cert.pem y en la carpeta compartida DLPCliente del laboratorio. Solo se comparte el certificado público.

Publica exclusivamente 8081 hacia las dos VM, en **PowerShell como administrador del servidor**:

```powershell
cd 'C:\Users\ADMIN\Documents\Topico de Ciberseguridad\proyecto-dlp'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/wsl/Publish-Strict-Lab.ps1 -Action Plan
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/wsl/Publish-Strict-Lab.ps1 -Action Apply
```

El publicador crea una regla de entrada propia limitada a .101/.102 y un portproxy de .56.1:8081 a localhost:8081. No cambia la política de salida del servidor. Se niega a sobrescribir un mapeo ajeno. Para retirar esa publicación utiliza el mismo script con -Action Restore, después de restaurar las VM.

Comprueba desde cada VM que 192.168.56.1:3100 y :8081 son accesibles **antes** de aplicar su firewall. No cambies sus IP durante esta prueba. Los dos adaptadores pueden permanecer: las reglas se aplican a ambos. Mantén acceso a la consola de VirtualBox para restaurar localmente aunque no haya red.

## 2. Preparar Windows VM (sesión LABWIN, terminal normal)

Primero actualiza e importa la CA pública desde la carpeta compartida que ya utiliza el laboratorio:

```powershell
cd 'C:\Users\LABWIN\DLP-Cliente'
git pull --ff-only
npm.cmd run strict:prepare -- --ca '\\VBOXSVR\DLPCliente\mitmproxy-ca-cert.pem'
npm.cmd run client:install
npm.cmd run client:status
npm.cmd run strict:plan
```

La preparación copia la CA pública al estado privado del agente y habilita su relay. No aplica firewall. Conserva identidad, tokens y las otras variables de .env. No consume otra invitación. Discover debe encontrar Node y al menos un navegador en Program Files; un navegador instalado en AppData no se autoriza. Cierra los navegadores y aplicaciones de red antes del paso siguiente.

En **PowerShell como administrador de esa VM**, desde la misma carpeta:

```powershell
cd 'C:\Users\LABWIN\DLP-Cliente'
npm.cmd run strict:apply
npm.cmd run strict:audit
```

El script verifica que es una VM y que la política corresponde a su hostname. Conserva las reglas/perfiles, valores de políticas y CA anteriores en %ProgramData%\DLP-Laboratorio\Protection. No retira perfiles activos anteriores silenciosamente: si existe uno, restaura ese perfil primero y revisa su estado. La aplicación falla si el central, proxy o relay no son accesibles. Configurar no equivale a probar tráfico.

## 3. Preparar Kali VM (usuario kali)

Instala las dependencias de sistema **antes** de cerrar su salida. Para acceder a la carpeta compartida, si aún no está montada, utiliza el montaje indicado; no copies el .env del servidor:

```bash
cd ~/DLP-Cliente
git pull --ff-only
sudo apt-get update
sudo apt-get install -y nftables ca-certificates
sudo mkdir -p /mnt/dlp-cliente
mountpoint -q /mnt/dlp-cliente || sudo mount -t vboxsf -o ro DLPCliente /mnt/dlp-cliente
sudo install -m 600 -o "$(id -u)" -g "$(id -g)" /mnt/dlp-cliente/mitmproxy-ca-cert.pem "$HOME/dlp-proxy-ca.pem"
npm run strict:prepare -- --ca "$HOME/dlp-proxy-ca.pem"
npm run client:install
npm run client:status
npm run strict:plan
```

Cierra los navegadores y aplicaciones de red. Activa dentro de Kali:

```bash
sudo npm run strict:apply
sudo npm run strict:audit
```

La activación verifica VM, hostname y UID de la política, conexión a los tres componentes y sintaxis nft. Crea solo la tabla inet dlp_strict_lab; no vacía las tablas anteriores. Conserva respaldos en /var/lib/dlp-strict-lab, restringido a root. Instala la CA, políticas Chrome/Chromium/Firefox y una unidad de arranque dlp-strict-lab.service. Las otras reglas del sistema pueden restringir todavía más el tráfico. No se configura ningún DNS externo: el proxy resuelve el nombre del receptor.

## 4. Probar sin extensión y comprobar desde la PC

Abre en cada VM un navegador reiniciado en **https://sink.dlp.test:4201/**. Debe mostrar Transferencia controlada. Si el certificado falla, revisa la CA y las políticas del navegador; no desactives la validación TLS. El nombre se resuelve en el proxy, no requiere editar hosts en el cliente.

Desde una terminal normal de cada VM, ejecuta:

```text
npm run strict:verify
```

En Windows utiliza `npm.cmd run strict:verify`. El comando comprueba que los canales antiguos 8080/2525 no son accesibles, que 3100/8081 sí lo son y ejecuta cargas ficticias públicas, sensibles, vacías y opacas por TLS con CA validada. Guarda datos-endpoint/strict-verification.json. El público usa Groq si el central está en híbrido; las reglas pueden bloquear el sensible antes de consultar al LLM. Un error de motor retiene la transferencia y hace fallar la comprobación.

En la PC, abre http://127.0.0.1:3100 y selecciona Ver actividad en WIN-01 o LIN-01. Las decisiones y recibos del proxy corresponden a la credencial individual de esa VM. Relay activo solo acredita el listener local; contrástalo con strict:audit y strict:verify. Los rechazos de destino del relay se marcan como reportes del agente. Un firewall que descarta un paquete no necesariamente genera un evento DLP por archivo ni conoce su sensibilidad.

Comprueba también que WhatsApp/Discord y otro navegador sin extensión no tienen una salida directa, incluso con contenido público. Eso demuestra restricción del canal, no clasificación del archivo de esas aplicaciones. Reinicia cada VM, inicia sesión y repite auditoría y prueba para comprobar persistencia y arranque del agente. El contador de llamadas Groq se reinicia al reiniciar el central; los resultados semánticos históricos permanecen en auditoría.

Para evidencia independiente del receptor, en el servidor puedes consultar las recepciones de laboratorio dentro de WSL:

```powershell
wsl.exe -d DLP-Control-WSL -u root --cd /root/dlp --exec docker compose --env-file .env -f deploy/compose.yaml exec -T receiver tail -n 20 /receipts/recepciones.jsonl
```

El archivo registra bytes y SHA-256 de lo que efectivamente llegó. Compara antes/después de cada prueba. La ausencia de un hash sensible, junto con el recibo CANCELLED y la petición bloqueada, es más sólida que una etiqueta de interfaz.

## 5. Desactivar y volver a usar las VM con normalidad

En Windows VM, PowerShell como administrador:

```powershell
cd 'C:\Users\LABWIN\DLP-Cliente'
npm.cmd run strict:restore
```

En Kali:

```bash
cd ~/DLP-Cliente
sudo npm run strict:restore
```

Si moviste el proyecto de Kali, el restaurador independiente se conserva en root:

```bash
sudo python3 /var/lib/dlp-strict-lab/restore.py restore
```

Reinicia los navegadores. Restore retira solo el perfil propio y restaura los valores anteriores; no elimina identidades ni desinstala el agente. Una modificación externa produce aviso/restauración parcial para evitar sobrescribirla. El relay puede seguir escuchando localmente; sin proxy obligatorio ni firewall estricto no controla las salidas normales. Para retirar también el agente usa client:uninstall por separado.

Para reactivar el mismo perfil: cierra navegadores y ejecuta strict:apply con elevación y strict:audit. Para actualizar desde GitHub, restaura primero: el modo acordado impide acceder a GitHub y otros destinos. No borres respaldos mientras el perfil esté aplicado. No uses comandos para desactivar globalmente el firewall ni vaciar nftables.

## Pruebas implementadas y pendientes

- La regresión Node comprueba preparación sin firewall y cierre del relay ante fallo.
- evaluacion/strict-e2e.js usa un central temporal, relay Node, TLS/mitmproxy reales y receptor independiente. Comprueba público, sensible, vacío, fragmentos, WebSocket, rutas/consultas, ausencia de credenciales compartidas y revocación. No utiliza Groq real ni instala firewall en las VM.
- evaluacion/test-strict-nft.py comprueba reglas de kernel reales entre dos namespaces temporales: conectores permitidos, canales alternativos e IPv6 bloqueados, aislamiento de UID y retirada de la tabla. No modifica tablas de la red anfitriona ni acredita instalación/persistencia en Kali.
- Windows valida sintaxis y las pruebas previas de tareas; la aplicación efectiva y restauración del firewall se deben verificar en WIN-01. No se aplicó el perfil de VM a la PC física.

Fuentes técnicas: [Windows Firewall](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/configure-with-command-line), [nftables](https://netfilter.org/projects/nftables/manpage.html), [hooks mitmproxy](https://docs.mitmproxy.org/stable/api/events.html). Las pruebas y límites anteriores corresponden al código de este proyecto.
