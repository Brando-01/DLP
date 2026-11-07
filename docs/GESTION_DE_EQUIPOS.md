# Gestión individual e inicio automático de clientes

Actualizado el 6 de noviembre de 2026. Esta etapa administra identidades, actividad y arranque de los agentes. No añade interceptación universal de las aplicaciones ni modifica automáticamente proxy, firewall o certificados.

## Consola desde tu PC

Abre http://127.0.0.1:3100 y usa DLP_CONTROL_ADMIN_TOKEN del .env del servidor. La clave Groq permanece en el servidor. El panel 3001 pertenece al agente local de cada puesto; el 3100 reúne los equipos.

En Equipos puedes seleccionar Ver actividad o usar el filtro. El servidor filtra primero por identidad y después limita a los últimos 300 eventos, para que la actividad de otro puesto no oculte los registros del seleccionado. Un filtro adicional separa permitido, detectado, alerta, bloqueado y errores. Los nombres de archivo, clase y estado semántico disponibles se muestran sin copiar el contenido del documento.

Los latidos se envían cada diez segundos aunque no haya eventos. Los estados se calculan con la hora del servidor:

- Conectado: último contacto hace como máximo 30 segundos.
- Sin reporte reciente: entre 30 segundos y dos minutos.
- Desconectado: más de dos minutos o sin primer latido.
- Pendiente/caducado: invitación sin consumir, válida durante treinta minutos.
- Revocado: las credenciales individuales ya no autorizan solicitudes nuevas.

Estos estados acreditan contacto con el agente, no protección completa del sistema. El modo de inicio mostrado es reportado por el cliente. El registro conserva identidad y último contacto después de reiniciar el central.

## Actualizar los clientes ya inscritos (ventana Node y detalle de actividad)

Una tarea que lanza node.exe directamente puede mostrar una consola aunque la tarea tenga la propiedad Hidden. Se sustituyó por un lanzador PowerShell con WindowStyle Hidden que espera al supervisor. La instalación reinicia únicamente la tarea/unidad propia para cargar el código nuevo. No reinstales la identidad ni copies el .env de otro equipo.

En Windows, desde la sesión LABWIN:

```powershell
cd 'C:\Users\LABWIN\DLP-Cliente'
git pull --ff-only
npm.cmd run client:install
npm.cmd run client:status
```

En Kali, desde su usuario habitual y sin sudo:

```bash
cd ~/DLP-Cliente
git pull --ff-only
npm run client:install
npm run client:status
```

Después puedes cerrar esas terminales. No ejecutes además npm start en los clientes: el supervisor ya ejecuta el agente. Mantén operativo el central del anfitrión. Si un agente anterior se inició manualmente y no está bajo el supervisor, ciérralo con Ctrl+C antes de instalar; no termines todos los procesos Node del sistema.

En 3100 pulsa Ver actividad en WIN-01 o LIN-01. Estado del equipo seleccionado muestra sensores, extensiones vinculadas, inventario y resultados semánticos. La tabla muestra nombre del programa y PID en los eventos de procesos, y origen del sitio en los de navegación. El listado desplegable incluye hasta 50 procesos de la última muestra, también los que ya estaban abiertos al iniciar el agente. Si el equipo está desconectado, ese listado es histórico.

- Windows consulta los procesos visibles a su usuario cada cinco segundos; Kali consulta /proc y solo incluye el UID del usuario del agente. Los nombres de /proc/comm pueden estar truncados por Linux. No se recolectan argumentos de comandos, pulsaciones, pantallas ni contenido de ventanas.
- Se limitan a 100 cambios de procesos por muestra y 50 nombres en el resumen; se reportan cambios omitidos. Procesos que nacen y terminan entre muestras pueden no aparecer. Un proceso observado no acredita qué archivos leyó ni qué bytes envió.
- La navegación requiere instalar y vincular la extensión en cada navegador/perfil de cada VM y habilitar su observación. Se guarda el origen (dominio y puerto), sin búsquedas, ruta ni fragmentos. Sin extensión o canal proxy obligatorio no se acredita observación ni inspección de ese navegador.
- La clasificación de Groq se ejecuta en el central, sin clave en las VM. COMPLETE acredita un resultado semántico, que puede proceder de caché. OFF, EMPTY_CONTENT y BYPASSED_LOCAL_BLOCK no acreditan una consulta a Groq: los vacíos no necesitan LLM y una regla local puede bloquear antes. Sin resultados para un equipo, el panel lo indica explícitamente.
- El agente permanece identificable en procesos, tareas/servicios y registros; no incorpora ocultación frente al administrador. La tarea Windows y systemd de usuario dependen de la sesión: esto no acredita protección antes del inicio de sesión ni resistencia a un administrador local.

