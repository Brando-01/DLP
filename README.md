# DLP administrado - versión 3

Agente Windows, consola central, proxy HTTPS, filtro SMTP, resolver DNS y correlación con Wazuh. Clasifica información sensible mediante reglas y contexto semántico de Groq. Evalúa permitido, detectado, alerta y bloqueado, además de falsos positivos y negativos. Usa exclusivamente datos ficticios y destinos del laboratorio. Inspecciona sensibilidad; no demuestra ausencia de malware.

**Empieza por la [guía completa de instalación, navegadores y tokens](docs/INSTALACION_Y_NAVEGADORES.md).** Incluye primera instalación, Chrome/Brave/Edge, Firefox, qué token pegar, proxy/CA, acceso a WSL, arranque diario y solución de errores.

Solo aportas tu **GROQ_API_KEY** en el .env privado. `npm.cmd run setup` genera las otras credenciales, incluso si copiaste .env.example con sus campos automáticos vacíos. El token de la extensión se copia desde **3001 > Navegador**; el token ADMIN de .env se utiliza únicamente en la consola **3100**.

**Aplicaciones nativas, conversores web e inventario Groq:** consulta [Protección de aplicaciones y salidas](docs/PROTECCION_APLICACIONES_Y_SALIDAS.md). Incluye restricciones por EXE para WhatsApp/Discord, destinos de subida autorizados, perfil de salida por aplicación para Chrome/Edge/Firefox y restauración. Los scripts empiezan en Plan; no se activan al instalar. La restricción de un cliente nativo bloquea su red completa, no solo adjuntos sensibles. La exclusividad de salida necesita un endpoint aislado y gateway separado; no está acreditada en el Windows principal con servicios localhost.

## Arranque en esta computadora

Los servicios están preparados en una distribución propia **DLP-Control-WSL**. El agente corre en Windows. No se aplicaron políticas generales al anfitrión. La VM VirtualBox DLP-Control-v3 se conserva apagada como alternativa; el despliegue final se verifica en WSL2.

```powershell
npm.cmd run setup
npm.cmd run wsl:start
npm.cmd run wsl:sync
npm.cmd run wsl:ca
npm.cmd run agent
```

`wsl:sync` copia código/configuración y construye los servicios dentro de Linux. El primer despliegue tarda varios minutos. Después, sin cambios de código o clave, basta `wsl:start` y `agent`. El lanzador mantiene activa exclusivamente su distribución con un proceso auxiliar oculto; `deploy/wsl/Lab-WSL.ps1 -Action Stop` la detiene. Mantén abierta la terminal del agente.

- Agente: http://127.0.0.1:3001
- Consola: http://127.0.0.1:3100. Accede con **DLP_CONTROL_ADMIN_TOKEN** del `.env` local, distinto de la clave Groq.
- Proxy: 127.0.0.1:8080. SMTP: 127.0.0.1:2525.
- CA pública del proxy: `datos-control/certs-public/mitmproxy-ca-cert.pem`.

El inventario utiliza reglas y, con inventorySemantic activo y modo hybrid, consulta Groq por el central para documentos guardados en carpetas vigiladas, con presupuesto y cola. Los archivos sin clasificación semántica completa aparecen pendientes. Las salidas mediadas consultan la política central sobre una instantánea y comprueban su SHA-256. HTTPS se inspecciona antes de reenviar la solicitud; SMTP antes de la aceptación y relevo. La decisión y el recibo de ejecución se registran por separado.

## Último paso: tu clave Groq

Edita localmente `.env`, generado por setup:

```dotenv
DLP_LLM_MODE=hybrid
GROQ_API_KEY=TU_CLAVE_LOCAL
GROQ_MODEL=openai/gpt-oss-20b
```

```powershell
npm.cmd run groq:check
npm.cmd run wsl:sync
npm.cmd run evaluate:hybrid
```

`groq:check` envía un ejemplo ficticio al proveedor. `evaluate:hybrid` consulta las muestras ficticias y genera métricas propias; puede exceder la cuota gratuita. La clave no se imprime ni se sube a Git. Modelos, precio y límites dependen de Groq y de tu cuenta.

