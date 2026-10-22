# Laboratorio DLP de endpoint Windows

Clasificación local de información sensible, vigilancia de carpetas, controles de salida, auditoría y evaluación de falsos positivos y negativos. Conserva el portal Windows/Kali, pero ya no depende solo de subir archivos a ese portal.

Usa exclusivamente datos ficticios y destinos autorizados. Es un prototipo académico, no un antivirus, EDR ni DLP empresarial invulnerable. Inspecciona sensibilidad; no demuestra ausencia de malware. No integra Groq ni envía contenido a un LLM.

## Instalar en otra computadora

Requisitos: Windows 10/11 con sesión interactiva y PowerShell 5.1; [Node.js 24 o superior](https://nodejs.org/en/download), incluido npm; [Git](https://git-scm.com/downloads) opcional si descargas ZIP. Verificado con Node 24.15.0. No requiere Ubuntu, Python, base de datos ni claves externas para ejecutar. Internet es necesario para instalar dependencias inicialmente.

```powershell
git clone https://github.com/Brando-01/DLP.git
cd DLP
npm.cmd ci
npm.cmd run extension:build
npm.cmd start
```

Con ZIP, abre PowerShell en la carpeta de package.json y comienza en npm.cmd ci. Abre el panel del agente en http://127.0.0.1:3001 y el portal adicional en http://localhost:3000. Mantén la terminal abierta; Ctrl+C detiene ambos. El panel solo escucha en loopback; el portal escucha en todas las interfaces para Kali: no lo expongas a Internet.

## Demostración rápida

1. Abre Inventario: el agente crea muestras ficticias en laboratorio/protegidos/. Un JSON con código y nota se clasifica aunque no diga confidencial.
2. Crea o modifica un TXT allí sin subirlo a la web: el vigilante vuelve a clasificarlo. También hay escaneo periódico, por defecto cada 120 segundos.
3. En Salidas controladas envía un público y un sensible al USB de laboratorio. El primero se escribe; el segundo no. El destino inicial es una carpeta, no un USB conectado.
4. Para HTTP real, abre otra terminal y ejecuta `npm.cmd run receiver`. Selecciona el receptor en el panel: solo llegan los bytes permitidos.
5. Selecciona Microsoft Print to PDF: un público genera un PDF bajo laboratorio/impresiones/; un sensible no llega al controlador. Se imprime texto extraído, no el diseño original.
6. En Auditoría consulta decisión, resultado, canal y evidencia, verifica integridad y exporta CSV.

Los destinos USB/red iniciales están marcados LABORATORIO. El receptor guarda sus salidas bajo laboratorio/; consulta su mensaje de inicio para el puerto.

## Complemento del navegador

```powershell
npm.cmd run extension:build
npm.cmd run site:demo
```

Chrome: chrome://extensions, modo desarrollador, Cargar descomprimida, carpeta extension/dist/chromium. Edge: edge://extensions, misma carpeta. Firefox: about:debugging#/runtime/this-firefox, cargar complemento temporal, extension/dist/firefox/manifest.json. La instalación temporal de Firefox desaparece al cerrarlo; no es una distribución firmada.

En el panel abre Navegador, copia el token del conector, introdúcelo en Opciones del complemento con http://127.0.0.1:3001 y verifica la conexión. Recarga http://127.0.0.1:4200.

Ese sitio es un receptor independiente sin DLP propio. Prueba selección manual, pegado y arrastre: se retiene un sensible y se permite un público. Desactivar el complemento muestra que el sitio recibe los sensibles sin protección. No publiques el token.

Cubre interacciones DOM soportadas, no todas las APIs de subida, aplicaciones de escritorio ni todos los sitios. Algunas páginas rechazan eventos reemitidos. Un usuario puede desactivar una extensión no administrada. El cierre ante fallo retiene interacciones soportadas si no responde el agente: no equivale a detectar sensibilidad. Las selecciones superiores a 20 archivos o 10 MiB por archivo se retienen localmente sin una decisión de contenido del agente.

## Clasificación y configuración

En Configuración añade Documentos/Escritorio/Descargas o modifica watchRoots. No se exploran todos los discos automáticamente; se omiten enlaces, ubicaciones excluidas y archivos inaccesibles. Los límites e incidencias son visibles.

- Reglas: lib/classifier.js. Once indicadores: clasificación, estudiante/nota, correo ficticio, contraseñas, DNI, secretos, Luhn y diagnóstico clínico.
- Política por canal: lib/policy.js. Cada regla suma una vez por archivo. Los puntos no son probabilidades.
- Por defecto: 0 permite; 1-2 alerta y permite; 3 o más bloquea.
- audit detecta y permite; alert alerta y permite; enforce aplica el umbral. Una extracción desconocida/parcial se retiene en enforce: es restricción por falta de inspección, no reconocimiento sensible.
- Extractores: lib/extract-worker.js. TXT, CSV, JSON, PDF con texto, DOCX, XLSX y extensiones de texto admitidas. Máximo 10 MiB, 200 000 caracteres, PDF hasta 100 páginas; límites de tiempo/memoria y expansión ZIP.
- No hay OCR, descifrado, ejecución de macros ni análisis antivirus. El portal original mantiene TXT/CSV/JSON de hasta 1 MiB.

Los destinos reales se configuran dentro de targets, por ejemplo:

```json
[
  {"id":"usb-real","name":"USB autorizado","channel":"usb","path":"E:\\PruebasDLP","lab":false},
  {"id":"smb-real","name":"Recurso de prueba","channel":"network_share","path":"\\\\SERVIDOR\\DLP","lab":false}
]
```

El sensor debe confirmar el USB como extraíble; algunos discos externos se identifican como fijos y se rechazan conservadoramente. SMB requiere ruta UNC y permisos. Siguen siendo operaciones mediadas: no interceptan cualquier copia del Explorador.

## Segundo plano e inicio de sesión

Vista previa sin cambios:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\endpoint\windows\Install-Agent.ps1 -Action Plan
```

Para instalar voluntariamente el inicio del usuario actual cambia Plan por Install; agrega -Start para iniciarlo. Uninstall retira solo el acceso directo propio y conserva registros, configuración y proceso activo. No instala un controlador ni servicio privilegiado. La bandeja permite abrir el panel o detener el agente. No lances otro agente si ya está iniciado con npm.

## Controles generales Windows, opcionales

USBWrite impide escritura en almacenamiento extraíble; SMBOutbound bloquea TCP 139/445 y UDP 137/138; Printing detiene y deshabilita Spooler. Bloquean el canal completo, incluidos datos públicos, no selectivamente por contenido. SMB sobre QUIC no está cubierto.

Primero consulta, sin cambios ni administrador:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\endpoint\windows\System-Controls.ps1 -Action Plan
```

Solo en una máquina de laboratorio, con PowerShell como administrador y tras revisar el impacto:

```powershell
.\endpoint\windows\System-Controls.ps1 -Action Apply -Controls USBWrite
.\endpoint\windows\System-Controls.ps1 -Action Restore
```

Restore es una operación posterior para retirar los cambios propios respaldados, no parte obligatoria de aplicar. Omitir -Controls solicita los tres controles. Puede ser necesario reconectar USB o reiniciar. El estado guardado acredita configuración, no prueba física. No se activaron estas políticas automáticamente en la PC del usuario. No borres el respaldo mientras estén activos. Restore conserva estados que identifica como ajenos y registra advertencias.

## Observación nativa frente a prevención

El portapapeles se observa después de copiar. La limpieza reactiva es opcional, desactivada por defecto; no acredita que ninguna aplicación leyera antes el contenido. Las imágenes son no analizables. La copia iniciada desde el panel sí decide antes de escribir. Los trabajos externos de impresión solo se observan como metadatos si Windows permite consultarlos; no se afirma lectura del contenido ni bloqueo previo.

## Pruebas reproducibles

```powershell
npm.cmd test
npm.cmd run evaluate:endpoint
npm.cmd run test:windows
npm.cmd run evaluate
```

Hay 32 pruebas funcionales. La evaluación endpoint usa 27 documentos repetidos en cinco canales: 135 operaciones, no 135 documentos independientes. USB/SMB son directorios de laboratorio; HTTP es un receptor real; clipboard/print usan dobles de prueba en esta batería. Se comprueba ausencia de efectos bloqueados y hashes de permitidos. test:windows añade una prueba nativa de Microsoft Print to PDF, sin modificar el portapapeles ni políticas.

Resultados en output/evaluacion/: resultado-endpoint.json, CSV y resultado-windows.json. Conservan errores y límites. Los casos son de desarrollo, no una validación independiente de generalización. evaluate conserva la evaluación histórica del portal de 20 documentos.

test:browser es opcional y requiere Playwright y Chrome for Testing/Chromium compatible con extensiones. No son dependencias para ejecutar el DLP. Puedes indicar DLP_PLAYWRIGHT_MODULE y DLP_CHROMIUM_EXECUTABLE. Se verificó en Chromium 151 con ocho escenarios y un receptor independiente. Usa perfil temporal aislado; las pruebas de pegado y arrastre son eventos DOM sintéticos, no prueba del portapapeles físico. El resultado está en resultado-navegador.json. Firefox sigue sin validación E2E.

## Kali y red

Kali es un cliente/receptor opcional, no el equipo protegido por el sensor Windows. Accede al portal http://IP-HOST-ONLY-DE-WINDOWS:3000, no a localhost. La IP previa fue 192.168.56.1: verifica con ipconfig. Usa Host-only y firewall limitado a la red del laboratorio. No publiques el panel 3001.

Para recibir HTTP en Kali, instala Node 24 y el proyecto, configura DLP_RECEIVER_HOST=0.0.0.0 y ejecuta el receptor. Añade su IP Host-only y puerto 4100 al destino del agente. El receptor es de laboratorio, sin autenticación ni TLS; solo datos ficticios en red aislada.

## Datos y documentación

datos-endpoint/ guarda configuración, credenciales, inventario, auditoría y respaldos. laboratorio/ guarda muestras y salidas. Ambos están excluidos de Git. La auditoría encadena SHA-256: no es firma digital ni impide que un administrador reconstruya todo el registro. La API separa token administrativo y token del navegador, limita entradas y valida Host/orígenes; no es una plataforma multiusuario con protección antimanipulación.

- [Arquitectura y casos de uso endpoint](docs/ARQUITECTURA_ENDPOINT.md).
- [Informe universitario endpoint](output/pdf/Informe_DLP_Endpoint.pdf).
- [Plan y evidencia de cobertura](docs/PLAN_ENDPOINT.md).
- El [informe original](output/pdf/Informe_tecnico_DLP.pdf) describe el portal histórico, no la ampliación endpoint.

No se afirma control selectivo universal de toda la PC: se diferencian prevención mediada, conector del navegador, observación reactiva y controles generales opcionales.
