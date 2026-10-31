# Ejecutar y comprobar el DLP

## 1. Actualizar e instalar

PowerShell normal, dentro de la carpeta del repositorio. Node.js 24+.
Antes de actualizar revisa `git status`; conserva tus cambios locales, no uses reset ni sobrescribas tu .env.

```powershell
git pull --ff-only
npm.cmd ci
npm.cmd run setup
npm.cmd run extension:build
npm.cmd test
```

Setup conserva las claves, tokens y muestras existentes; añade las muestras que falten.
No activa restricciones del sistema. No publiques .env ni tokens.

## 2. Primera prueba sencilla: sin WSL, Groq ni políticas de Windows

Detén con Ctrl+C cualquier agente anterior que use 3001 y cualquier receptor en 4100/4200.
No ejecutes demo, agent, start y lab simultáneamente en los mismos puertos.

```powershell
npm.cmd run demo
```

Mantén la terminal abierta. Este comando inicia:

| Dirección | Función |
| --- | --- |
| http://127.0.0.1:3001 | Panel del agente, inventario y decisiones |
| http://127.0.0.1:4200 | Sitio independiente que recibe archivos y texto |
| http://127.0.0.1:4100/upload | Receptor para transferencias mediadas del panel |

La demo usa solo reglas, sin consultas a Groq, sin proxy y sin sensor nativo Windows.
No edita .env. Su estado y token propios están en `datos-endpoint/demo/`.
No intercepta WhatsApp Desktop ni todas las operaciones de Windows.

### Vincular la extensión

1. Abre `chrome://extensions`, `edge://extensions` o `brave://extensions`.
2. Activa modo desarrollador y carga `extension/dist/chromium`.
3. Si ya estaba cargada, pulsa Recargar en la extensión. Cierra/reabre o recarga una vez las pestañas de prueba para reemplazar el content script antiguo.
4. En el panel 3001, abre **Navegador** y copia su token de vinculación.
5. En las opciones de la extensión, usa `http://127.0.0.1:3001`, pega ese token y pulsa Guardar y comprobar conexión.
6. Comprueba el latido en **Actividad en vivo**.

El token de la demo es distinto del agente normal: vuelve a vincular al cambiar de modo.
No uses el token ADMIN del central ni la clave Groq en la extensión.

### Secuencia manual obligatoria

Abre 4200 y utiliza las muestras de `laboratorio/Finanzas/`.

| Prueba | Acción | Resultado esperado con políticas predeterminadas |
| --- | --- | --- |
| Público | Adjuntar y enviar `publico.txt`, `.docx` o `.xlsx` | El receptor confirma recepción |
| Vacío real | Adjuntar/enviar `vacio.txt`, `vacio.docx` y `vacio.xlsx` | Permitidos; Office debe ser un documento válido, no un archivo de cero bytes con extensión cambiada |
| Sensible ficticio | Elegir `privado.txt`, `.docx` o `.xlsx` | Campo vacío; rechazo antes de publicar el archivo al sitio |
| Recuperación | Inmediatamente después del rechazo, elegir `publico.txt` | Se puede adjuntar y enviar sin recargar la página |
| Cancelación | Abrir selector y pulsar Cancelar; luego elegir público | Campo operativo, sin selección privada residual |
| Pegado | Pegar `DNI: 12345678`; después pegar un horario público | Sensible rechazado, público insertado y enviable |
| Arrastre | Arrastrar privado y luego público al área | Privado retenido; público recibido |
| Formato real | Elegir `renombrado.jpg` | Se reconoce el Word sensible, pese a la extensión |
| Base64 | Elegir `base64_privado.txt` | Se decodifica y detecta el DNI ficticio |
| Sin texto inspeccionable | Elegir `sin_texto.pdf` | Retenido por falta de OCR; no se inventa detección sensible |
| Agente detenido | Ctrl+C; intentar adjuntar público | Retenido por indisponibilidad; no se informa como sensibilidad confirmada |

Los archivos recibidos quedan en `laboratorio/sitio-independiente/`, con recibos y hash.
Correlaciona el recibo con **Actividad y auditoría**. Un mensaje de decisión no basta para acreditar que el destino recibió o no recibió bytes.

En **Control de salidas**, selecciona una muestra y el destino USB/carpeta/HTTP del laboratorio.
Público y vacíos deben completar la operación; sensible debe detenerse antes de escribir/enviar.
El destino «USB: carpeta de prueba» no es un pendrive físico ni demuestra bloqueo del Explorador.