Sin clave, el modo híbrido retiene documentos que necesitan clasificación semántica. Un bloqueo local suficientemente fuerte evita enviarlos al proveedor. Clave ausente, cuota agotada, error, extracción parcial o respuesta ambigua no convierten un archivo en público. Para practicar solo con reglas configura temporalmente `DLP_LLM_MODE=off` y sincroniza; ese modo no acredita análisis semántico.

## Instalar en otra computadora

Requisitos Windows: Node.js 24+, PowerShell 5.1 y Git o ZIP. Para los servicios completos necesitas Docker Linux y Compose v2, directamente o dentro de una VM. Los controles generales requieren administrador en el Windows de laboratorio.

```powershell
git clone https://github.com/Brando-01/DLP.git
cd DLP
npm.cmd ci
npm.cmd run setup
```

**Con un motor Docker Linux disponible:**

```powershell
docker compose --env-file .env -f deploy/compose.yaml --profile extended --profile wazuh up -d --build
npm.cmd run agent
```

Para obtener la CA pública crea `datos-control/certs-public/` y ejecuta `docker compose --env-file .env -f deploy/compose.yaml cp proxy:/ca-public/mitmproxy-ca-cert.pem datos-control/certs-public/mitmproxy-ca-cert.pem`.

**Con WSL2 instalado, sin configurar Ubuntu manualmente:**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/wsl/Lab-WSL.ps1 -Action Plan
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/wsl/Lab-WSL.ps1 -Action Create
npm.cmd run wsl:sync
npm.cmd run wsl:ca
npm.cmd run agent
```

Create descarga una imagen oficial Ubuntu WSL y verifica SHA-256. Sync instala el motor Docker dentro de esa distribución, sin depender de Docker Desktop. Solo debes instalar WSL2 antes si tu Windows aún no lo tiene. Elige un backend; detén el otro para liberar sus puertos.

**Alternativa con VirtualBox 7.2+ y Python 3.12+:**

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r integrations/requirements.txt -r deploy/vm/requirements.txt
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/vm/Lab-VM.ps1 -Action Plan
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/vm/Lab-VM.ps1 -Action Create
npm.cmd run vm:start
npm.cmd run vm:sync
npm.cmd run vm:ca
npm.cmd run agent
```

Create descarga una imagen oficial Ubuntu 24.04, verifica SHA-256 y crea una VM nueva de 4 GiB y disco dinámico de 24 GiB. No requiere configurar Ubuntu manualmente ni sobrescribe VM existentes. Para apagarla usa `Lab-VM.ps1 -Action Stop`. En este anfitrión VirtualBox con Hyper-V presentó pausas; la validación final utiliza WSL2.

**Laboratorio reducido sin Docker:** con Python y las dependencias instaladas, `npm.cmd run lab` inicia control, agente, receptor HTTPS/WebDAV, proxy, SMTP y DNS locales. No inicia Postfix, Samba, FTP, SSH, Suricata ni Wazuh. No lo ejecutes al mismo tiempo que la VM en los mismos puertos. `npm start` conserva el portal histórico y el agente; `DLP_CONTROL_EMBEDDED=1` agrega un control local.

## Proteger la salida de una VM Windows

La inspección de la salida requiere forzar los puntos de control y verificar cada aplicación. Un proxy configurado voluntariamente no obliga al resto de programas a utilizarlo.

```powershell
.\endpoint\windows\Managed-Egress.ps1 -Action Plan -GatewayAddress IP_DEL_SERVIDOR
.\endpoint\windows\System-Controls.ps1 -Action Plan
```

En PowerShell como administrador del **equipo aislado**, `Managed-Egress.ps1 -Action Apply -ConfirmLab -GatewayAddress IP_DEL_SERVIDOR -CaCertificate RUTA_CA_PUBLICA` restringe salida al gateway y configura Chrome/Edge con proxy obligatorio, QUIC y DoH desactivados. Respalda reglas/perfiles/políticas; `-Action Restore` revierte los cambios propios. Configura la interfaz para usar el DNS autorizado del laboratorio y compruébalo. Firefox necesita proxy y CA por separado. Las aplicaciones con certificate pinning pueden fallar al inspeccionar TLS.

