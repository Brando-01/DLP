# Laboratorio DLP: detección y prevención de fuga de información

Prototipo académico que inspecciona archivos TXT, CSV y JSON **antes de guardarlos**. Según reglas de contenido, cada intento queda como **PERMITIDO**, **ALERTA** o **BLOQUEADO**. Las decisiones y reglas activadas se muestran en el portal y se registran en un archivo de auditoría.

> Usa exclusivamente datos ficticios. Este control cubre las cargas hechas por su propio portal/API; no supervisa el resto de transferencias de la computadora ni sustituye un DLP empresarial.

## Qué instalar en otra computadora

1. [Node.js LTS](https://nodejs.org/en/download), que incluye `npm`. El proyecto se verificó con Node.js 24.15.0.
2. [Git](https://git-scm.com/downloads) para clonar el repositorio. Si descargas el ZIP desde GitHub, Git no es necesario para ejecutarlo.
3. Opcional: [VirtualBox](https://www.virtualbox.org/wiki/Downloads) y una VM Kali Linux para probar la transferencia desde otra máquina. **Ubuntu no es necesario**. La aplicación funciona también sin Kali, usando solo el navegador de la PC que ejecuta Node.js.

Comprueba la instalación de Node.js y npm en una terminal nueva:

```powershell
node --version
npm.cmd --version
```

En Windows se usa `npm.cmd` en los ejemplos para que funcionen incluso si PowerShell restringe `npm.ps1`. En Linux o macOS usa `npm`.

## Descargar y arrancar

Abre PowerShell en la carpeta donde quieres guardar el proyecto y ejecuta:

```powershell
git clone https://github.com/Brando-01/DLP.git
cd DLP
npm.cmd ci
npm.cmd start
```

Si descargaste un ZIP, extráelo, abre una terminal dentro de la carpeta que contiene `package.json` y ejecuta únicamente `npm.cmd ci` y `npm.cmd start`.

Con el servidor en marcha, abre **http://localhost:3000** en esa misma PC. Mantén la terminal abierta mientras usas el portal; para detener el servidor, pulsa `Ctrl+C`. No necesitas base de datos ni configurar claves. `npm ci` instala las versiones fijadas en `package-lock.json` y requiere conexión a internet la primera vez.

## Probar con los archivos incluidos

En el portal, pulsa **Selecciona un archivo de prueba** y usa los archivos de `public/ejemplos/`:

| Archivo | Resultado esperado | Motivo principal |
| --- | --- | --- |
| `prueba_json_publico.json` | PERMITIDO | No activa reglas de contenido sensible |
| `prueba_json_confidencial.json` | BLOQUEADO | Declara clasificación confidencial |
| `prueba_sin_etiqueta.txt` | BLOQUEADO | Combina datos de estudiante y nota aunque no diga «confidencial» |

También puedes usar los archivos de `muestras/`. El portal admite TXT, CSV y JSON de hasta 1 MB. Los archivos permitidos o en alerta se guardan en `recibidos/`; los bloqueados **no** se guardan. Cada intento se agrega a `logs/eventos.jsonl`. Estas carpetas se crean al ejecutar la aplicación y no se incluyen en GitHub.

### Pruebas automáticas y evaluación

En **otra terminal**, dentro de la carpeta del proyecto:

```powershell
npm.cmd test
npm.cmd run evaluate
```

La evaluación envía 20 archivos ficticios a una instancia HTTP local aislada, compara las decisiones con la clasificación esperada y verifica que los bloqueados no se guarden. No modifica los eventos ni los archivos recibidos del laboratorio principal. Los casos están en [`evaluacion/casos.json`](evaluacion/casos.json) y la interpretación de los resultados está en [`evaluacion/INFORME.md`](evaluacion/INFORME.md).

## Opcional: acceder desde Kali a Windows

En este escenario, **Windows ejecuta `npm.cmd start`** y Kali es únicamente el cliente que abre el portal o envía archivos. Configura ambas máquinas en una red privada Host-only de VirtualBox; Kali puede tener además un adaptador NAT para internet. En Windows ejecuta `ipconfig` e identifica la dirección IPv4 del adaptador Host-only. Desde Kali comprueba `ping IP-DE-WINDOWS` y abre `http://IP-DE-WINDOWS:3000` en Firefox. **No uses `localhost` en Kali**: apuntaría a Kali, no a Windows.

Si el ping funciona pero la página no abre, verifica que el servidor siga ejecutándose y permite Node.js o el puerto 3000 en el firewall de Windows **solo para la red privada del laboratorio**. Evita exponer este prototipo a internet. La dirección `192.168.56.1` fue la usada en una prueba, pero puede cambiar en otra PC.

Ejemplo de carga por terminal en Kali, desde la carpeta que contiene los archivos de prueba:

```bash
curl -F "archivo=@publico.txt" http://IP-DE-WINDOWS:3000/api/upload
curl -F "archivo=@confidencial.txt" http://IP-DE-WINDOWS:3000/api/upload
```

## Cómo decide

Las reglas y puntajes se definen en [`app.js`](app.js). Buscan etiquetas de clasificación y patrones como códigos de estudiante, notas, correos institucionales o contraseñas temporales. No «entienden» por sí solas toda información privada: pueden existir falsos positivos y falsos negativos.

| Puntaje | Decisión | Acción |
| ---: | --- | --- |
| 0 | PERMITIDO | Se almacena y registra |
| 1–2 | ALERTA | Se almacena y registra para revisión |
| 3 o más | BLOQUEADO | Se registra, pero no se almacena |

Después de modificar `app.js`, detén y reinicia `npm.cmd start` para cargar las nuevas reglas. Puedes cambiar el puerto con la variable de entorno `PORT` antes de arrancar.
