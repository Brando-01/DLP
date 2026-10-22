"""Informe universitario de la implementación endpoint y su evidencia verificable."""
import json
from html import escape
from pathlib import Path
from datetime import datetime
import generar_informe_pdf as base
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.platypus import Paragraph

ROOT = Path(__file__).resolve().parents[1]
base.OUT = ROOT / 'output/pdf/Informe_DLP_Endpoint.pdf'
CW, M, PW, PH = base.CW, base.M, base.PW, base.PH


class EndpointReport(base.Report):
    def __init__(self):
        super().__init__()
        self.c.setTitle('Detección y prevención de fuga de información en un endpoint Windows')
        self.c.setSubject('Arquitectura, casos de uso, controles y evaluación del laboratorio DLP')

    def new(self, section=''):
        super().new(section)
        self.c.setFillColor(base.colors.white)
        self.c.rect(M, PH - 45, CW, 16, stroke=0, fill=1)
        self.c.setFillColor(base.GRAY)
        self.c.setFont('ArialDoc', 8.1)
        self.c.drawString(M, PH - 39, 'DLP DE ENDPOINT WINDOWS | ARQUITECTURA Y EVALUACIÓN')


def network(f):
    f.rect(0, 0, CW, 287)
    f.text(CW/2, 17, 'Equipo Windows protegido: sesión interactiva del usuario', bold=True)
    f.rect(15, 39, 132, 56, ['Navegador + extensión', 'Sitios HTTP / HTTPS'])
    f.rect(174, 39, 130, 56, ['Agente local Node.js', '127.0.0.1:3001'])
    f.line([(147, 67), (174, 67)], arrow=True)
    f.text(239, 113, 'API autenticada, solo loopback', size=8)
    f.rect(15, 140, 132, 56, ['Carpetas protegidas', 'TXT, PDF, DOCX, XLSX...'])
    f.line([(147, 168), (160, 168), (160, 84), (174, 84)], arrow=True)
    f.rect(174, 140, 130, 56, ['Sensor PowerShell', 'Portapapeles e impresión'])
    f.line([(239, 95), (239, 140)], arrow=True)
    f.rect(331, 39, 125, 56, ['Destino de prueba', 'HTTP / recurso / USB'])
    f.line([(304, 67), (331, 67)], arrow=True)
    f.text(393, 113, 'Solo envíos autorizados', size=7.8)
    f.cylinder(331, 140, 125, 56, ['Estado local y auditoría', 'datos-endpoint/'])
    f.line([(304, 87), (317, 87), (317, 166), (331, 166)], arrow=True)
    f.rect(15, 225, 289, 40, ['Portal adicional: 0.0.0.0:3000', 'No es el panel administrativo'], size=8.4)
    f.rect(331, 225, 125, 40, ['Kali opcional', 'Red Host-only'])
    f.line([(331, 245), (304, 245)], arrow=True)


def components(f):
    f.rect(144, 0, 185, 34, ['Panel local / conector web'], fill=base.LIGHT)
    f.line([(236, 34), (236, 56)], arrow=True)
    f.rect(144, 56, 185, 44, ['API local y autenticación', 'endpoint/server.js'])
    f.line([(236, 100), (236, 121)], arrow=True)
    f.rect(144, 121, 185, 49, ['Orquestador de operaciones', 'endpoint/runtime.js'])
    f.rect(0, 121, 115, 49, ['Vigilante de carpetas', 'Inventario y escaneo'], size=8.1)
    f.line([(115, 146), (144, 146)], arrow=True)
    f.rect(359, 121, 112, 49, ['Auditoría encadenada', 'lib/audit.js'], size=8.1)
    f.line([(329, 146), (359, 146)], arrow=True)
    f.rect(144, 196, 185, 48, ['Worker: extracción limitada', 'Texto / PDF / Office'])
    f.line([(236, 170), (236, 196)], arrow=True)
    f.rect(144, 270, 185, 44, ['Reglas y política por canal', 'classifier.js + policy.js'])
    f.line([(236, 244), (236, 270)], arrow=True)
    f.rect(0, 351, 139, 47, ['Adaptador de archivos', 'USB / UNC'], size=8.2)
    f.rect(166, 351, 139, 47, ['Adaptador HTTP', 'Receptor independiente'], size=8.2)
    f.rect(332, 351, 139, 47, ['Puente Windows', 'Sensor.ps1'], size=8.2)
    for x in [69, 236, 401]: f.line([(236, 314), (236, 331), (x, 331), (x, 351)], arrow=True)