Para CU-02, en esta demo el destino observado ya es `laboratorio/Escritorio/`:

```powershell
Copy-Item .\laboratorio\Finanzas\privado.txt .\laboratorio\Escritorio\copia-prueba.txt
```

Espera la alerta de copia nativa correlacionada por hash. El archivo **sí se escribió**: es detección posterior, no prevención.

## 3. Pruebas automáticas

```powershell
npm.cmd test
npm.cmd run test:regression
npm.cmd run evaluate:endpoint
```

Los tests semánticos usan respuestas simuladas identificadas, sin consumir la API.
La evaluación endpoint utiliza reglas locales, receptores HTTP reales y dobles de Windows.
Consulta `output/evaluacion/`; no confundas métricas de muestras de desarrollo con precisión universal.

Para Chromium real con la extensión:

```powershell
npm.cmd run browser:install
npm.cmd run extension:build
npm.cmd run test:browser
```

Playwright se instala como dependencia de desarrollo de `npm ci`; el comando browser:install descarga su navegador de pruebas.
No necesitas instalarlo globalmente. Si definiste PLAYWRIGHT_BROWSERS_PATH, usa el mismo valor al instalar y ejecutar.
El test utiliza un perfil aislado y puertos aleatorios. No inicia sesión en Gmail ni en una IA real.
Comprueba selección sensible/pública, recuperación, vacíos, pegado, arrastre y agente ausente contra un receptor independiente.
La compatibilidad con Gmail/IA de tu cuenta debe verificarse manualmente, solo con muestras ficticias.

## 4. Arranque completo con WSL y clasificador central

Detén la demo con Ctrl+C. Si ya creaste `DLP-Control-WSL`:

```powershell
npm.cmd run wsl:start
npm.cmd run wsl:sync
npm.cmd run wsl:ca
npm.cmd run agent
```

Sync es necesario tras cambiar código, políticas centrales o clave; no basta con reiniciar la extensión.
Si no existe el entorno WSL, sigue la sección de primera instalación del README (Plan y Create).
No arranques simultáneamente el backend VirtualBox, Docker Desktop y WSL con los mismos puertos.

La consola central está en http://127.0.0.1:3100 y el agente en 3001.
Usa el token del agente normal para volver a vincular la extensión.

En .env, el modo híbrido necesita una clave válida:

```dotenv
DLP_LLM_MODE=hybrid
GROQ_API_KEY=TU_CLAVE_PRIVADA
```

```powershell
npm.cmd run groq:check
npm.cmd run wsl:sync
```

Reinicia el agente tras editar .env. No envíes documentos personales reales al proveedor.
Si solo necesitas reglas, configura `DLP_LLM_MODE=off` y sincroniza/reinicia; no presentes ese modo como análisis semántico.
Falta de clave, cuota o timeout **sigue reteniendo contenido no vacío**: es cierre ante fallo, no un falso hallazgo sensible.
Vacíos acreditados por el extractor no necesitan IA; PDF sin texto, Office con objetos sin texto y formatos desconocidos siguen retenidos.

Para inspección HTTPS del proxy, usa el proxy 127.0.0.1:8080 y su CA pública conforme a la guía de instalación.
Instalar una CA permite interceptar TLS: hazlo solo en el perfil/equipo de laboratorio y no desactives la validación TLS.
Una extensión cargada no configura por sí misma el proxy ni obliga a las aplicaciones a utilizarlo.

## 5. Los doce casos: qué verificar

