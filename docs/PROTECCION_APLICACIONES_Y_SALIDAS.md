# Protección de aplicaciones, webs e inventario semántico

Ampliación del DLP administrado. Los archivos quedan preparados; guardar o instalar esta versión **no activa** restricciones del sistema. El usuario pidió probar posteriormente en su Windows principal y mantener el programa detenido mientras realiza otros trabajos.

## Qué cambia

| Capa | Comportamiento | Límite que se debe probar |
| --- | --- | --- |
| Inventario semántico | Archivos guardados en carpetas vigiladas pasan por reglas y, cuando corresponde, Groq. | No lee el texto aún no guardado en Word; no vigila automáticamente todos los discos. |
| Política central restringida | Solo destinos de subida y correo autorizados. Los canales de salida requieren enforce. | El tráfico debe llegar al conector. No basta con editar listas para impedir una salida directa. |
| Restricción de aplicaciones por EXE | Firewall bloquea las rutas instaladas seleccionadas de WhatsApp/Discord. | Bloquea también datos públicos y mensajes. Otra versión, otro EXE, otro usuario o un relay local requieren pruebas. |
| Endpoint de salida exclusiva | Firewall habilitado y salida denegada por defecto; cada programa llega solo al puerto de su conector. | Requiere gateway separado, programas de Program Files, CA y una cuenta de trabajo estándar. No aplicar al Windows principal sin una prueba aislada previa. |
| Estado visible | El panel distingue sin aplicar, sin comprobar, configuración verificada y cambios detectados. | Una comprobación de configuración no sustituye una prueba de transferencia real. |

No se añadió un controlador minifilter ni un producto DLP comercial. No existe bloqueo selectivo universal de lecturas de archivos por cualquier aplicación. Las restricciones nativas implementadas bloquean un canal o una aplicación; la decisión por contenido se realiza en los conectores compatibles. Un administrador local puede alterar las restricciones.

## 1. Actualizar cuando termines tus otros trabajos

Estos comandos **arrancan o despliegan servicios**. No se ejecutaron como parte de la preparación final solicitada:

```powershell
cd 'C:\Users\ADMIN\Documents\Topico de Ciberseguridad\proyecto-dlp'
npm.cmd ci
npm.cmd run setup
npm.cmd run wsl:sync
npm.cmd run agent
```

No inicies un segundo agente si el puerto 3001 ya está ocupado. `wsl:sync` es necesario para que el control central conozca la nueva ruta `/v1/classify` y el perfil restringido. La extensión conserva su versión 3.1.0: no se presenta como interceptor universal.

## 2. Clasificación al guardar documentos

Con `DLP_LLM_MODE=hybrid`, la nueva opción `inventorySemantic: true` del agente permite clasificar el contenido accesible de **sus carpetas vigiladas**. Las configuraciones anteriores reciben estos valores predeterminados al cargar:

```json
{
  "inventorySemantic": true,
  "semanticFilesPerScan": 5
}
```

El watcher solicita una exploración tras cambios guardados. Se analiza una instantánea; el servidor confirma su SHA-256. Un Word o Excel abierto puede estar temporalmente bloqueado: se reintentará en una exploración posterior. El motor aplica primero reglas; un bloqueo fuerte local evita enviar el texto a Groq. Otros documentos compatibles se consultan en el central con `/v1/classify`, sin generar tickets de envío ni afirmar prevención.

El presupuesto de cinco documentos evita una ráfaga ilimitada. Los demás quedan `QUEUED` y avanzan en exploraciones siguientes. Un fallo tiene espera de 15 minutos; **Reclasificar** fuerza un nuevo intento. Sin respuesta semántica completa no se muestra PUBLICO para un archivo sin indicadores locales: aparece PENDIENTE. `INTERNO` tampoco equivale a bloqueo: depende de los umbrales.

En **Archivos clasificados**, revisa la columna semántica:

