# Un solo arranque y cobertura real del equipo

## Uso diario

Con Node 24+, dependencias instaladas (`npm.cmd ci`) y la distribución DLP-Control-WSL preparada, el comando principal es:

```powershell
cd 'C:\Users\ADMIN\Documents\Topico de Ciberseguridad\proyecto-dlp'
npm.cmd start
```

No necesitas iniciar por separado agent, demo, receptores y WSL. El lanzador:

1. Comprueba que 3001, 4100 y 4200 estén libres; no cierra programas ajenos.
2. Lee el estado de las restricciones sin aplicarlas.
3. Ejecuta setup y construye la extensión, conservando credenciales y .env.
4. Sincroniza código y configuración con WSL, construye/inicia los servicios y exporta la CA pública, sin instalarla en Windows.
5. Comprueba el central con el token INSPECT y espera el acceso TCP a proxy/SMTP. Esto no demuestra inspección TLS efectiva ni resistencia a bypass.
6. Inicia el agente Windows, el sitio de prueba y el receptor de las transferencias mediadas.

El primer arranque tras un cambio puede tardar varios minutos. El panel principal queda en http://127.0.0.1:3001; el enlace al sitio de prueba aparece en el panel. La consola administrativa sigue en 3100, el proxy en 8080 y SMTP en 2525. Un único comando puede coordinar procesos de Windows y contenedores Linux; no los convierte en un solo proceso ni en un driver de Windows.

La consola muestra las etapas de sincronización y la salida de Docker en tiempo real. Si una descarga no produce salida, cada 15 segundos informa el tiempo transcurrido y el último avance. El límite de cada acción WSL de preparación es 45 minutos; no es una estimación del tiempo normal. Un fallo conserva las últimas líneas para identificar la descarga o servicio afectado. Las credenciales de entorno se ocultan en esa salida.

Si queda varios minutos en `RUN npm ci`, se están instalando dependencias dentro de la imagen Linux, aunque ya exista node_modules en Windows. Los errores ETIMEDOUT/ECONNRESET indican problemas de descarga; esperar no demuestra que los servicios ya estén disponibles. No ejecutes otro arranque en paralelo. Cuando el comando termine con error, conserva el mensaje y vuelve a ejecutar npm.cmd start tras resolver la conectividad. Las capas Docker completadas se reutilizan; una capa de instalación que no terminó puede tener que repetirse.

