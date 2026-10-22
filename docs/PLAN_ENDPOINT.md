# Ampliación del laboratorio a DLP de endpoint

Objetivo: clasificar información sensible y comprobar, con evidencia independiente, actividades permitidas, detectadas, alertadas o bloqueadas, además de falsos positivos y negativos.

## Trabajo previsto

- [x] Clasificador compartido y extracción limitada de TXT/CSV/JSON/PDF/DOCX/XLSX; pruebas reales de PDF, DOCX y XLSX.
- [x] Agente local: inventario, vigilancia de carpetas configurables, API loopback autenticada y auditoría. La prueba de creación nueva verifica el vigilante.
- [x] Transferencias mediadas a destinos USB y red de laboratorio y receptor HTTP real; bloqueo antes de escribir o enviar.
- [x] Sensor Windows y puente: estado de unidades/impresoras, observación reactiva de portapapeles, impresión mediada, notificaciones e instalación opcional de arranque. Print to PDF público/sensible comprobado.
- [x] Complementos Chromium/Firefox generados para selección manual, pegado y arrastre en páginas cubiertas. Pruebas unitarias del conector verificadas.
- [x] Scripts opcionales de controles generales Windows con Plan/Apply/Restore y respaldo. Solo se ejecutó Plan; Apply/Restore no se probaron sobre esta PC.
- [x] Panel de estado, clasificación, configuración, actividades y cobertura por canal.
- [x] 32 pruebas funcionales y evaluación de 27 documentos x 5 canales, con etiquetas independientes del puntaje.
- [x] Guía de instalación, límites y PDF universitario de 16 páginas, con renderizado completo para revisión visual.
- [x] Prueba extremo a extremo en Chromium 151, perfil aislado: ocho escenarios y receptor independiente; resultado-navegador.json. Firefox queda sin prueba nativa.
- [ ] Validar USB y SMB físicos con hardware/recurso autorizado, si están disponibles; distinguirlos de los destinos de laboratorio.

## Reglas para interpretar la evidencia

1. Una notificación de cambio de archivo o un trabajo de impresión observado después de crearse es detección, no bloqueo previo.
2. El control de contenido en transferencias mediadas no equivale a interceptar cualquier copia del Explorador.
3. Los controles generales del sistema afectan el canal completo, incluso a archivos públicos. No son bloqueo selectivo por contenido.
4. La limpieza reactiva del portapapeles no demuestra que ninguna aplicación haya leído el contenido antes de la limpieza.
5. El complemento cubre interacciones soportadas del navegador; no garantiza cobertura de todas las APIs, aplicaciones o sitios.
6. Un formato desconocido, cifrado, ilegible o parcialmente extraído se informa como no analizable; no se clasifica silenciosamente como público.
7. USB, impresora y recursos SMB reales requieren comprobación con esos dispositivos. Las pruebas con destinos temporales se identifican como laboratorio, nunca como pruebas físicas.
8. Se conserva el portal existente como un canal adicional. Groq no se integra en esta ampliación.