def usecases(f):
    f.rect(90, 0, 297, 338)
    f.text(239, 18, 'Sistema DLP de endpoint', bold=True)
    f.actor(28, 94, ['Usuario', 'de prueba'])
    f.actor(443, 94, ['Operador /', 'evaluador'])
    cases = [(107, 40, ['CU-01 Inventariar', 'y clasificar']), (249, 40, ['CU-02 Configurar', 'políticas y carpetas']),
             (107, 119, ['CU-03 Transferir', 'por un canal mediado']), (249, 119, ['CU-04 Inspeccionar', 'interacción web']),
             (107, 198, ['CU-05 Observar', 'actividad nativa']), (249, 198, ['CU-06 Auditar', 'y exportar eventos'])]
    for x, y, lines in cases: f.ellipse(x, y, 121, 53, lines, size=8.2)
    for y in [66,145,224]: f.line([(40, 118), (107, y)])
    for y in [66,145,224]: f.line([(431, 118), (370, y)])
    f.rect(107, 282, 263, 37, ['CU-07 Evaluar errores y efectos', 'CU-08 Administrar arranque y controles generales'], size=8)
    f.line([(431, 118), (401, 118), (401, 301), (370, 301)])


def flow(f):
    f.ellipse(156, 0, 160, 28, 'Solicitud de transferencia')
    f.line([(236,28),(236,49)], arrow=True)
    f.rect(156,49,160,42,['Leer instantánea del archivo','Validar alcance y tamaño'])
    f.line([(236,91),(236,111)],arrow=True)
    f.rect(156,111,160,43,['Extraer texto en un worker','Tiempo y memoria acotados'])
    f.line([(236,154),(236,179)],arrow=True)
    f.diamond(236,207,132,56,['¿Extracción','completa?'])
    f.line([(170,207),(74,207),(74,262)],arrow=True)
    f.text(122,198,'No',size=8)
    f.rect(1,262,145,48,['NO ANALIZABLE / PARCIAL','Enforce: retener','Audit/alert: advertir'],size=7.9)
    f.line([(236,235),(236,262)],arrow=True)
    f.text(248,252,'Sí',size=8)
    f.rect(165,262,143,48,['Aplicar once reglas','Puntaje y clasificación'],size=8.2)
    f.line([(236,310),(236,339)],arrow=True)
    f.rect(165,339,143,42,['Decidir según el canal','Modo y umbral'])
    f.line([(74,310),(74,360),(165,360)],arrow=True)
    f.line([(236,381),(236,404)],arrow=True)
    f.diamond(236,431,114,54,['¿Operación','permitida?'])
    f.line([(179,431),(74,431),(74,482)],arrow=True)
    f.text(122,422,'No',size=8)
    f.rect(1,482,145,42,['Registrar PREVENTED','No llamar al adaptador'],size=8.1)
    f.line([(293,431),(397,431),(397,482)],arrow=True)
    f.text(341,422,'Sí',size=8)
    f.rect(325,482,146,42,['Registrar PREPARED','Ejecutar y guardar resultado'],size=8.1)


def sequence(f):
    xs=[45,173,301,431]
    for x,label in zip(xs,['Página web','Extensión','Agente local','Receptor']):
        f.rect(x-41,0,82,30,label,size=8)
        f.line([(x,30),(x,432)],dashed=True,width=.45)
    def msg(a,b,y,label,dashed=False):
        f.line([(a,y),(b,y)],arrow=True,dashed=dashed)
        f.text((a+b)/2,y-6,label,size=7.9,background=True)
    msg(45,173,65,'Selección privada de archivo')
    msg(173,301,105,'Inspección local autenticada')
    msg(301,173,145,'Decisión y ticket',True)
    f.rect(3,169,467,126)
    f.text(20,183,'alt',bold=True,align='left',size=8)
    f.text(75,183,'[denegado]',align='left',size=8)
    msg(173,45,210,'Vaciar selección / retener',True)
    msg(173,301,242,'CANCELLED: resultado del conector')
    f.text(354,275,'El receptor no recibe bytes',size=8)
    msg(173,45,326,'[permitido] Liberar archivo',True)
    msg(45,431,366,'Envío normal de la página')
    msg(431,45,406,'Recibo y hash del destino',True)