Para las pruebas de red, Python 3.12+ en un entorno virtual:

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r integrations/requirements.txt
.venv\Scripts\python.exe -m unittest discover -s test -p 'test_*.py'
npm.cmd run test:managed
npm.cmd run wsl:verify
```

| Caso | Prueba / herramienta | Evidencia y límite |
| --- | --- | --- |
| CU-01 USB | Control de salidas; evaluate:endpoint; pendrive físico por separado | La copia mediada es selectiva. USBWrite nativo restringe TODO el canal |
| CU-02 ruta no autorizada | Copy-Item anterior; auditoría de copias | Alerta tras escritura y hash; no bloqueo universal |
| CU-03 adjunto SMTP | test:managed; wsl:verify | SMTP/MIME y receptor independiente; Gmail web requiere además prueba de navegador/proxy |
| CU-04 cuerpo de correo | test:managed; wsl:verify | Decodifica cuerpo/asunto MIME; no atribuirlo al selector de adjuntos |
| CU-05 HTTPS | test:managed; navegador por proxy con CA; wsl:verify | Sensible no llega y público sí; solo tráfico realmente mediado |
| CU-06 texto web | test:browser y test:managed | Pegado compatible y cuerpos HTTP. Probar cada componente de la web |
| CU-07 rclone | test:managed con DLP_RCLONE; wsl:verify | Backend WebDAV HTTPS verificado. Sin rclone instalado, su escenario queda omitido |
| CU-08 SFTP/SCP | wsl:verify; perfil de salida en VM aislada | Bloqueo por canal/destino, no lectura del contenido cifrado SSH |
| CU-09 FTP claro | wsl:verify, Suricata/Wazuh y firewall | IDS detecta; firewall previene el canal. Se necesitan ambos para atribuir ambos efectos |
| CU-10 DNS | wsl:verify y resolver autorizado | Dominio/tipo/longitud/frecuencia; anomalía no demuestra que haya datos sensibles |
| CU-11 archivo cifrado | Subir un ZIP cifrado de laboratorio / GPG, más test:managed | Retenido como no inspeccionable, no «descifrado y detectado» |
| CU-12 evasión | renombrado.jpg y base64_privado.txt; tests | Firma real, decodificación y rechazo de parciales; sin OCR ni reconstrucción arbitraria |

Para rclone, antes de test:managed indica su ejecutable real, por ejemplo:

```powershell
$env:DLP_RCLONE = 'C:\herramientas\rclone\rclone.exe'
npm.cmd run test:managed
```

## 6. WhatsApp Desktop y controles nativos

No se implementó inspección selectiva de adjuntos dentro de WhatsApp Desktop.
El control disponible bloquea la red COMPLETA de los EXE seleccionados, también mensajes/archivos públicos.
La extensión de navegador no protege una aplicación nativa. Observación de procesos tampoco equivale a bloqueo.

Estos comandos solo descubren y muestran el plan, sin bloquear:

```powershell
npm.cmd run applications:discover
npm.cmd run applications:plan
```

Abre WhatsApp antes de Discover y revisa las rutas. El plan puede incluir también Discord; no lo apliques a ciegas.
Para seleccionar únicamente un EXE usa `-Programs 'C:\RUTA_REAL_DESCUBIERTA\WhatsApp.exe'`.
Una actualización o ejecutable auxiliar puede cambiar la cobertura; Audit no sustituye la prueba de red real.

**Solo en una VM Windows de laboratorio, PowerShell como administrador, y tras revisar las rutas:**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\endpoint\windows\Native-Apps.ps1 -Action Apply -Programs 'C:\RUTA_REAL_DESCUBIERTA\WhatsApp.exe' -ConfirmBlockApplications
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\endpoint\windows\Native-Apps.ps1 -Action Audit
```

Intenta enviar tanto público como sensible: ambos deben fallar si la aplicación y todos sus emisores están cubiertos.
No presentes esto como filtrado de contenido. Restaurar las reglas propias:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\endpoint\windows\Native-Apps.ps1 -Action Restore
```

USB físico (también todo el canal): consulta primero `System-Controls.ps1 -Action Plan -Controls USBWrite`.
En la VM administrativa usa Apply; comprueba el pendrive y después Restore. Puede requerir reconexión/reinicio.
No uses Protection.ps1 Apply en tu Windows personal: exige endpoint aislado y gateway separado y restringe la red completa.
Consulta PROTECCION_APLICACIONES_Y_SALIDAS.md para plan, alcance y restauración.

## 7. Interpretar resultados correctamente

- **Detectado**: sensibilidad reconocida por reglas/modelo.
- **Retenido por análisis incompleto**: faltó extracción, clave, central o respuesta; no es sensibilidad demostrada.
- **Bloqueo ejecutado**: requiere recibo del conector y ausencia de recepción, no solo una decisión central.
- **Observado**: un proceso/copia/tráfico ya ocurrió; no equivale a prevenirlo.
- **Prueba omitida/fallida**: no acredita cobertura, aunque el script exista.

Al actualizar: reinicia agente, sincroniza central, reconstruye/recarga extensión y refresca las pestañas una vez.
Después de cada rechazo normal ya no debe ser necesario refrescar; si una web específica sigue esperando, registra navegador, versión, aviso y pasos con datos ficticios para una prueba de compatibilidad propia.
