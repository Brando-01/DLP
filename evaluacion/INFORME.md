# Evaluación del control DLP

Fecha de ejecución: 17 de octubre de 2026. Entorno: Node.js en Windows, con 20 transferencias HTTP a una instancia local aislada del servicio. Las pruebas visibles desde Kali se realizaron aparte en el portal de laboratorio.

## Objetivo y criterio de verdad

Se prepararon 20 archivos ficticios: 10 públicos y 10 sensibles. La clasificación real de cada archivo fue fijada por su propósito y contenido antes de ejecutar las reglas; está registrada en `casos.json`. Así se compara la decisión del DLP con una referencia independiente.

Para **detección**, se considera positivo `ALERTA` o `BLOQUEADO`. Para **prevención**, solo `BLOQUEADO` es positivo: `ALERTA` permite que el archivo se transfiera, aunque lo registre. Esta distinción evita presentar una alerta como si hubiera detenido la fuga.

## Resultados por archivo

| ID | Archivo | Verdad | Decisión | Puntaje | Interpretación |
| --- | --- | --- | --- | ---: | --- |
| B01 | horario_publico.txt | Público | PERMITIDO | 0 | Correcto |
| B02 | calendario_publico.txt | Público | PERMITIDO | 0 | Correcto |
| B03 | reglamento_publico.txt | Público | PERMITIDO | 0 | Correcto |
| B04 | mapa_campus.txt | Público | PERMITIDO | 0 | Correcto |
| B05 | aviso_biblioteca.txt | Público | PERMITIDO | 0 | Correcto |
| B06 | agenda_evento.json | Público | PERMITIDO | 0 | Correcto |
| B07 | catalogo_cursos.csv | Público | PERMITIDO | 0 | Correcto |
| B08 | preguntas_frecuentes.txt | Público | PERMITIDO | 0 | Correcto |
| B09 | ejemplo_politica.txt | Público | BLOQUEADO | 3 | Falso positivo: cita una etiqueta como ejemplo |
| B10 | tutorial_correo.txt | Público | ALERTA | 1 | Falso positivo de detección: correo ficticio de ejemplo |
| S01 | notas_confidenciales.csv | Sensible | BLOQUEADO | 7 | Correcto |
| S02 | acta_restringida.txt | Sensible | BLOQUEADO | 5 | Correcto |
| S03 | listado_estudiantes.csv | Sensible | BLOQUEADO | 4 | Correcto |
| S04 | credencial_temporal.txt | Sensible | BLOQUEADO | 3 | Correcto |
| S05 | reporte_confidencial.json | Sensible | BLOQUEADO | 3 | Correcto; regla JSON corregida |
| S06 | evaluacion_individual.txt | Sensible | BLOQUEADO | 4 | Correcto |
| S07 | acceso_restringido.json | Sensible | BLOQUEADO | 5 | Correcto; regla JSON corregida |
| S08 | planilla_notas.csv | Sensible | BLOQUEADO | 4 | Correcto |
| S09 | directorio_interno.txt | Sensible | ALERTA | 1 | Detectado, pero la transferencia se permite |
| S10 | notas_sin_etiquetas.txt | Sensible | BLOQUEADO | 3 | Regla DLP-007: estudiante junto con calificación en lenguaje corriente |

## Matriz de confusión y métricas

| Medición | VP | FP | VN | FN | Precisión | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Detección (`ALERTA` o `BLOQUEADO`) | 10 | 2 | 8 | 0 | 83,3 % | 100,0 % |
| Prevención (`BLOQUEADO`) | 9 | 1 | 9 | 1 | 90,0 % | 90,0 % |

`Precisión = VP / (VP + FP)`. `Recall = VP / (VP + FN)`.

Las 20 solicitudes generaron un evento. La verificación automática comprobó que todos los archivos bloqueados quedaron sin `storedName` y que la cantidad de archivos almacenados coincidió exactamente con las transferencias permitidas o con alerta.

## Hallazgos e interpretación

1. **Correcciones aplicadas:** En la primera ejecución, los JSON compactos S05 y S07 se permitieron incorrectamente: las comillas del campo `"clasificacion"` impedían el reconocimiento. Se ajustaron DLP-001 y DLP-002. Después se añadieron lectura de columnas CSV, campos JSON de código y nota, y DLP-007 para un estudiante con calificación expresada en texto. La detección evolucionó de 7 VP y 3 FN a 9 VP y 1 FN, y finalmente a 10 VP y 0 FN en este conjunto fijo de 20 casos.
2. **Falsos positivos restantes:** B09 contiene una etiqueta DLP citada con fines didácticos, y B10 usa un correo ficticio de muestra. El motor de patrones no entiende ese contexto. Una mejora futura sería exigir un campo de clasificación estructurado o un encabezado válido y distinguir ejemplos de datos reales.
3. **Límite del texto libre:** DLP-007 reconoce el patrón de estudiante con nombre y calificación final, pero otras formas de redactar datos privados pueden escapar a las reglas. El 100 % de recall se refiere solo a estos 20 archivos sintéticos; no demuestra detección perfecta en documentos nuevos.
4. **Alerta sin bloqueo:** S09 activa DLP-005, pero el puntaje 1 solo produce alerta. Por eso sigue siendo un falso negativo de **prevención**. Para una política de bloqueo sobre directorios internos se necesitaría otra regla o un umbral específico.

El alcance está limitado a cargas por este portal, archivos TXT/CSV/JSON de hasta 1 MB y texto UTF-8. No inspecciona correo, USB, otros sitios web, imágenes ni documentos Office/PDF. Los resultados corresponden a este conjunto sintético, no a una tasa de eficacia general.

## Reproducción y exposición

En Windows, desde la carpeta del proyecto, ejecuta `npm test` y `npm run evaluate`. La evaluación usa un puerto y una carpeta temporal; no modifica los registros visibles en el portal. Si se modificó el código, reinicia `npm start` antes de volver al navegador de Kali.

Para la demostración desde Kali, muestra primero `publico.txt`, `alerta.txt` y `confidencial.txt` en el portal. El portal ofrece archivos ficticios descargables para probar un JSON público, un JSON confidencial y un texto privado sin etiqueta. También puedes copiar archivos de `evaluacion/archivos/` al directorio `/home/kali/` mediante una carpeta compartida. En Windows, muestra `logs/eventos.jsonl` y `recibidos/` para verificar que un bloqueo genera registro sin guardar el archivo.

Conserva capturas del resultado del portal, la tabla de auditoría, la carpeta `recibidos/` y la salida de `npm run evaluate` como evidencia. No atribuyas los 20 casos a Kali: la batería automatizada se ejecuta localmente en Windows; desde Kali se demostraron manualmente los casos básicos y JSON.