def main():
    data=json.loads((ROOT/'output/evaluacion/resultado-endpoint.json').read_text(encoding='utf-8'))
    native=json.loads((ROOT/'output/evaluacion/resultado-windows.json').read_text(encoding='utf-8'))
    browserfile=ROOT/'output/evaluacion/resultado-navegador.json'
    browser=json.loads(browserfile.read_text(encoding='utf-8')) if browserfile.exists() else None
    r=EndpointReport(); r.page=1; c=r.c
    c.bookmarkPage('cover'); c.addOutlineEntry('Portada','cover',0)
    c.setFillColor(base.INK); c.setFont('ArialDoc',11)
    c.drawCentredString(PW/2,PH-105,'PROYECTO ACADÉMICO DE CIBERSEGURIDAD')
    c.setLineWidth(.8); c.line(M+55,PH-132,PW-M-55,PH-132)
    title=Paragraph('Detección y prevención<br/>de fuga de información<br/>en un endpoint Windows',ParagraphStyle('CoverEndpoint',fontName='TimesDoc-Bold',fontSize=27,leading=34,alignment=TA_CENTER))
    _,h=title.wrap(CW,300); title.drawOn(c,M,PH-229-h)
    sub=Paragraph('Arquitectura del sistema, casos de uso<br/>y evaluación experimental de controles DLP',ParagraphStyle('SubEndpoint',fontName='TimesDoc',fontSize=15,leading=22,alignment=TA_CENTER))
    _,h=sub.wrap(CW,150); sub.drawOn(c,M,PH-399-h)
    c.setFont('TimesDoc',12)
    for y,line in [(555,'Implementación local Windows / Node.js / PowerShell'),(581,'Versión del sistema: 2.0.0'),(654,'Octubre de 2026')]: c.drawCentredString(PW/2,PH-y,line)
    c.setFont('TimesDoc-Italic',10)
    c.drawCentredString(PW/2,85,'Datos ficticios, escenarios autorizados y límites de cobertura explícitos')
    r.y=730

    r.new('Resumen e índice')
    r.p('Se implementó un laboratorio de prevención de fuga de información (DLP) en Windows. El sistema clasifica archivos locales, vigila carpetas configuradas y aplica políticas antes de ejecutar transferencias mediadas. Un complemento extiende el control a interacciones soportadas del navegador; un sensor nativo observa portapapeles, dispositivos e impresión. Se conservó el portal Windows/Kali como canal adicional.')
    r.p('La evaluación utiliza 27 documentos ficticios y 135 operaciones en cinco canales. Distingue sensibilidad detectada de una restricción por extracción incompleta, y separa una decisión de política de la evidencia de su ejecución. La impresión virtual se verificó con Windows. Los resultados describen un prototipo académico, no protección selectiva universal de toda aplicación o protocolo.')
    r.table(['Contenido','Página'],[[a,str(b)] for a,b in [
        ('1. Requisitos y alcance',3),('2. Arquitectura de red',4),('3. Componentes y límites de confianza',5),('4. Modelo de casos de uso',6),('5. Especificación de casos de uso',7),('6. Clasificación y políticas',8),('7. Flujo de una transferencia',9),('8. Secuencia del navegador',10),('9. Integración con Windows',11),('10. Evaluación multicanal',12),('11. Evidencia funcional y nativa',13),('12. Instalación y demostración',14),('13. Seguridad y limitaciones',15),('14. Conclusiones y referencias',16)]],[CW-60,60])

    r.new('1. Requisitos y alcance')
    r.p('<b>Consigna.</b> Implementar controles DLP, clasificar información sensible y ejecutar escenarios controlados de transferencia o exfiltración para determinar actividades permitidas, detectadas, alertadas o bloqueadas; evaluar falsos positivos y falsos negativos.')
    r.table(['Requisito','Implementación y comprobación'],[
        ['Clasificar información sensible','Once reglas compartidas; lectura de texto, PDF, DOCX y XLSX. Inventario local y reclasificación antes de transferir.'],
        ['PERMITIDO','Documento sin coincidencias, inspección completa y operación habilitada. Se contrasta con bytes recibidos o escritos.'],
        ['DETECTADO','Modo audit: existe coincidencia pero se permite la operación. La vigilancia de carpetas es detección, no bloqueo de copias.'],
        ['ALERTA','Modo alert o puntaje inferior al umbral: se registra la observación y se permite la operación.'],
        ['BLOQUEADO','El camino mediado no invoca el adaptador; el conector retiene la interacción soportada. Se verifica el destino por separado.'],
        ['Falsos positivos / negativos','Etiquetas de referencia declaradas por propósito del caso; matrices separadas para detección y prevención.']
    ],[125,CW-125],'Tabla 1. Trazabilidad de la consigna a funciones verificables')
    r.h('Delimitación del término endpoint',2)
    r.p('El agente funciona en la sesión del usuario y fuera del portal. No instala un filtro de sistema de archivos, controlador de red ni protección antimanipulación. La prevención selectiva se limita a caminos mediados y al conector; los controles generales opcionales de Windows afectan todo el canal. No se presenta este diseño como un antivirus ni como detector universal de archivos maliciosos.')

    r.new('2. Arquitectura de red')
    r.fig(290,network,1,'Despliegue local y canal adicional Windows/Kali.','El agente administrativo permanece en loopback. Las flechas describen comunicación o lectura, no cobertura universal. Elaboración a partir del código del proyecto [1].')
    r.table(['Servicio','Dirección predeterminada','Finalidad'],[
        ['Agente y panel','127.0.0.1:3001','Administrar inventario, políticas y auditoría; consulta del complemento.'],
        ['Portal histórico','0.0.0.0:3000','Pruebas desde Windows/Kali. No exponer a Internet.'],
        ['Receptor HTTP','127.0.0.1:4100','Recibir bytes de transferencias permitidas.'],
        ['Sitio independiente','127.0.0.1:4200','Demostrar que el control proviene del complemento y no del destino.']
    ],[93,139,CW-232],'Tabla 2. Superficies de red de la demostración')
    r.p('Kali es opcional. En Host-only utiliza la IP de Windows para el puerto 3000, no localhost. La dirección 192.168.56.1 corresponde a la configuración previa del laboratorio y debe verificarse en cada equipo. Un receptor en Kali puede configurarse como destino autorizado sin publicar el panel 3001.',small=True)

    r.new('3. Componentes y límites de confianza')
    r.fig(402,components,2,'Separación entre orquestación, extracción, decisión y ejecución.','La política se evalúa antes del adaptador. Los workers acotan recursos, pero no son una sandbox de seguridad equivalente a una máquina virtual. Fuente: endpoint/ y lib/ [1].')
    r.p('El panel utiliza un token administrativo; el conector dispone de un token distinto y restringido a inspección y resultados. El agente valida Host y origen, limita entradas y concurrencia. El contenido se procesa localmente y no se remite a servicios de IA. El receptor de laboratorio no constituye un servicio de producción autenticado.')
    r.p('La lectura produce una instantánea de bytes: esa misma instantánea se clasifica y, si procede, se transfiere. No se utiliza como autorización un puntaje almacenado previamente en el inventario. El registro incluye hash, reglas, decisión y tipo de evidencia, no una copia completa del documento.',small=True)

    r.new('4. Modelo de casos de uso')
    r.fig(342,usecases,3,'Funciones del usuario de prueba y del operador/evaluador.','Los actores son responsabilidades de uso, no roles multiusuario con permisos empresariales. El mantenimiento de políticas generales exige privilegios administrativos [1].')
    r.table(['Actor','Responsabilidad'],[
        ['Usuario de prueba','Trabajar con documentos ficticios y ejecutar operaciones permitidas por los caminos cubiertos.'],
        ['Operador / evaluador','Configurar raíces y destinos, revisar eventos, ejecutar baterías y contrastar evidencias.'],
        ['Windows / navegador / destino','Sistemas colaboradores: exponen eventos, ejecutan efectos o aportan recibos independientes.']
    ],[122,CW-122],'Tabla 3. Responsabilidades de los participantes')
    r.p('CU-08 no se activa de forma automática: instalar arranque o políticas generales requiere una decisión explícita del operador. El conjunto de casos de uso evita confundir una notificación posterior al hecho con la cancelación de una transferencia.',small=True)

    r.new('5. Especificación de casos de uso')
    r.table(['Caso','Precondición, flujo y resultado'],[
        ['CU-01 Inventariar','Raíz accesible configurada. Recorrer archivos, extraer texto, clasificar y registrar hash/estado. Un cambio observado programa un nuevo escaneo. Si se alcanza el límite o faltan permisos se declara cobertura incompleta.'],
        ['CU-02 Configurar','Panel local autenticado. Validar JSON de carpetas, modos y destinos; guardar y reconfigurar vigilantes. No permite usar el token del navegador para administrar.'],
        ['CU-03 Transferir','Archivo inventariado y destino habilitado. Volver a leer y clasificar; registrar decisión. Si se deniega, no ejecutar el adaptador. Si se permite, registrar PREPARED y después COMPLETED o FAILED.'],
        ['CU-04 Interacción web','Complemento activo, página cubierta y token emparejado. Retener selección/pegado/arrastre; consultar al agente; liberar o cancelar; reportar resultado. Un ticket de decisión no prueba recepción en el destino.'],
        ['CU-05 Observar Windows','Sesión interactiva y sensor disponible. Detectar portapapeles después de copiar y metadatos de trabajos externos. No atribuir bloqueo previo. La limpieza opcional se registra como remediación reactiva.'],
        ['CU-06 Auditar','Leer decisiones y resultados, comprobar cadena SHA-256 y exportar CSV. Una cadena alterada impide nuevas operaciones que requieren registro previo. No equivale a firma digital.'],
        ['CU-07 Evaluar','Crear datos ficticios etiquetados; ejecutar canales y contrastar recibos, archivos y hashes. Calcular VP, FP, VN y FN, conservando los casos que fallan.'],
        ['CU-08 Administrar','Consultar Plan sin cambios. Instalar arranque voluntario o aplicar/restaurar controles generales como administrador. Conservar respaldo y verificar el efecto en dispositivos propios.']
    ],[101,CW-101],'Tabla 4. Contratos funcionales y alternativas relevantes')

    r.new('6. Clasificación y políticas')
    r.p('Cada regla coincidente aporta sus puntos una sola vez por archivo. El puntaje es un criterio de política, no una probabilidad de privacidad. No se verifica identidad contra un padrón ni se comprende todo contexto semántico. Un dato puede ser privado aunque ninguna regla lo reconozca.')
    r.table(['Regla','Indicador','Puntos'],[
        ['001','Campo de clasificación confidencial','3'],['002','Campo de clasificación restringida','5'],['003','Código de estudiante de ocho dígitos','2'],['004','Nota final entre 0 y 20','2'],['005','Correo del dominio ficticio universidad.edu.pe','1'],['006','Etiqueta de contraseña temporal','3'],['007','Nombre de estudiante y calificación final en texto','3'],['008','Campo DNI con ocho dígitos','3'],['009','Campo de contraseña, secreto o token','4'],['010','Secuencia de tarjeta que satisface Luhn','5'],['011','Etiqueta de diagnóstico o historia clínica','3']
    ],[52,CW-105,53],'Tabla 5. Reglas DLP-001 a DLP-011 de lib/classifier.js')
    r.table(['Modo','Efecto ante coincidencia'],[['audit','DETECTADO: permite y registra.'],['alert','ALERTA: permite y registra.'],['enforce','Bloquea al alcanzar blockScore; por defecto 3. Con 1-2 alerta; con 0 permite si la extracción es completa.']],[75,CW-75],'Tabla 6. Política independiente por canal')
    r.p('Una extracción parcial o no analizable se retiene en enforce incluso con puntaje cero. No se etiqueta como sensibilidad reconocida. En audit/alert puede permitirse con advertencia. Un JSON con código de estudiante y nota suma cuatro puntos aunque no incluya la palabra confidencial.',small=True,after=2)

    r.new('7. Flujo de una transferencia')
    r.fig(529,flow,4,'Validación, clasificación y ejecución condicional.','La falta de extracción completa es un estado explícito. El resultado de política se conserva separado del resultado operativo. Fuente: EndpointRuntime.transfer y decide [1].')
    r.p('Los fallos del adaptador producen FAILED/ERROR, no una transferencia completada ni un bloqueo por contenido. El agente no conserva los bytes sensibles en el registro de auditoría; puede conservar rutas, nombres y metadatos que también deben protegerse.',small=True)

    r.new('8. Secuencia del navegador')
    r.fig(437,sequence,5,'Retención por el conector y verificación independiente de recepción.','CANCELLED es un reporte del cliente. La batería contrasta adicionalmente que el receptor no recibió bytes; el complemento no conoce todas las APIs o aplicaciones [1, 5].')
    r.h('Alcance del punto de control',2)
    r.p('La selección interceptada utiliza un selector privado antes de entregar archivos al DOM de la página. El pegado de texto y el arrastre se inspeccionan y se reemiten si se permiten. La secuencia soportada puede interrumpirse si la página exige eventos de confianza o emplea mecanismos distintos.')
    r.p('Al desactivar una extensión no administrada se pierde este control. La demostración incluye ese control negativo y la indisponibilidad del agente. Las pruebas automatizadas de pegado y arrastre emplean eventos sintéticos: no certifican el portapapeles físico ni cada implementación de una página web.',small=True)

    r.new('9. Integración con Windows')
    r.table(['Canal','Control implementado','Límite de la afirmación'],[
        ['Archivos locales','Vigilante y escaneo de carpetas configuradas.','Detecta contenido y cambios; no intercepta cualquier lectura/copia del Explorador.'],
        ['USB / SMB','Escritura mediada con política previa; verificación de destino real cuando lab=false.','La batería usa directorios, no acredita hardware USB ni sesión SMB real.'],
        ['Portapapeles','Copia mediada, observación posterior y limpieza reactiva opcional.','Observar/limpiar después no demuestra prevención global de lectura.'],
        ['Impresión','Decisión previa al PrintDocument del agente; observación de metadatos externos.','No se clasifica el contenido de cualquier trabajo de otra aplicación.'],
        ['Políticas generales','Solo lectura USB; bloqueo de puertos SMB; Spooler detenido/deshabilitado.','Afectan datos públicos y sensibles. Deben aplicarse y comprobarse aparte.']
    ],[77,185,CW-262],'Tabla 7. Cobertura del endpoint y tipos de control')
    r.h('Activación, reversión y segundo plano',2)
    r.p('System-Controls.ps1 utiliza Plan por defecto, sin modificar Windows. Apply/Restore requieren administrador. Conserva estados previos y reglas propias identificadas; la restauración evita sobrescribir cambios que reconoce como ajenos. Reconexión o reinicio puede ser necesario para USB. El bloqueo SMB tradicional no cubre SMB sobre QUIC [4].')
    r.p('Install-Agent.ps1 ofrece Plan, Install y Uninstall para el inicio de sesión del usuario actual. No instala un controlador ni servicio privilegiado. La bandeja permite abrir el panel o detener el proceso. Estos mecanismos no impiden que un usuario con permisos cierre o modifique el agente.',small=True)

    r.new('10. Evaluación multicanal')
    r.p(f'La batería contiene {data["cases"]} documentos ficticios: diez públicos, quince sensibles y dos no analizables, uno público y otro privado. Los mismos documentos se repiten en cinco canales: {data["operations"]} operaciones. No son 135 documentos independientes. Las etiquetas se fijan por propósito y contenido; el conjunto es de desarrollo, no una prueba reservada de generalización.')
    r.p('Detección positiva exige una coincidencia de sensibilidad. Prevención positiva exige impedir la operación. Las métricas integrales incluyen los dos documentos sin extracción completa, mientras la segunda lectura restringe el cálculo a los 25 documentos completamente inspeccionados.')
    channel=data['channels'][0]
    rows=[]
    for label,key in [('Detección integral (27)','detection'),('Prevención integral (27)','prevention'),('Detección completa (25)','completeOnlyDetection'),('Prevención completa (25)','completeOnlyPrevention')]:
        d=channel[key]; rows.append([label,*[str(d[k]) for k in ['TP','FP','TN','FN']],f'{d["precision"]*100:.2f} %',f'{d["recall"]*100:.2f} %'])
    r.table(['Lectura','VP','FP','VN','FN','Precisión','Recall'],rows,[159,31,31,31,31,95,CW-378],'Tabla 8. Matrices por canal, con la política predeterminada')
    r.p('Los cinco canales comparten decisiones y por eso presentan las mismas matrices; su evidencia operativa es distinta. Precisión = VP / (VP + FP); recall = VP / (VP + FN). Estos porcentajes no son garantía de protección ni de reconocimiento contextual.',small=True)
    r.table(['Evidencia','Canales'],[['Escritura real en directorios de laboratorio','USB y carpeta compartida; no prueba física.'],['Receptor HTTP loopback independiente','Envío real y comprobación de hash.'],['Doble de prueba del adaptador nativo','Portapapeles e impresión de la batería multicanal.']],[225,CW-225],'Tabla 9. Naturaleza de la evidencia en las 135 operaciones')
    r.p('P07/P08/P09 producen falsos positivos de detección: ejemplo didáctico, correo público y tarjeta de prueba. S14/S15 no activan reglas pese a ser privados. S13 se detecta pero se permite. El cierre conservador de U01/U02 modifica prevención sin demostrar comprensión de contenido.',small=True)

    r.new('11. Evidencia funcional y nativa')
    r.p('La batería de software pasó 32 pruebas: portal, extracción de seis formatos, límites, política, inventario, vigilancia de una creación sin carga web, transferencias, autenticación/orígenes, separación de tokens, resultados del navegador e integridad de auditoría. Una prueba exitosa valida su aserción concreta, no todo comportamiento posible.')
    r.table(['Comprobación Windows','Resultado observado'],[
        ['Sensor en sesión interactiva','Disponible; tres impresoras instaladas; ningún dispositivo extraíble conectado.'],
        ['Documento sensible / Print to PDF','Bloqueado antes del adaptador nativo; cero llamadas de impresión para ese documento.'],
        ['Documento público / Print to PDF','PDF real generado por el controlador Windows; cabecera PDF y archivo no vacío verificados.'],
        ['Modificaciones generales','No se alteraron políticas USB/SMB/Spooler ni el portapapeles del usuario para esta prueba.']
    ],[184,CW-184],'Tabla 10. Evidencia adicional a los dobles de prueba')
    r.h('Prueba del complemento en navegador',2)
    if browser:
        r.p(f'La batería se ejecutó con Chromium {escape(browser["browser"])} en un perfil aislado y completó {browser["tests"]} escenarios. Comprobó selección sensible/pública, pegado sensible/público, arrastre sensible/público, complemento desactivado y agente fuera de línea.')
        r.p('El receptor independiente recibió únicamente los contenidos liberados, salvo en el control negativo con el complemento desactivado, donde recibió el sensible ficticio. La selección usa el selector del navegador; pegado y arrastre usan eventos DOM sintéticos. No se afirma una prueba de todas las páginas ni de Firefox.',small=True)
    else:
        r.p('La integración está implementada y las pruebas unitarias del conector pasan. La prueba extremo a extremo en Chromium aún no cuenta con un resultado guardado; no se presenta como verificada. La compatibilidad de Firefox tampoco se afirma sin ejecución.',small=True)
    r.p('Archivos de evidencia: output/evaluacion/resultado-endpoint.json, resultado-windows.json y resultado-navegador.json. Los resultados incluyen fecha y alcance; no se sustituyen por capturas de una interfaz que solo declara estar activa.',small=True)

    r.new('12. Instalación y demostración')
    r.h('Requisitos y arranque',2)
    r.p('Windows 10/11, Node.js 24 o superior y PowerShell 5.1 en sesión interactiva. Git es opcional con ZIP. Instalar dependencias con npm.cmd ci, generar la extensión con npm.cmd run extension:build y ejecutar npm.cmd start. Abrir http://127.0.0.1:3001. No se necesitan Ubuntu, base de datos ni API de pago.')
    r.items([
        'Mostrar inventario y crear un TXT ficticio en laboratorio/protegidos/. Esperar al vigilante sin cargarlo al portal.',
        'Transferir un público y un sensible a un destino de laboratorio; comprobar físicamente la carpeta de salida.',
        'Ejecutar npm.cmd run receiver y repetir contra HTTP; revisar recibos y hashes, no solo la decisión del panel.',
        'Emparejar el complemento desde la sección Navegador. Ejecutar npm.cmd run site:demo y abrir el puerto 4200. Comparar conector activo/desactivado.',
        'Imprimir mediante Microsoft Print to PDF y comprobar que solo el público produce un archivo. Revisar eventos de prevención y ejecución.',
        'Ejecutar npm.cmd test, npm.cmd run evaluate:endpoint y npm.cmd run test:windows. Explicar los errores de clasificación encontrados.'
    ])
    r.h('Comprobaciones físicas posteriores',2)
    r.p('Para USB real, conectar una unidad propia, confirmar tipo extraíble, configurar lab=false y contrastar escritura pública/bloqueo sensible por el agente. Para SMB, preparar un recurso UNC autorizado y verificar sus archivos desde el servidor. Si se desea bloquear copias nativas del canal completo, revisar y aplicar las políticas generales en una máquina de laboratorio, luego restaurarlas.')
    r.p('La prueba física no debe sustituirse por un destino local renombrado USB. Conservar evidencias del destino, configuración aplicada y resultado; no afirmar eficacia de una política solo porque el script terminó sin error.',small=True)

    r.new('13. Seguridad y limitaciones')
    r.table(['Aspecto','Tratamiento y limitación residual'],[
        ['Privacidad','Clasificación local; sin LLM externo. Inventario y eventos conservan nombres/rutas y deben protegerse con permisos del usuario.'],
        ['Integridad','Cadena SHA-256 y verificación antes de nuevas escrituras de auditoría. No es firma ni protección ante reconstrucción completa por un administrador.'],
        ['Archivos hostiles','Lectura limitada y worker sin ejecución intencional de documentos/macros. Las bibliotecas tienen superficie de ataque; no se garantiza ausencia de explotación o malware.'],
        ['Extracción incompleta','PDF escaneado, cifrado, formato desconocido, límites o errores producen estado explícito. Enforce retiene por no inspección; no se contabiliza como detección sensible.'],
        ['Cobertura de equipo','Raíces configuradas y accesibles, no todos los discos/usuarios. Sin filtro kernel, control universal de llamadas de red ni protección frente a evasión administrativa.'],
        ['Navegador','Extensión no administrada y flujos DOM soportados. Puede desactivarse; aplicaciones y APIs no interceptadas quedan fuera.'],
        ['Disponibilidad','Cierre conservador puede bloquear material público. El fallo del sensor o destino se informa, no se transforma en éxito.'],
        ['Modelo de clasificación','Reglas explicables pero frágiles a contexto, reformulación u ocultación. Los resultados de desarrollo no estiman todo documento futuro.']
    ],[102,CW-102],'Tabla 11. Riesgos y límites de las conclusiones')
    r.p('Un DLP empresarial puede incorporar controles de endpoint administrados, identidad, políticas centralizadas y puntos de interceptación adicionales. Microsoft documenta actividades de endpoint diferenciadas [2]; los filtros del sistema de archivos constituyen otra clase de integración [3]. Su existencia no permite atribuir esas capacidades a este prototipo.',small=True)

    r.new('14. Conclusiones y referencias')
    r.p('La implementación aborda la consigna mediante clasificación y escenarios controlados que distinguen permiso, detección, alerta y bloqueo. Amplía el portal a un agente local con vigilancia de carpetas, políticas por canal, conector web y sensor Windows. La evidencia verifica efectos concretos y conserva falsos positivos y negativos, en lugar de presentar el sistema como infalible.')
    r.p('La prevención selectiva está demostrada en caminos mediados y, si consta su batería final, en las interacciones probadas del complemento. La impresión virtual tiene evidencia nativa. No se acreditan USB/SMB físicos inexistentes durante la prueba, prevención global del portapapeles ni intercepción universal de aplicaciones. Las políticas generales permanecen opcionales y requieren comprobación separada.')
    refs=[
        '[1] Proyecto DLP. (2026). <i>Implementación endpoint, pruebas y resultados</i> [Código y materiales de desarrollo]. endpoint/, lib/, extension/, test/ y evaluacion/. Repositorio base: https://github.com/Brando-01/DLP. La evidencia de esta ampliación corresponde a los archivos locales de la versión 2.0.0; su publicación debe comprobarse por separado.',
        '[2] Microsoft. (s. f.). <i>Learn about Endpoint data loss prevention</i>. Microsoft Learn. https://learn.microsoft.com/en-us/purview/endpoint-dlp-learn-about',
        '[3] Microsoft. (s. f.). <i>About file system filter drivers</i>. Microsoft Learn. https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/about-file-system-filter-drivers',
        '[4] Microsoft. (s. f.). <i>Policy CSP - ADMX_RemovableStorage</i>. Microsoft Learn. https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-admx-removablestorage',
        '[5] Google. (s. f.). <i>Content scripts</i>. Chrome for Developers. https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts',
        '[6] Mozilla. (s. f.). <i>PDF.js: Getting started</i>. https://mozilla.github.io/pdf.js/getting_started/'
    ]
    for ref in refs: r.p(ref,small=True,after=9)
    r.p('Documentación elaborada en octubre de 2026. Fuentes técnicas consultadas durante la implementación. Todas las figuras son diagramas vectoriales construidos a partir del diseño y código; no representan certificación de un tercero.',small=True)
    r.finish(); print(f'PDF: {base.OUT}\nPáginas: {r.page}')


if __name__=='__main__': main()
