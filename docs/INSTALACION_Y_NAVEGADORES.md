# Guía completa de instalación, navegadores y credenciales

Esta guía corresponde al agente Windows, al control central en WSL2 y al conector 3.1. Las muestras y destinos de la demostración son ficticios. No necesitas preparar Ubuntu manualmente ni iniciar Docker Desktop para el método WSL.

## 1. Qué se ejecuta y dónde

| Componente | Lugar | Dirección o función |
| --- | --- | --- |
| Agente y sensor | Windows protegido | http://127.0.0.1:3001 |
| Actividad en vivo | Panel del agente | http://127.0.0.1:3001/#live |
| Extensión | Cada navegador que quieras vincular | Se conecta al agente en 3001 |
| Control central, filtros y Wazuh | Distribución DLP-Control-WSL | http://127.0.0.1:3100 desde Windows |
| Proxy HTTPS | Servicio Linux | 127.0.0.1:8080 desde Windows |
| SMTP de prueba | Servicio Linux | 127.0.0.1:2525 desde Windows |
| DNS de prueba | Servicio Linux | 127.0.0.1:5300/UDP desde Windows |

En el método inicial todo vive en la misma computadora, con servicios Linux dentro de WSL. Los puertos internos y las IP Docker no se escriben en las opciones de la extensión.

## 2. Instalar en una computadora nueva

Necesitas Windows con WSL2 operativo, Node.js 24 o superior con npm, y Git o el ZIP del proyecto. Comprueba en PowerShell:

```powershell
node --version
npm.cmd --version
wsl --version
```