La instalación de la imagen central limita a cinco las conexiones simultáneas por servidor y a 60 segundos cada petición, con reintentos acotados y registro de descargas. La auditoría automática de npm se omite durante esa instalación para no añadir otra consulta externa al arranque; sigue disponible por separado con `npm.cmd audit`. No se desactiva la validación TLS ni la integridad del archivo de bloqueo. Referencia de las opciones: [configuración oficial de npm](https://docs.npmjs.com/cli/v11/using-npm/config/).

La instalación inicial de WSL, su distribución y la configuración del equipo se hacen una sola vez según INSTALACION_Y_NAVEGADORES.md. El lanzador no descarga una distribución ni cambia virtualización por su cuenta. Con un control remoto, configura DLP_CONTROL_URL y sus credenciales/red; no inicia el WSL local.

Ctrl+C cierra los servicios locales propios y detiene el backend WSL si no estaba operativo antes del lanzamiento. Un backend que ya existía se conserva. Para consultar o detener exclusivamente la distribución del laboratorio:

```powershell
npm.cmd run wsl:status
npm.cmd run wsl:stop
```

Tras un cierre forzado o un error durante la sincronización, comprueba ese estado. Si un puerto está ocupado por una demo/agente anterior, cierra su terminal antes de lanzar otro. El lanzador informa el conflicto y no mata automáticamente procesos.

## Por qué WhatsApp u otro Chrome siguen enviando

El arranque **no aplica** firewall, CA, USB ni políticas de navegador. En la revisión del equipo ambos perfiles devolvieron NOT_APPLIED. Esto explica que el cliente nativo y otros navegadores conserven rutas de salida. Se respetó la instrucción del usuario de preparar el proyecto sin activar restricciones automáticamente.

| Capa | Qué necesita | Qué significa |
| --- | --- | --- |
| Extensión | Cargar 3.1.1, permitirla en el perfil y vincular token | Interacciones web cubiertas de ese navegador; no otras apps ni todos los mecanismos de carga. |
| Proxy | Configuración del navegador/app, CA pública y salida obligatoria | Inspección de tráfico compatible que realmente pase por el proxy. No se acredita solo por iniciar mitmproxy. |
| WhatsApp/Discord nativos | Reglas EXE instaladas, auditadas y probadas | Restricción de su red completa, incluidos mensajes/archivos públicos; versiones y procesos auxiliares requieren pruebas. |
| Chrome sin extensión | Política de proxy y prevención de salida directa activas | No depende de tener extensión para el tráfico compatible; la política debe estar instalada en ese equipo. |
| Control selectivo universal del endpoint | Tecnología nativa de acceso a archivos y enforcement por aplicación, fuera de este prototipo | No se implementa iniciando Node ni observando procesos. El proyecto actual no ofrece esa garantía. |

Para activar controles del sistema revisa PROTECCION_APLICACIONES_Y_SALIDAS.md. Protection.ps1 exige endpoint aislado y gateway privado separado; la topología actual de servicios localhost no acredita esa frontera. Los scripts tienen Plan/Audit/Apply/Restore y Apply requiere intervención administrativa explícita. El lanzador nunca ejecuta Apply.

El panel muestra una franja de cobertura incompleta cuando no existe una verificación reciente del perfil de salida. Tener todos los servicios arriba no se presenta como protección total de la PC.

Si autorizas por separado restricciones nativas, el panel distingue sus reglas por EXE/paquete de la salida general del navegador. WhatsApp de Microsoft Store puede usar WebView2: el control de paquete se dirige a su SID, sin bloquear el WebView2 compartido de otras aplicaciones. La identidad debe corresponder al proceso y su efecto requiere una prueba real. `Native-Apps.ps1 -Action Refresh -ConfirmBlockApplications`, como administrador, añade identidades de paquetes a un perfil existente; Restore retira todas las reglas propias. No se restauran automáticamente al cerrar el agente. El filtro sigue siendo de aplicación completa, no selectivo por documento.

Se corrigió además el reemplazo atómico de respaldos en PowerShell 5.1 con NullString y se prueban las cuatro funciones reales de persistencia sobre archivos temporales. La auditoría comprueba las reglas creadas; no envía mensajes ni documentos desde tus aplicaciones.

Para impedir incluso el arranque si no hay una configuración del sistema verificada:

```powershell
npm.cmd start -- --require-system-controls
```

Este parámetro solo exige la comprobación de configuración del perfil; no prueba el efecto en WhatsApp ni inspección universal. Si falta, termina antes de iniciar servicios y explica la causa. La comprobación del perfil no puede reemplazar las pruebas reales de envío/directo/proxy de la matriz de casos.

## Modo de demostración

El modo de pruebas usa el mismo punto de entrada:

```powershell
npm.cmd start -- --demo
```

`npm.cmd run demo` permanece como alias compatible. Este modo es opcional: utiliza reglas, sin Groq, WSL ni sensores nativos. Su estado y token son separados para evitar cambiar la configuración de trabajo. No lo uses como protección de la PC ni necesitas ejecutarlo antes del arranque integrado.

Los comandos agent, web, receiver, lab, wsl:* y site:demo se conservan como herramientas técnicas. Para uso diario utiliza **npm.cmd start**. Los tests del coordinador usan backend y sensor simulados, puertos temporales y receptores locales. El 1 de noviembre de 2026 se comprobó además la construcción y sincronización reales en DLP-Control-WSL: instalación central completada, 14 contenedores activos, control saludable y acceso desde Windows al central autenticado, proxy y SMTP (3100/8080/2525). Se exportó la CA pública sin instalarla. Esta comprobación del backend no demuestra prevención en aplicaciones ni equivale a una prueba del agente Windows completo.