- `COMPLETE`: terminó la clasificación; `LLM-001` indica que elevó la sensibilidad.
- `QUEUED`: espera presupuesto de una exploración siguiente.
- `CENTRAL_UNAVAILABLE`, `ERROR`, `PENDING_KEY`, `PARTIAL` o `NO_DETERMINADO`: no hay clasificación completa.
- `REGLAS_LOCALES`, `OFF` o `NOT_REQUESTED`: no atribuyas el resultado a una llamada de Groq.

La clave solo se conserva en el servidor central. Se envía texto extraído a un proveedor externo, con los límites y caché descritos en ARQUITECTURA_ADMINISTRADA.md. Usa muestras ficticias. Para excluir el inventario del procesamiento externo, cambia `inventorySemantic` a false; las salidas pueden seguir consultando a Groq. Desactivar todo Groq requiere `DLP_LLM_MODE=off` y actualizar/reiniciar los procesos correspondientes.

No basta con que un documento incluya un correo empresarial para ser confidencial. Define la verdad de referencia y evalúa documentos públicos y privados. El LLM no conoce automáticamente la política interna de cualquier empresa.

## 3. Restringir los clientes nativos en tu PC, posteriormente

Este modo puede utilizarse con la topología local WSL existente. **No cambia la salida predeterminada del firewall**. Restringe todo el tráfico saliente de los ejecutables seleccionados; no mantiene el envío de archivos públicos en esos clientes.

Primero, en PowerShell normal, inspecciona lo que se detectó:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File endpoint/windows/Native-Apps.ps1 -Action Discover
npm.cmd run applications:plan
```

El descubrimiento busca procesos instalados, directorios habituales y paquetes del usuario actual. No inicia las aplicaciones. Si no aparecen, usa rutas absolutas concretas del EXE real, no accesos directos `.lnk`. Si elevas con otra cuenta de administrador, pasa las rutas descubiertas explícitamente: esa cuenta puede tener otros paquetes instalados.

Solo cuando hayas terminado tus trabajos, cerrado esos clientes y decidido restringirlos, usa una terminal administrativa:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File endpoint/windows/Native-Apps.ps1 -Action Apply -ConfirmBlockApplications
npm.cmd run applications:audit
```

También puedes limitar la selección:

```powershell
# Sustituye esta ruta de ejemplo por la instalada realmente.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File endpoint/windows/Native-Apps.ps1 -Action Plan -Programs 'C:\ruta\real\Discord.exe'
```

Plan no aplica cambios. Para aplicar esa selección, utiliza los mismos argumentos con `-Action Apply -ConfirmBlockApplications`, en la terminal administrativa.

Valida con archivos ficticios desde el cliente real, no solo con Test-NetConnection: este último prueba el proceso PowerShell. Comprueba si los bytes llegaron al receptor o si el mensaje quedó sin enviar. Prueba también si la aplicación utiliza un proxy local: Windows Firewall tiene particularidades de loopback y no se acredita esa ruta solo por tener una regla EXE. Las actualizaciones pueden instalar otro ejecutable: Audit informa versiones descubiertas sin cubrir, pero no crea reglas automáticamente.