Si no tienes WSL2, sigue primero la [instalación oficial de Microsoft](https://learn.microsoft.com/windows/wsl/install); la habilitación puede pedir administrador o reiniciar Windows. Después continúa en una terminal normal de Windows. Descarga Node desde [su sitio oficial](https://nodejs.org/en/download).

```powershell
git clone https://github.com/Brando-01/DLP.git
cd DLP
npm.cmd ci
npm.cmd run setup
npm.cmd run extension:build
```

Si descargaste ZIP, extráelo y abre PowerShell en la carpeta que contiene package.json; empieza con npm.cmd ci. Los comandos se ejecutan desde esa carpeta, no dentro de extension/dist ni desde la consola de VirtualBox.

`setup` prepara .env, credenciales del agente, muestras y el archivo de enrolamiento Wazuh. También repara los campos automáticos vacíos si antes copiaste la plantilla. Al repetirse conserva las credenciales válidas y tu clave Groq: no cambia el token de una extensión ya vinculada.

## 3. Preparar .env: solo aportas tu clave Groq

El archivo versionado es **.env.example**, una plantilla pública. El archivo que usa tu instalación es **.env**, privado e ignorado por Git.

No hace falta copiarlo a mano: `npm.cmd run setup` crea .env y genera los valores internos. Si prefieres copiarlo, ejecuta setup después. No dejes los tokens en blanco ni inventes un token común para todas las computadoras.

Abre el .env privado en un editor. Tu única credencial externa pendiente es:

```dotenv
GROQ_API_KEY=TU_CLAVE_REAL_LOCAL
```

Conserva los valores predeterminados de DLP_LLM_MODE=hybrid, GROQ_MODEL=openai/gpt-oss-20b, DLP_INSPECTION_BACKEND=central y DLP_CONTROL_EMBEDDED=0 para este método. Deja el resto tal como lo genera setup. No edites la plantilla pública para guardar tu clave real.

| Credencial | Quién la prepara | Dónde se utiliza |
| --- | --- | --- |
| GROQ_API_KEY | Tú, desde tu cuenta Groq | Solo en .env del servidor; nunca en la extensión |
| DLP_CONTROL_ADMIN_TOKEN | setup, aleatorio | Entrada de la consola central en 3100 |
| DLP_INSPECT_TOKEN | setup, aleatorio | Comunicación interna con el motor; no se pega en el navegador |
| DLP_TELEMETRY_TOKEN | setup, aleatorio | Telemetría del agente y de Wazuh |
| DLP_LAB_PASSWORD | setup, aleatorio | Usuarios ficticios de Samba, FTP y SSH del laboratorio |
| DLP_WAZUH_ENROLLMENT_PASSWORD | setup, aleatorio | Incorporación de agentes Wazuh; setup prepara deploy/state/authd.pass |
| Token de vinculación del navegador | Agente/setup | Extensión; lo obtienes en el panel 3001, sección Navegador |

**El token de la extensión no es ninguno de los tokens del control central.** No hay que añadir una variable GROQ o ADMIN en sus opciones. El agente conserva su token de navegador en datos-endpoint/credenciales.json y lo muestra mediante su panel local.

## 4. Primer despliegue completo con WSL

Si ya existe DLP-Control-WSL, omite Create. Para comprobarlo: `wsl --list --verbose`.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/wsl/Lab-WSL.ps1 -Action Plan
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/wsl/Lab-WSL.ps1 -Action Create
npm.cmd start
```

Create descarga una imagen oficial WSL y comprueba su SHA-256. Sync instala Docker Linux en esa distribución, copia el proyecto y construye los servicios. Puede tardar varios minutos. ExportCA copia únicamente el certificado público del proxy al directorio datos-control/certs-public. El proceso auxiliar del lanzador mantiene activa su distribución; no cambia Hyper-V ni instala una CA en Windows.

`npm.cmd start` reúne setup, construcción de extensión, Sync, ExportCA, agente y receptores. Mantén abierta su terminal y abre http://127.0.0.1:3001. Si otro agente/demo ocupa esos puertos, ciérralo primero. El arranque no activa restricciones de Windows; consulta ARRANQUE_UNICO.md para diferenciar servicios iniciados de protección del equipo.

Para abrir la consola central en http://127.0.0.1:3100, copia localmente el valor de DLP_CONTROL_ADMIN_TOKEN del .env, sin el nombre de la variable ni comillas, y pégalo en su acceso. No pegues allí el token de extensión.

## 5. Inicios posteriores, cambios y parada

Después de reiniciar Windows o actualizar el código/.env:

```powershell
npm.cmd start
```

El lanzador sincroniza los cambios con la copia Linux; editar solo .env sin reiniciar/sincronizar no actualiza un contenedor en ejecución. Los comandos wsl:* y agent quedan para diagnóstico de componentes. Aunque se construya la extensión, debes recargarla en cada navegador y refrescar las pestañas para reemplazar el código anterior.

Ctrl+C en la terminal principal cierra sus recursos locales y el backend iniciado allí; conserva un backend ya existente. Si el agente está en segundo plano, usa Detener agente en la bandeja Windows. Para detener exclusivamente el entorno Linux del proyecto:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/wsl/Lab-WSL.ps1 -Action Stop
```

No es necesario borrar volúmenes ni restablecer Docker Desktop. Las restricciones administrativas que hayas aplicado se restauran mediante sus propios scripts, no al cerrar el panel.

## 6. Chrome, Brave y Edge

La carpeta de estos tres navegadores es **extension/dist/chromium**, que contiene manifest.json. Carga esa carpeta completa; no el directorio padre ni un archivo JS.

| Navegador | Página de extensiones |
| --- | --- |
| Chrome | chrome://extensions |
| Brave | brave://extensions |
| Edge | edge://extensions |

1. Ejecuta `npm.cmd run extension:build` desde la raíz del proyecto.
2. Abre la página de extensiones correspondiente y activa Modo de desarrollador.
3. Pulsa Cargar descomprimida o Cargar extensión sin empaquetar y selecciona extension/dist/chromium.
4. Confirma que se muestra DLP de laboratorio · Conector, versión 3.1.0. Acepta los permisos solicitados de navegación para esta prueba.
5. Abre sus opciones desde el icono DLP o desde Detalles / Opciones de la extensión.
6. Vincúlala siguiendo la sección 8 de esta guía.

Si ya estaba instalada desde esta misma carpeta, usa Recargar en su tarjeta. Los archivos nuevos en disco no actualizan por sí solos una extensión que sigue cargada. Si continúa en 2.0, comprueba que no esté instalada desde una copia antigua del ZIP. Retira o desactiva copias duplicadas para no interceptar dos veces una operación.

El procedimiento de carga local se basa en la [documentación de extensiones de Chrome](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked). Las políticas de un equipo administrado pueden impedir cargar extensiones locales.

## 7. Firefox de escritorio

Firefox usa su compilación **extension/dist/firefox**. No cargues el manifiesto Chromium.

1. Ejecuta `npm.cmd run extension:build`.
2. Abre `about:debugging#/runtime/this-firefox` en Firefox.
3. En Este Firefox, pulsa Cargar complemento temporal.
4. Selecciona extension/dist/firefox/manifest.json.
5. Abre el icono de DLP; si no aparece, búscalo en el menú de extensiones o en about:addons y abre sus Preferencias/Opciones.
6. Introduce la dirección y el token indicados en la sección 8; guarda y comprueba la conexión.

La carga temporal desaparece al reiniciar Firefox. Vuelve a cargar el manifiesto y comprueba el vínculo; si solicita token, usa el del agente actual. Para actualizarlo dentro de la sesión usa Recargar en about:debugging. Una instalación permanente en Firefox normal requiere un complemento firmado; este repositorio no entrega un XPI firmado. Véase la [guía oficial de Mozilla](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).

Se genera la versión Firefox y se comparte el código del conector; la batería automatizada de navegador ejecutada en este proyecto utiliza Chromium. Valida en tu Firefox las pruebas de la sección 9 antes de atribuirle la misma cobertura.

### Si Firefox está dentro de Kali

127.0.0.1 dentro de Kali significa Kali. Esta guía básica protege el Windows donde corre el agente. La extensión exige un agente local y no acepta como dirección una IP remota de Windows.

Para proteger interacciones de Firefox en Kali necesitas ejecutar también el agente Node en Kali, vincularte con el token de ese agente y configurar ese cliente para consultar un control central alcanzable por la red privada. Los sensores nativos Windows no funcionan en Kali. El servidor WSL inicial se accede desde Windows; incorporarlo a Host-only requiere preparar la publicación y el firewall de esa red. No basta con pegar la IP de Windows en la extensión.

## 8. Vincular: dirección y token exactos

1. Abre http://127.0.0.1:3001 en la computadora donde está el navegador.
2. En el menú del agente entra en Navegador.
3. Pulsa Mostrar / ocultar token o Copiar token de vinculación. Es una cadena de 64 caracteres.
4. En las opciones de la extensión rellena:

| Campo | Qué debes poner |
| --- | --- |
| Dirección local del agente | http://127.0.0.1:3001 |
| Token del navegador | Solo el valor copiado del panel, sin comillas ni el nombre de una variable |
| Activar el conector | Marcado |
| Retener si el agente no responde | Marcado para las pruebas con cierre ante fallo |
| Registrar dominios visitados | Marcado si quieres ver sitios en Actividad en vivo |

5. Pulsa Guardar y comprobar conexión. Debe indicar Conexión comprobada.
6. Abre http://127.0.0.1:3001/#live y pulsa Ctrl+F5 si tenías una versión anterior del panel. Debe mostrar Conectado, versión 3.1.0 y un latido reciente.
7. Visita un sitio y vuelve al panel; filtra por Sitios visitados.

Puedes vincular varios navegadores con el mismo token de este agente; cada instalación mantiene su propio identificador y latido. Si desactivas el conector deja de considerarse activo; si desaparece sin avisar, el vínculo vence tras 150 segundos sin latido. El registro no reconstruye visitas anteriores a la instalación. Las ventanas privadas requieren habilitar allí el complemento.

No pegues GROQ_API_KEY, DLP_CONTROL_ADMIN_TOKEN, DLP_INSPECT_TOKEN ni DLP_TELEMETRY_TOKEN en el campo Token del navegador. No publiques capturas con el token visible. Si borras datos-endpoint o cambias de computadora, el token local puede cambiar: vuelve a vincular las extensiones.

## 9. Pruebas manuales para saber que funciona

### Navegación y procesos

En Actividad en vivo, visita dos sitios y confirma filas SITIO_WEB_VISITADO. Solo se conserva dominio y puerto; no rutas, búsquedas, fragmentos ni contenido de las páginas. Los cambios de ruta de aplicaciones web se observan con esa misma reducción de datos.

Abre una ventana nueva de CMD, espera diez segundos y escribe `exit`. Filtra Procesos y Windows para observar inicio/cierre. El sensor toma muestras cada cinco segundos y puede perder procesos más breves. Si Sysmon no está instalado, el panel lo indica: no lo presenta como disponible.

### Archivos, pegado y arrastre

En otra terminal de Windows ejecuta `npm.cmd run site:demo` y abre http://127.0.0.1:4200 en el navegador vinculado. Este receptor es independiente y acepta datos ficticios si no existe un control.

Selecciona laboratorio/Finanzas/privado.xlsx o laboratorio/protegidos/confidencial.json. Comprueba la retención y su resultado en Actividad y auditoría. Prueba pegar `DNI: 12345678` en el campo de texto y arrastrar el archivo ficticio sensible al área de prueba.

Para un público usa laboratorio/Finanzas/publico.txt. En modo híbrido necesita una clasificación semántica válida si no hay bloqueo local fuerte. Sin clave o con cuota agotada puede quedar retenido por falta de inspección: eso no demuestra que el archivo sea confidencial ni que la extensión esté desconectada.

Para verificar la liberación de públicos sin depender de una cuenta externa puedes ejecutar `npm.cmd run wsl:verify`: usa reglas locales temporalmente en el laboratorio y restaura el modo configurado. La prueba interactiva en tu navegador debe indicar siempre el modo utilizado.

## 10. Extensión, proxy y certificado son piezas distintas

La extensión registra navegación e intercepta las interacciones compatibles del navegador. El proxy inspecciona solicitudes HTTP/HTTPS que realmente pasan por él, incluidas aplicaciones compatibles. El cierre obligatorio de otras rutas corresponde al firewall y a las políticas del equipo de laboratorio. Vincular un token no configura el proxy ni aplica esas políticas.

### Firefox: proxy en un perfil de laboratorio

Exporta la CA con `npm.cmd run wsl:ca`. En un perfil Firefox de prueba, abre Ajustes, General, Configuración de red, Configuración. Selecciona configuración manual: proxy HTTP 127.0.0.1 y puerto 8080; úsalo también para HTTPS. Excluye localhost y 127.0.0.1 para mantener directo el acceso al agente. Revisa la [documentación de Mozilla sobre conexión](https://support.mozilla.org/en-US/kb/connection-settings-firefox).

Para HTTPS, importa datos-control/certs-public/mitmproxy-ca-cert.pem en Ajustes, Privacidad y seguridad, Certificados, Ver certificados, Autoridades, Importar, confiando en esa CA para identificar sitios. Hazlo en el perfil de laboratorio; al terminar restaura el proxy y retira esa autoridad o elimina el perfil de prueba.

### Chrome, Brave y Edge: equipo Windows aislado

En una VM Windows de laboratorio puedes configurar el proxy de Windows a 127.0.0.1:8080 con exclusión de localhost/127.0.0.1. La dirección cambia si el gateway está en otra máquina. La CA debe ser confiable para ese navegador/usuario. Los scripts Managed-Egress permiten hacerlo de forma administrada con respaldo, pero Apply exige administrador y afecta al equipo: revisa primero Plan.

Si haces la importación manual en esa VM, abre certmgr.msc, Entidades de certificación raíz de confianza, Certificados, Importar y selecciona solo el certificado público. Guarda su identidad para retirarlo al terminar. No importes una clave privada y no apliques esta confianza a una PC ajena al laboratorio.

La inspección TLS requiere esa confianza; algunas aplicaciones usan certificate pinning y pueden fallar. Consulta [mitmproxy: certificados](https://docs.mitmproxy.org/stable/concepts/certificates/). El archivo mitmproxy-ca.pem contiene clave privada y no se comparte; el exportado por este proyecto termina en -ca-cert.pem y es público.

## 11. Activar y comprobar Groq al final

Después de poner tu clave únicamente en .env:

```powershell
npm.cmd run groq:check
npm.cmd run wsl:sync
```

El primer comando prueba una consulta real con contenido ficticio y no imprime la clave. El segundo actualiza el servidor WSL. Revisa el estado del clasificador en la consola central. Si cambiaste de modelo, comprueba que tu cuenta lo admita y que soporte el esquema utilizado.

Para evaluar las muestras con consultas reales: `npm.cmd run evaluate:hybrid`. Las cuotas y la disponibilidad dependen de Groq; no se ofrece un servicio ilimitado. PENDING_KEY significa clave pendiente; ERROR puede significar cuota, red o respuesta inválida. En enforce se retiene la salida mientras no haya inspección completa.

## 12. Errores habituales

| Lo que ves | Qué revisar |
| --- | --- |
| Token no válido / HTTP 401 | Usa el token de 3001 > Navegador, no el ADMIN de .env. Confirma que pertenece a esta computadora. |
| No se puede conectar | Inicia el agente; usa exactamente http://127.0.0.1:3001, sin /api y sin puerto 3100. |
| Conexión comprobada pero no aparecen visitas | Extensión 3.1 recargada, navegación activada, dominio cubierto; realiza una visita nueva. |
| No aparece Actividad en vivo | Ctrl+F5 en el panel y comprueba que ejecutas el repositorio actualizado. |
| Firefox pierde el complemento | La instalación es temporal: vuelve a cargar su manifest.json tras reiniciar Firefox. |
| Público retenido | Comprueba estado de Groq, modo del canal, destino y extracción; no lo cuentes automáticamente como detección sensible. |
| Error de certificado | Exporta e importa la CA pública de esta instalación para el perfil/equipo aislado. No desactives la validación TLS general. |
| EADDRINUSE / puerto ocupado | Evita un segundo agente y no ejecutes WSL, VirtualBox y lab local en los mismos puertos. |
| Docker Desktop muestra dockerInference | El método WSL usa su daemon propio. Puedes cerrar Desktop y comprobar wsl:start. |
| VirtualBox pide login | Es la alternativa, no el backend activo. Usa WSL como se explica debajo. |
| Token interno vacío después de copiar plantilla | Ejecuta npm.cmd run setup. La versión actual completa los campos automáticos vacíos. |

## 13. Entrar al Linux activo y alternativas

Desde PowerShell de Windows:

```powershell
wsl -d DLP-Control-WSL -u root
```

No pide contraseña de consola. Para salir de esa terminal usa `exit`; el lanzador mantiene activos los servicios mientras no ejecutes Stop.

La VM alternativa DLP-Control-v3 usa dlpadmin con contraseña de consola bloqueada y acceso mediante clave SSH local. No hay una contraseña de root/admin/kali que debas probar en ese login. Conserva la alternativa apagada cuando utilices WSL. Para Docker Linux directo, VirtualBox o el laboratorio reducido sin Docker consulta el README principal: son rutas alternativas, no pasos acumulativos.

## 14. Actualizar o trasladar

Antes de actualizar código, detén el agente que ocupa 3001. Conserva .env y datos-endpoint si quieres mantener configuración/token. Ejecuta `git pull`, `npm.cmd ci`, `npm.cmd run setup`, `npm.cmd run extension:build` y `npm.cmd run wsl:sync`; reinicia el agente y recarga las extensiones. Si solo cambiaste la clave Groq no necesitas recompilar la extensión ni reemplazar su token.

En una nueva instalación ejecuta setup para generar credenciales propias; no copies tu .env real al repositorio ni compartas un ZIP con él. Para un endpoint separado usa `npm.cmd run endpoint:export -- URL_DEL_CONTROL` y las instrucciones del README. El token de navegador siempre corresponde al agente local del equipo protegido.

La configuración entregada no activa silenciosamente firewall, USBWrite ni certificados en Windows. Esos controles se aplican y prueban por separado en el entorno aislado. La navegación y los procesos observados son telemetría; no demuestran prevención universal de todas las acciones de la PC.