USB nativo: `System-Controls.ps1 -Action Apply -Controls USBWrite`, con Restore. Restringe todo el canal. La selección por contenido corresponde a operaciones iniciadas desde el agente. Debe comprobarse el dispositivo físico; una configuración guardada no demuestra bloqueo físico.

Para otro equipo, `npm.cmd run endpoint:export -- http://IP_DEL_SERVIDOR:3100` genera `.env.endpoint`: cópialo como `.env` en el cliente. No incluye Groq ni el token administrativo. Contiene credenciales de inspección y telemetría: no lo publiques. HTTP se admite únicamente para red aislada y datos ficticios; utiliza TLS en despliegues reales. Configura las carpetas protegidas desde el panel; el agente no obtiene permisos para leer archivos ajenos o protegidos por el sistema.

Desde Kali se usa la IP Host-only del servidor. La VM entregada publica inicialmente en loopback, así que debes preparar esa interfaz y puertos antes de acceder desde Kali. No publiques el panel local 3001.

## Doce casos y cobertura

### Actividad en vivo y acceso al entorno Linux

Abre http://127.0.0.1:3001/#live. La vista consulta eventos cada dos segundos y muestra dominios visitados, archivos, operaciones de salida y procesos observados. También muestra el último latido de cada conector y del sensor Windows; un evento histórico no cuenta como conexión actual.

La extensión 3.1 necesita recargarse desde la página de extensiones y aceptar el permiso webNavigation. En Opciones, pulsa Guardar y comprobar conexión; comprueba el estado Conectado en la vista y visita un sitio. Se registra solamente el origen (dominio y puerto), sin ruta, búsquedas, parámetros, fragmentos ni contenido de página. La opción Registrar dominios visitados permite desactivar esa observación. Las inspecciones de subidas/pegado son independientes.

El sensor Windows detecta inicios y cierres de procesos mediante muestras cada cinco segundos; los procesos muy breves pueden pasar inadvertidos. Sysmon aporta eventos adicionales si está instalado y accesible. La observación no equivale a bloqueo ni a registrar toda acción de todas las aplicaciones. `node evaluacion/windows-observer.js` verifica el latido sin órdenes y un inicio/cierre real sin leer el portapapeles de prueba.

Para entrar al entorno activo desde PowerShell de Windows: `wsl -d DLP-Control-WSL -u root`. La VM alternativa VirtualBox usa dlpadmin con contraseña de consola bloqueada y autenticación por clave SSH; no hay una contraseña que introducir en su pantalla de login. No hace falta encenderla para este despliegue WSL.

### Matriz de canales

| Caso | Implementación | Límite |
| --- | --- | --- |
| CU-01 USB | Operación mediada y política Windows USBWrite | Selección por contenido mediada; restricción nativa del canal completo. Prueba física depende del equipo. |
| CU-02 ruta no autorizada | Vigilante, correlación por hash, Samba full_audit | Alerta posterior a escritura; no bloqueo selectivo universal de copias nativas. |
| CU-03 adjunto de correo | Postfix y filtro MIME Python | Extrae formatos admitidos antes de aceptar/relevar; receptor ficticio, sin Gmail real. |
| CU-04 cuerpo de correo | Decodificación MIME | Base64, quoted-printable y asunto; no depende de body_checks sin decodificar. |
| CU-05 HTTPS | mitmproxy y política central | Requiere CA confiada y salida forzada. |
| CU-06 texto web | Cuerpo y parámetros HTTP | Formularios, JSON, XML y texto; WebSocket/no inspeccionable se retiene. |
| CU-07 rclone | Proxy y firewall | E2E real WebDAV HTTPS; otros backends requieren prueba propia. |
| CU-08 SCP/SFTP | Firewall por canal/destino | No descifra el contenido SSH. |
| CU-09 FTP claro | vsftpd, Suricata y Wazuh | IDS detecta; firewall deniega el canal. Suricata pasivo no previene. |
| CU-10 DNS | Resolver, dnsmasq y restricción de salida | Tipo, dominio, longitud y frecuencia; anomalía no demuestra sensibilidad. |
| CU-11 cifrado | Política no inspeccionable | ZIP genérico, 7z/GPG y desconocidos/parciales se retienen en enforce; no descifra. |
| CU-12 evasión | Firma real y base64 | DOCX/JPG, XLSX/PNG; rechaza cargas parciales. Sin reconstrucción arbitraria ni OCR. |