Para retirar únicamente estas reglas, en PowerShell administrativo:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File endpoint/windows/Native-Apps.ps1 -Action Restore
```

El respaldo está en `%ProgramData%\DLP-Laboratorio\NativeApps`. Al aplicar, el directorio de seguridad permite escritura solo a SYSTEM/administradores y lectura a usuarios del equipo. No borres el respaldo mientras existan reglas activas.

## 4. Bloquear conversores y subidas a destinos no autorizados

Prepara la política sin aplicarla:

```powershell
npm.cmd run protection:prepare -- --uploads sink.dlp.test --mail dlp.test,example.test
```

Genera `datos-endpoint/politica-estricta.json`. En Windows también prepara `proteccion-politica.json` con rutas instaladas, sin sobrescribir una plantilla existente. Ninguno de esos archivos contiene la clave Groq. Esta preparación no inicia servicios ni modifica el firewall.

Los dominios del ejemplo son ficticios: sustitúyelos por destinos de prueba propios. En la consola central 3100, entra con su ADMIN y copia el contenido de `politica-estricta.json` al editor de políticas existente. Mantén `profile: "restricted"`. El servidor rechaza `uploadDomains: ["*"]`, correo global y modos audit/alert para los canales de salida del perfil estricto.

Una subida con contenido hacia una web de conversión no autorizada queda denegada **aunque el archivo sea público**. Esto es una restricción de destino; no se cuenta como sensibilidad reconocida. El proxy transmite también si la solicitud intenta escribir aunque el cuerpo esté vacío. Consultas con datos y parámetros se inspeccionan como contenido. WebSockets, formatos desconocidos y cargas parciales siguen retenidos.

Esta política controla lo que llega al motor. Mientras una aplicación pueda salir sin proxy o usar un navegador sin administrar, conserva una ruta fuera de ese control. Para exclusividad de salida se necesita la siguiente capa.

## 5. Perfil preventivo de salida exclusiva: preparar y probar aislado

`endpoint/windows/Protection.ps1` sustituye al perfil amplio anterior para este uso. Autoriza **por programa y puerto**, sin dar a todos los procesos acceso general al gateway:

| Rol del EXE | Único destino de red autorizado |
| --- | --- |
| browser | IP del gateway, puerto del proxy |
| agent | IP del gateway, puerto del control central |
| mail | IP del gateway, puerto SMTP |
| wazuh | IP del gateway, 1514 y 1515 |

Todo lo demás queda denegado por defecto, incluidas salidas directas por 443, QUIC/UDP, DNS externo y aplicaciones no autorizadas. Chrome/Edge reciben proxy obligatorio y QUIC/DoH desactivados. Firefox recibe proxy manual bloqueado, DoH desactivado y confianza en raíces empresariales. La CA pública se instala en el almacén del equipo solo durante Apply. No se desactiva la validación TLS.

**Tu topología actual con todo en localhost no se convierte en una frontera independiente por ejecutar este script.** El modo exige una IPv4 privada del gateway en otro equipo o VM accesible; rechaza loopback e IPs del propio Windows. Si el gateway es WSL en la misma PC, la virtualización y las reglas de red del anfitrión requieren validación adicional. Para la primera prueba, utiliza otro Windows aislado como cliente y conserva el DLP en el gateway actual. No se ha acreditado exclusividad en tu Windows principal.

Prepara una IP estable del endpoint y del gateway: el perfil no autoriza DHCP, VPN, actualizadores, sincronizadores o DNS generales. No sirve para una sesión de trabajo habitual sin adaptar la política. La cuenta del usuario bajo prueba debe ser estándar; administra desde otra cuenta.

Edita `datos-endpoint/proteccion-politica.json`: gateway privado real, CA pública PEM y rutas reales instaladas en Program Files de navegadores, Node, Thunderbird/Wazuh si corresponden. No agregues WhatsApp/Discord como programas autorizados. Los EXE deben tener firma válida; una actualización cambia el hash y exige revisión. La configuración no contiene la clave Groq del servidor.

```powershell
# Solo muestra el plan:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File endpoint/windows/Protection.ps1 -Action Plan -PolicyPath datos-endpoint/proteccion-politica.json

# Posteriormente, SOLO en el endpoint aislado y como administrador:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File endpoint/windows/Protection.ps1 -Action Apply -PolicyPath datos-endpoint/proteccion-politica.json -ConfirmIsolatedEndpoint
powershell.exe -NoProfile -ExecutionPolicy Bypass -File endpoint/windows/Protection.ps1 -Action Audit