Para probar la continuidad, cierra solo la terminal de instalación; abre una aplicación de prueba durante al menos diez segundos y ciérrala. En unos 10–25 segundos, con central y sensores disponibles, deben aparecer programa/PID e inicio/salida en la vista del equipo. Después cierra y vuelve a iniciar sesión en la VM para comprobar el arranque automático. Si falla, consulta client:status y datos-endpoint/supervisor.log, sin publicar credenciales.

La inspección selectiva de WhatsApp, Discord o cualquier otra aplicación no queda resuelta por observar sus procesos. Requiere un canal de salida obligatorio e inspeccionable, confianza TLS compatible y restricciones contra salidas alternativas; aplicaciones con cifrado extremo a extremo pueden requerir bloqueo completo del canal o un componente de endpoint compatible. El proyecto aún no acredita interceptación universal ni bloqueo de cualquier fuga. No se presenta el envío de texto de procesos a Groq como sustituto de inspeccionar contenido antes de la transferencia.

## Inscribir un equipo una sola vez

1. En Agregar equipo indica un nombre como WIN-01 o LIN-01 y su plataforma.
2. Indica la dirección que alcanza el cliente: para este laboratorio, http://192.168.56.1:3100.
3. Crea y descarga la invitación privada JSON. Es de un solo uso y caduca en treinta minutos. El servidor conserva únicamente su huella.
4. Copia el JSON exclusivamente al equipo correspondiente. No publiques capturas con su contenido ni lo añadas al repositorio. Para varias VM usa carpetas compartidas distintas, no una carpeta común con todas las invitaciones.
5. Actualiza el código del puesto, conserva su .env y datos-endpoint, y ejecuta npm ci si faltan dependencias.
6. Cierra con Ctrl+C el arranque manual de esa VM. Instala desde una terminal de su usuario habitual, no desde una cuenta diferente ni como root.

En Windows VM, una instrucción por vez:

```powershell
cd 'C:\Users\LABWIN\DLP-Cliente'
git pull --ff-only
npm.cmd run client:setup -- --invitation 'C:\RUTA\invitacion.json'
npm.cmd run client:status
```

En Kali, adaptar solo la ruta del JSON:

```bash
cd ~/DLP-Cliente
git pull --ff-only
npm run client:setup -- --invitation /ruta/invitacion.json
npm run client:status
```

Si una carpeta compartida Linux de solo lectura es accesible únicamente por root, copia solo su invitación al directorio del usuario antes de ejecutar la instalación sin sudo:

```bash
sudo install -m 600 -o "$(id -u)" -g "$(id -g)" /ruta/compartida/invitacion.json "$HOME/invitacion-dlp.json"
```

El instalador verifica dependencias y puerto antes de consumir la invitación, obtiene dos tokens nuevos por equipo (inspección y telemetría), actualiza .env y configura su inicio automático. No copia el token ADMIN ni la clave Groq del servidor. Conserva el entorno anterior en datos-endpoint/instalacion, que es privado e ignorado por Git. Los tokens de extensión siguen siendo los del agente local; no se usa la invitación como token de navegador.

Si la inscripción terminó pero falló la instalación de la tarea o servicio, corrige el error y repite client:setup con el mismo archivo: una identidad ya guardada no vuelve a consumir la invitación. También puedes ejecutar client:install. No cambies una identidad existente por otra sin revisar el registro y el historial.

Si una instalación anterior de Kali mostró `bad unit file setting`, actualiza con `git pull --ff-only` y ejecuta `npm run client:install`, sin sudo. Se corrigió la generación de WorkingDirectory: las comillas exteriores eran interpretadas como parte de la ruta. El instalador reescribe solo su unidad propia, la verifica con systemd-analyze antes de habilitarla y recarga el gestor de usuario. La identidad ya inscrita y sus credenciales se conservan; no hace falta otra invitación. Comprueba después `npm run client:status`.