## Wazuh y Sysmon

El perfil `wazuh` inicia manager 4.14.1 y reenvía alertas al panel sin indexador. Consume la proyección acotada `siem.jsonl`, DNS, Samba y las alertas EVE de Suricata. La auditoría completa se conserva por separado. IDs locales: 100200..100251. Wazuh correlaciona alertas; la prevención la ejecutan proxy, filtro SMTP, resolver o firewall.

En el Windows protegido instala Sysmon desde Microsoft y el agente Wazuh compatible. Ejecuta `endpoint/windows/Prepare-Sensors.ps1 -ManagerAddress IP_DEL_MANAGER` para generar XML con las rutas actuales. Configura manager/contraseña de enrolamiento y combina el fragmento generado con su configuración existente. No se instalan silenciosamente en la PC principal. El sensor informa disponibilidad y permisos; no inventa eventos si faltan. No reenvía líneas de comandos ni consultas DNS completas al panel.

## Pruebas y métricas

```powershell
npm.cmd test
.venv\Scripts\python.exe -m unittest discover -s test -p 'test_*.py'
npm.cmd run test:managed
npm.cmd run wsl:verify
npm.cmd run evaluate:endpoint
npm.cmd run doctor
```

Resultados en `output/evaluacion/`. `wsl:verify` (o `vm:verify` para ese backend) usa temporalmente reglas locales para no consumir Groq y restaura el modo configurado. Comprueba receptores independientes, SSH, salida directa, DNS, FTP/Suricata, Samba y Wazuh. Conserva errores; un escenario listado o una prueba fallida no equivalen a cobertura lograda.

`test:managed` necesita Python/mitmproxy. Usa puertos aleatorios, TLS/SMTP reales y receptores independientes. rclone es opcional: indica `DLP_RCLONE` con la ruta de su ejecutable; el resultado señala si se ejecutó. Las pruebas del modelo utilizan respuestas simuladas identificadas como tales. La evaluación real con clave es separada.

Para detección se cuenta positivo si se reconoce sensibilidad; para prevención, si se retiene la operación. Registra aparte errores, restricciones por no inspección y falsos bloqueos de archivos públicos. Las muestras de desarrollo no demuestran exactitud sobre cualquier documento. Se conservan las evaluaciones históricas v1/v2.

## Código y documentación

- `lib/semantic.js`: Groq, esquema estricto, límites y caché por hash.
- `lib/extract-worker.js`, `lib/classifier.js`, `lib/policy.js`: extracción, reglas y decisión.
- `control/`: consola, autenticación por función, política, decisiones y recibos.
- `endpoint/`: agente, inventario, copias, puente PowerShell y panel.
- `integrations/` y `deploy/`: filtros, sensores, contenedores y VM.
- [Arquitectura administrada](docs/ARQUITECTURA_ADMINISTRADA.md).
- [Instalación y navegadores paso a paso](docs/INSTALACION_Y_NAVEGADORES.md).
- [Informe PDF de la versión actual](output/pdf/Informe_DLP_Administrado_v3.pdf).
- [Histórico v2](docs/HISTORICO_V2.md): no describe Groq ni el despliegue actual.

`.env`, `.env.endpoint`, claves, VM y datos operativos están excluidos de Git. La auditoría encadenada detecta alteraciones ordinarias; no es firma digital ni protege frente a un administrador que reconstruya toda la cadena. El prototipo no incorpora driver de kernel ni protección antimanipulación empresarial; su cobertura corresponde a los puntos de control desplegados y verificados.