# Retira cambios propios y restaura los valores respaldados:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File endpoint/windows/Protection.ps1 -Action Restore
```

Si detecta permisos de salida por GPO o no puede llegar al gateway antes de aplicar, rechaza Apply. Respalda perfiles, reglas Allow anteriores, valores de registro y CA. La restauración comprueba propiedad de reglas y valores; si otra herramienta los cambió, conserva el respaldo e informa restauración parcial. Los respaldos se conservan en `%ProgramData%\DLP-Laboratorio\Protection` con permisos administrativos. La aplicación fallida intenta revertir lo propio, conserva respaldo y no se presenta como éxito.

En el panel 3001, **Comprobar restricciones de Windows** solo lee y comprueba: no ejecuta Apply. Si el usuario no tiene permisos para leer todos los filtros, usa Audit desde una terminal administrativa. Una auditoría sin elevar mantiene el resultado en memoria del agente; la administrativa puede persistirlo en el directorio protegido. El estado reciente caduca tras cinco minutos y tras reiniciar el agente puede necesitar otra comprobación. No automatiza restricciones ni se interpreta como resistencia frente a administradores.

## 6. Matriz obligatoria para tu prueba posterior

| Escenario | Prueba de control | Resultado esperado según capa |
| --- | --- | --- |
| WhatsApp / Discord nativos | Intentar mensaje y adjunto público/privado desde el EXE real. | Con restricción de app, su red queda restringida independientemente del documento; verificar otro EXE/actualización/proxy local. |
| Conversor no autorizado | Subir TXT, DOCX y XLSX públicos y privados. | Restricción de destino en todos; no sumar TP de sensibilidad. |
| Destino autorizado | Público y privado con mismos pasos. | Público llega con hash correcto; privado se retiene y no llega. |
| Selección, arrastre y otra API web | Repetir desde cada mecanismo del sitio. | Proxy obligatorio cubre el tráfico aunque falle el evento de la extensión; confirmar efectivamente el paso por proxy. |
| Intento directo sin proxy | Navegador y programa alternativo contra un receptor HTTPS operativo. | Endpoint estricto impide conexión directa; el receptor debe aceptar el control negativo desde otra máquina. |
| Archivo sin etiquetas | Redactar registros ficticios, guardar y esperar exploración. | Estado semántico y clasificación visibles, sin necesidad de intentar envío. |
| Groq central inaccesible | Intentar salida y clasificar inventario. | Salida retenida en enforce; inventario pendiente, sin clasificar todo como público. |
| Regla/firewall alterado | Desactivar regla en el endpoint aislado y auditar. | Estado DRIFT; no mostrar cobertura verificada. |
| Restauración | Restore, reiniciar navegadores y repetir conectividad base. | Volver a configuración previa; comprobar diferencias notificadas. |

Registra dos matrices: sensibilidad y prevención. Bloqueo por destino, por aplicación, por formato o por indisponibilidad no prueba que el LLM reconoció información confidencial. Incluye versiones de apps, hash del archivo, modo, resultado y evidencia del receptor.

## Verificación realizada al preparar esta ampliación

- 49 pruebas Node aprobadas: incluyen perfil restringido, cola semántica, clasificación central en reposo y caducidad del estado de protección. Usan muestras ficticias y respuestas controladas donde corresponde.
- 5 pruebas Python aprobadas sobre contenido y DNS.
- PowerShell 5.1: análisis de sintaxis del perfil, Discover, Plan, rechazo de loopback y Audit de perfil ausente, sin Apply.
- La evaluación de red extendida se interrumpió cuando el usuario pidió mantener el programa detenido. No se presenta como una ejecución nueva superada.
- No se aplicaron restricciones de Windows, no se instalaron certificados ni se ejecutaron pruebas reales de WhatsApp/Discord con estas reglas. Faltan esas pruebas en el endpoint que el usuario elija.

## Referencias de implementación

- Windows Firewall y reglas por programa: https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule
- Proxy administrado de Firefox: https://mozilla.github.io/enterprise-admin-reference/reference/policies/proxy/
- Plantillas de políticas de Firefox: https://mozilla.github.io/policy-templates/
- Diferencias de conectividad AppContainer/loopback: https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/troubleshooting-uwp-firewall
- Límites de interceptación TLS: https://docs.mitmproxy.org/stable/concepts/certificates/