HTTP se admite únicamente como concesión explícita al laboratorio aislado. El tramo entre agente y central no está cifrado en ese modo. El uso en una red compartida requiere HTTPS con confianza de certificados apropiada. Los tokens individuales permiten atribución al titular de la credencial, no acreditación hardware ni resistencia frente al administrador local.

## Qué arranca automáticamente

Windows instala una tarea programada por instalación y usuario, al iniciar sesión, con nivel limitado y sin una ventana de terminal. Esa tarea ejecuta un supervisor que reinicia su agente si finaliza y evita duplicarlo. No se instala un servicio SYSTEM. Las funciones de portapapeles dependen de la sesión del usuario.

Linux instala una unidad systemd de usuario en ~/.config/systemd/user. El supervisor y systemd gestionan reinicios. No instala un servicio root ni habilita linger. El inicio predeterminado depende de la sesión del usuario; no se acredita protección antes de iniciar sesión. Node debe estar en una ruta estable, sin mover ni borrar el proyecto después de instalar.

Para uso diario, el usuario del puesto inicia sesión; no necesita escribir npm start. El servidor central debe continuar operativo. Esta etapa no instala arranque automático del servidor WSL del anfitrión: npm.cmd start sigue siendo su punto de entrada manual de laboratorio.

Cada supervisor usa su registro privado datos-endpoint/supervisor.json, un archivo de solicitud de parada con nonce y un log acotado. Comprueba el identificador de instalación del agente en el puerto antes de gestionarlo. No cierra servicios ajenos ni adopta una versión anterior que no pueda identificar. Detener desde el panel local puede provocar el reinicio supervisado: para una parada intencional usa client:stop.

## Consultar, detener y retirar

Si la tarea figura Running pero 3001 y 3002 no responden y supervisor.log muestra salidas con código 1, el supervisor está activo y el agente está fallando. Detén el supervisor con client:stop y ejecuta `npm run client:diagnose` (npm.cmd en Windows). Este diagnóstico solo lee .env y archivos de estado conocidos; muestra nombre de archivo, estado JSON, codificación y primera línea problemática de la auditoría, sin valores, tokens ni contenido. También verifica la cadena de la auditoría. No inicia sensores, no modifica archivos y no activa el firewall.

Un error JSON_INVALIDO al arrancar ahora identifica el archivo sin imprimir fragmentos de credenciales o documentos. Conserva el estado para revisar el caso: no elimines credenciales ni reconstruyas o borres auditoria.jsonl para conseguir que arranque. Si la configuración, la codificación o un registro están dañados, la corrección debe prepararse sobre una copia de respaldo y conservar la evidencia original.

### Recuperar un único registro final inválido de la auditoría local

Si el diagnóstico valida un prefijo de eventos y encuentra JSON inválido al final, usa `npm run client:recover-audit` para obtener un plan sin modificar archivos. En Windows utiliza npm.cmd. Solo se considera recuperable un último registro JSON ilegible, sin eventos posteriores y con todos los hashes anteriores válidos. Una cadena alterada, daño intermedio o ausencia de prefijo verificable requieren revisión; el comando no los corrige automáticamente.

Con el supervisor detenido mediante client:stop y sin agente manual abierto, ejecuta `npm run client:recover-audit -- --apply`. El comando comprueba que 3001/3002 estén libres y que no haya un supervisor activo. Conserva una copia íntegra byte por byte, el fragmento inválido y manifiestos SHA-256 en datos-endpoint/recuperacion-auditoria/ID. Valida la cadena candidata antes de sustituir atómicamente el archivo activo. Los eventos anteriores mantienen sus identificadores y bytes. Se añade AUDITORIA_RECUPERADA_CON_CUARENTENA con decisión ALERTA y revisión pendiente; no se afirma que el fragmento perdido haya podido interpretarse ni que el daño fuera accidental. El archivo original se conserva como evidencia privada, no debe publicarse.

Durante la intervención, un bloqueo propio impide abrir o escribir la auditoría desde el agente actualizado. Si aparece una recuperación pendiente tras una interrupción, conserva el bloqueo y los respaldos para revisar el caso; no lo borres a ciegas. Las nuevas escrituras del registro solicitan flush antes de cerrarse para reducir el riesgo de perder datos pendientes; esto no garantiza inmunidad ante cortes o corrupción del almacenamiento.

