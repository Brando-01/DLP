# Ampliación administrada: alcance y evidencia

Objetivo acordado: agente de Windows y controles de salida con doce escenarios, clasificación híbrida por reglas y Groq, consola central, integración Wazuh y despliegue reproducible. La clave Groq se introduce localmente al final; las pruebas previas utilizan datos ficticios y respuestas del proveedor identificadas como simuladas.

## Entregables implementados

- [x] Clasificación semántica con JSON validado, caché, límites, lectura completa y cierre ante error. Contrato probado con respuestas simuladas; la ausencia de clave no equivale a información pública.
- [x] Detección de formato real, archivos cifrados, decodificación acotada y restricción conservadora de cargas parciales.
- [x] API central con credenciales por función, destinos y decisiones/recibos separados.
- [x] Proxy HTTPS previo al reenvío y comprobación de receptor independiente.
- [x] Postfix y filtro SMTP MIME: cuerpo y adjuntos XLSX comprobados.
- [x] Agente Windows: copias observadas por hash, telemetría y scripts reversibles. Las políticas generales se entregan sin aplicarlas al anfitrión.
- [x] Wazuh, Samba, Suricata y DNS comprobados; Sysmon preparado para instalar en el Windows destino.
- [x] FTP, SSH, HTTPS/WebDAV y correo de laboratorio con pruebas reales y datos ficticios.
- [x] Instalación, preflight, matriz de doce casos y PDF actualizado.

## Verificación del 28 de octubre de 2026

40 pruebas Node; 5 pruebas Python; 16 escenarios HTTPS/SMTP/rclone con receptores independientes; 17 comprobaciones del despliegue Linux sobre WSL2; 8 escenarios Chromium; 135 operaciones del agente con adaptadores simulados identificados donde corresponde; impresión Windows real a PDF. Los JSON de output/evaluacion conservan el alcance y las limitaciones. La batería Linux final tiene passed=true y modeRestored=true.

Pendiente de la clave del usuario: conectividad y exactitud de Groq en vivo. Pendiente del equipo de destino: USB físico, Apply administrativo, incorporación de Sysmon/agente Wazuh y prueba de las aplicaciones concretas. Estas comprobaciones no se sustituyen por una captura de configuración.

## Contratos de cobertura

CU-01: política Windows para bloquear escritura USB de todo el canal; selección por contenido en operaciones mediadas. CU-02: detección y correlación de copias nativas; no atribuir bloqueo previo a una observación posterior. CU-03/04: SMTP obligatorio con filtro MIME. CU-05/06: proxy HTTPS obligatorio. CU-07: verificar rclone contra el backend de prueba; no inferir todos sus backends. CU-08: restricción del canal SSH por destino. CU-09: firmas Suricata en FTP visible y bloqueo solo con IPS inline o firewall. CU-10: DNS autorizado, análisis y restricción del canal; un volumen anómalo no demuestra contenido confidencial. CU-11: restricción por no inspección, distinta de sensibilidad. CU-12: formato real y codificación inspeccionados; no prometer reconstrucción de cualquier fragmentación arbitraria.

Una instalación de Wazuh no constituye un punto preventivo universal. Una máquina con privilegios administrativos puede modificar estos controles. Para inspección selectiva universal de copias nativas harían falta componentes adicionales de sistema; el programa debe informar la cobertura que tiene efectivamente desplegada.

## Infraestructura observada

Windows con Node.js 24.15.0 y filtros Python disponibles. Docker Desktop presentó un error de acceso a su socket y VirtualBox pausas con Hyper-V. El despliegue final funciona en la nueva distribución DLP-Control-WSL, con Docker/Compose propios. La alternativa VirtualBox queda apagada. El agente Windows y la consola central están activos; no se modificaron automáticamente las políticas generales de Windows ni se instaló la CA en el sistema. No se proporcionó una clave Groq.