Después ejecuta client:diagnose. Si la auditoría figura OK, reinicia con client:install y comprueba los puertos antes de strict:apply. La recuperación es local: no reconstruye ni modifica el historial ya recibido por el central, ni acredita que hubiera protección mientras el agente estaba detenido.

En Windows usa npm.cmd y en Linux npm, desde la carpeta del cliente:

```text
npm run client:plan
npm run client:status
npm run client:stop
npm run client:install
npm run client:uninstall
```

Plan solo muestra configuración. Stop detiene el supervisor instalado y su proceso propio; el inicio automático permanece configurado para una próxima sesión. Install lo habilita e inicia de nuevo. Uninstall retira el mecanismo de inicio propio; conserva identidad, archivos de usuario, eventos y controles de red. Para una retirada de acceso, revoca además la credencial desde el central. Una revocación no desinstala software remoto ni termina una inspección ya iniciada.

En Windows las políticas de la organización pueden impedir registrar tareas al usuario estándar. En ese caso revisar el error y el despliegue administrativo; no se eleva silenciosamente a otra cuenta. Linux requiere que systemd y el bus de usuario estén disponibles en su sesión. Un resultado de instalación no prueba por sí mismo el arranque tras reiniciar: debe validarse en cada VM.

## Compatibilidad y atribución

Las credenciales globales siguen disponibles para proxy, SMTP, Wazuh e instalaciones anteriores. Sus equipos aparecen como Credencial compartida / migración pendiente. No se presentan como identidades individuales. Al migrar, el registro anterior puede quedar desconectado y el nuevo aparece con el nombre elegido y un UUID estable.

Una credencial individual de telemetría no puede reportar como otra identidad; una credencial de inspección no puede administrar el servidor ni confirmar recibos de otro equipo. Revocar un equipo no invalida al resto. Las decisiones de inspección, clasificación del inventario y recibos quedan vinculados a la identidad autenticada aunque el cliente cambie de hostname.

El tráfico de los conectores compartidos conserva su atribución al gateway/conector. La publicación con portproxy puede ocultar la IP original de una VM. No se infiere identidad individual de ese tráfico ni se mezcla con una identidad inscrita. La atribución de todas las aplicaciones por túnel o proxy autenticado es una etapa posterior.

## Validación que debe hacerse en las VM

1. Inscribir WIN-01 y LIN-01 con invitaciones distintas y verificar sus primeros reportes.
2. Producir un evento público y otro sensible por un canal instrumentado de cada cliente; comprobar vista individual y recibos.
3. Cerrar deliberadamente un proceso del agente de prueba y comprobar reinicio y reporte. No finalizar otros procesos Node ni el servidor.
4. Cerrar/iniciar sesión y comprobar que aparece el agente sin terminal. Después comprobar también el reinicio completo de cada VM.
5. Apagar una VM, esperar más de dos minutos y comprobar Desconectado; la otra debe seguir conectada.
6. Revocar únicamente una identidad de prueba y comprobar rechazo de sus tokens y continuidad del otro equipo.
7. Retirar su inicio automático con Uninstall y comprobar que se conservan datos y controles anteriores.

Las pruebas automatizadas usan un central temporal, Chromium real y documentos ficticios. El supervisor se prueba con un proceso real ficticio y puertos temporales; el ciclo de systemctl se prueba con ejecutor simulado. La sintaxis de la unidad Linux se valida además con systemd-analyze real, con rutas normales, espacios, porcentajes y comillas, y un control negativo que reproduce el fallo original. También se registró, arrancó sin ventana, actualizó en marcha y retiró una tarea Windows real con un cliente ficticio, sin iniciar sensores DLP ni cambiar controles del sistema. El sensor Linux se prueba con /proc ficticio y con un proceso real en Linux; se comprueban aislamiento por usuario, entrada/salida, límites y ausencia de argumentos. No se atribuye a esas pruebas una instalación real en las VM ni la clasificación de Groq en vivo. Los resultados de consola están en output/evaluacion/resultado-central.json.

## Referencias

- Microsoft, tareas al inicio de sesión: https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasktrigger
- Microsoft, registro de tareas: https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/register-scheduledtask
- Microsoft, Start-Process y WindowStyle: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process
- Linux, nombres de procesos en /proc: https://man7.org/linux/man-pages/man5/proc_pid_comm.5.html
- systemd, unidades de servicio: https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html
