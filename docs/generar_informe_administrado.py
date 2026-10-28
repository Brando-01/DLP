"""Informe A4 de la version 3; diagramas vectoriales y resultados leidos del proyecto."""
import json
from pathlib import Path
from html import escape
from datetime import datetime
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/pdf/Informe_DLP_Administrado_v3.pdf'
W,H=A4; M=55; CW=W-2*M
INK=colors.HexColor('#17242c'); GRAY=colors.HexColor('#52616b'); ACCENT=colors.HexColor('#175b68'); LINE=colors.HexColor('#c5cdd0'); LIGHT=colors.HexColor('#eff3f4')
FONT=Path('C:/Windows/Fonts')
for name,file in [('Body','times.ttf'),('Bold','timesbd.ttf'),('UI','arial.ttf'),('UIBold','arialbd.ttf')]:
    pdfmetrics.registerFont(TTFont(name,str(FONT/file)))
pdfmetrics.registerFontFamily('Body',normal='Body',bold='Bold',italic='Body',boldItalic='Bold')
STYLE=ParagraphStyle('body',fontName='Body',fontSize=11,leading=15.2,textColor=INK,spaceAfter=8)
SMALL=ParagraphStyle('small',parent=STYLE,fontName='UI',fontSize=8.5,leading=11.5)
TABLE=ParagraphStyle('table',parent=SMALL,fontSize=8.1,leading=10.5)


class Report:
    def __init__(self):
        OUT.parent.mkdir(parents=True,exist_ok=True)
        self.c=canvas.Canvas(str(OUT),pagesize=A4); self.page=0; self.y=0
        self.c.setTitle('DLP administrado - arquitectura, casos de uso y verificacion')
        self.c.setAuthor('Proyecto academico DLP')
    def new(self,section):
        if self.page: self.c.showPage()
        self.page+=1; self.y=H-90
        self.c.setFillColor(ACCENT); self.c.setFont('UIBold',8); self.c.drawString(M,H-35,'DLP / LABORATORIO ADMINISTRADO')
        self.c.setFillColor(GRAY); self.c.setFont('UI',8); self.c.drawRightString(W-M,H-35,'ARQUITECTURA Y EVIDENCIA · V3')
        self.c.setStrokeColor(LINE); self.c.line(M,H-45,W-M,H-45)
        self.c.setFont('UI',8); self.c.drawString(M,29,'Octubre de 2026 | Datos ficticios y destinos de prueba')
        self.c.drawRightString(W-M,29,str(self.page))
        if section: self.title(section)
    def title(self,text):
        self.c.setFillColor(INK); self.c.setFont('UIBold',20); self.c.drawString(M,self.y,text); self.y-=29
    def heading(self,text):
        self.y-=5; self.c.setFillColor(ACCENT); self.c.setFont('UIBold',11); self.c.drawString(M,self.y,text); self.y-=19
    def p(self,text,small=False):
        p=Paragraph(text,SMALL if small else STYLE); _,h=p.wrap(CW,1000)
        if self.y-h<53: raise ValueError('Pagina desbordada: '+text[:70])
        p.drawOn(self.c,M,self.y-h); self.y-=h+8
    def table(self,head,rows,widths):
        data=[[Paragraph(escape(str(x)),TABLE) for x in row] for row in [head]+rows]
        t=Table(data,colWidths=widths,hAlign='LEFT')
        t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),LIGHT),('LINEBELOW',(0,0),(-1,0),.7,ACCENT),('LINEBELOW',(0,1),(-1,-1),.35,LINE),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
        _,height=t.wrap(CW,1000)
        if self.y-height<53: raise ValueError('Tabla desbordada')
        t.drawOn(self.c,M,self.y-height); self.y-=height+13
    def box(self,x,y,w,h,lines,fill=LIGHT):
        self.c.setStrokeColor(LINE); self.c.setFillColor(fill); self.c.rect(M+x,y,w,h,fill=1,stroke=1)
        self.c.setFillColor(INK); self.c.setFont('UI',9)
        for i,line in enumerate(lines):
            if pdfmetrics.stringWidth(line,'UI',9)>w-10: raise ValueError('Caja estrecha: '+line)
            self.c.drawCentredString(M+x+w/2,y+h/2+(len(lines)-1)*6-3-i*12,line)
    def arrow(self,x1,y1,x2,y2):
        import math
        self.c.setStrokeColor(GRAY); self.c.setLineWidth(.8); self.c.line(M+x1,y1,M+x2,y2)
        a=math.atan2(y2-y1,x2-x1)
        for v in [-.5,.5]: self.c.line(M+x2,y2,M+x2-5*math.cos(a+v),y2-5*math.sin(a+v))
    def save(self): self.c.save()


def load(name):
    p=ROOT/'output/evaluacion'/name
    return json.loads(p.read_text(encoding='utf-8-sig')) if p.exists() else None


def main():
    r=Report(); r.new('')
    r.y=H-145
    r.c.setFillColor(ACCENT); r.c.setFont('UIBold',10); r.c.drawString(M,r.y,'INFORME TÉCNICO DE IMPLEMENTACIÓN'); r.y-=55
    for line in ['Detección y prevención','de fuga de información']:
        r.c.setFillColor(INK); r.c.setFont('UIBold',29); r.c.drawString(M,r.y,line); r.y-=39
    r.y-=8; r.p('Agente Windows, controles de salida y clasificación híbrida con Groq')
    r.y-=30; r.table(['Objeto','Contenido'],[['Sistema','Laboratorio administrado de endpoint y red'],['Escenarios','Doce casos de uso de transferencia o exfiltración controlada'],['Evaluación','Detección, prevención, errores y evidencia de destino'],['Versión','3.0.0 - octubre de 2026']],[110,CW-110])
    r.p('El documento distingue los componentes implementados de su despliegue y validación. Una decisión de bloqueo, una alerta y una restricción ejecutada representan evidencias diferentes.')
    r.y-=18; r.p('Alcance académico: datos ficticios, receptores independientes y configuración reproducible. La exactitud del modelo con una clave real se evalúa por separado; no se atribuyen resultados de Groq a pruebas simuladas.',True)
    r.new('1. Propósito y modelo de control')
    r.p('El sistema clasifica información sensible y decide si una transferencia debe permitirse, alertarse o retenerse. La protección combina un agente local con puntos de control de red. La clasificación de privacidad no equivale a detección de archivos maliciosos.')
    r.heading('Actores y responsabilidades')
    r.table(['Actor','Responsabilidad'],[['Usuario de prueba','Crea documentos ficticios y ejecuta las transferencias.'],['Administrador','Configura carpetas, destinos, políticas y despliegue.'],['Evaluador','Fija etiquetas de referencia, comprueba receptores y calcula errores.'],['Conectores','Retienen las acciones soportadas y reportan su resultado.']],[115,CW-115])
    r.heading('Estados que deben distinguirse')
    r.table(['Estado','Significado verificable'],[['PERMITIDO','El canal admite la operación; comprobar aceptación y hash.'],['DETECTADO','Se reconoce un indicador en modo auditoría y se permite.'],['ALERTA','Existe indicador o actividad que exige revisión; puede permitirse.'],['BLOQUEADO','La política exige retener. Confirmar la cancelación o ausencia en destino.'],['NO INSPECCIONABLE','No se pudo examinar todo el contenido. La restricción no demuestra sensibilidad.']],[128,CW-128])
    r.p('Las copias nativas observadas después de escritura generan alertas. La prevención selectiva se acredita únicamente en operaciones mediadas o en controles de red que actúan antes de reenviar. USBWrite restringe el canal USB completo.',True)
    r.new('2. Arquitectura de red')
    r.p('DLP-Control-WSL aloja los servicios Linux sobre WSL2. Windows ejecuta el agente y accede a sus puertos locales. La alternativa VirtualBox se conserva apagada; otras VM necesitan una interfaz privada de laboratorio configurada explícitamente.')
    r.box(0,535,145,75,['Windows protegido','Agente / PowerShell','Aplicaciones del usuario'])
    r.box(190,535,140,75,['Gateway del laboratorio','HTTPS / SMTP / DNS','Proxy y filtros'])
    r.box(370,535,115,75,['Receptores ficticios','HTTPS / correo','FTP / SSH'])
    r.arrow(145,570,190,570); r.arrow(330,570,370,570)
    r.box(190,405,140,75,['Control central 3100','Extracción / reglas','Política y auditoría'])
    r.arrow(260,535,260,480)
    r.box(0,405,145,75,['Sysmon / sensores','Samba y Suricata','Wazuh manager'])
    r.arrow(145,440,190,440)
    r.box(370,405,115,75,['Groq externo','Esquema JSON','Solo texto necesario'])
    r.arrow(330,440,370,440)
    r.y=370; r.p('<b>Figura 1.</b> Topología lógica y rutas de decisión. Las flechas de red no representan inspección de todo protocolo cifrado.',True)
    r.table(['Interfaz','Servicios'],[['Acceso desde Windows','3100 central; 8080 proxy; 2525 SMTP; 1514/1515 Wazuh; 5300/UDP DNS de prueba. VirtualBox añade SSH en 2222.'],['Docker interna','172.30.50.0/24: cliente, receptores y sensores. El cliente restringe su salida al gateway.'],['Red de administración','Publicación de servicios autorizados; separada del namespace restringido del cliente.']],[130,CW-130])
    r.new('3. Clasificación y decisión')
    r.p('Cada conector retiene la acción mientras se verifica destino, formato, extracción y política. El motor trabaja sobre una instantánea; el agente comprueba el hash devuelto por el control para evitar confiar en un inventario antiguo.')
    steps=[['1  Validar destino y protocolo'],['2  Detectar formato real y extraer texto'],['3  Aplicar reglas locales'],['4  Groq si hace falta contexto'],['5  Combinar sin rebajar indicadores locales'],['6  Aplicar política del canal'],['7  Ejecutar o cancelar y registrar recibo']]
    y=583
    for i,s in enumerate(steps):
        r.box(80,y,325,36,s)
        if i<len(steps)-1: r.arrow(242,y,242,y-17)
        y-=53
    r.y=235
    r.heading('Reglas y modos')
    r.p('Por defecto: 0 puntos permite, 1-2 alerta y permite, 3 o más bloquea en enforce. En audit se detecta sin impedir; en alert se avisa y permite. Los puntos son reglas de decisión, no probabilidades.')
    r.p('Formato desconocido, extracción parcial, cifrado o fallo semántico se retienen en enforce. Deben contabilizarse por separado de una detección correcta de sensibilidad.',True)
    r.new('4. Integración con Groq')
    r.p('El modelo interpreta contenido privado que no contiene etiquetas ni patrones exactos. Recibe texto extraído, delimitado como entrada no confiable. No tiene herramientas, permisos sobre Windows ni instrucciones de ejecutar acciones.')
    r.table(['Contrato','Implementación'],[['Clases','PUBLICO, INTERNO, CONFIDENCIAL, RESTRINGIDO y NO_DETERMINADO.'],['Respuesta','JSON con propiedades y valores permitidos; validación adicional en el servidor.'],['Presupuesto','Hasta 48 000 caracteres, fragmentos de 6 000 y solapamiento de 256; máximo nueve fragmentos.'],['Disponibilidad','Dos consultas concurrentes, límite por llamada y 45 s por clasificación. Caché por hash durante 30 minutos.'],['Fallo','Clave ausente, cuota, error o ambigüedad retienen la salida en enforce. No se convierte el documento en público.'],['Privacidad','Los bloqueos locales fuertes evitan una consulta externa. No se persiste el texto del modelo en auditoría.']],[110,CW-110])
    r.heading('Activación al final')
    r.p('Configurar GROQ_API_KEY en el .env local. Ejecutar groq:check con un ejemplo ficticio, sincronizar la VM y luego evaluate:hybrid. La clave no se publica ni se introduce en la consola web.')
    r.p('Las pruebas automatizadas del contrato usan respuestas simuladas. Sin una clave y consultas reales no hay una medición de exactitud de Groq. Los límites y la disponibilidad de la cuenta gratuita deben comprobarse con el proveedor.',True)
    cases=[('01','USB','Transferencia mediada y política Windows.','Prueba física pendiente del equipo; política nativa restringe todo el canal.'),('02','Ruta no autorizada','Sensor de destino, hash y full_audit.','Alerta posterior; lectura Samba no prueba destino final.'),('03','Adjunto sensible','Postfix y filtro MIME con extracción.','Receptor SMTP aislado; formatos admitidos.'),('04','Cuerpo del correo','Decodificación MIME, asunto y texto.','250 permitido, 550 restringido, 451 si falla el motor.'),('05','Subida HTTPS','Proxy TLS y política central.','Requiere CA y rutas forzadas; verificar receptor.'),('06','Texto público web','Inspección de formularios y parámetros.','Protocolos no inspeccionables se retienen.'),('07','rclone','Proxy y restricción de rutas.','WebDAV HTTPS probado; otros backends por separado.'),('08','SCP / SFTP','Firewall por canal y destino.','No descifra el contenido SSH.'),('09','FTP claro','Suricata IDS y Wazuh.','Detecta flujo visible; prevención por firewall, no por IDS pasivo.'),('10','Túnel DNS','Resolver, dnsmasq y restricciones.','Anomalía no demuestra que los datos sean confidenciales.'),('11','Archivo cifrado','Política de contenido no inspeccionable.','Retención conservadora sin descifrar.'),('12','Evasión por formato','Firma real, base64 y rechazo parcial.','Sin OCR ni reconstrucción arbitraria de fragmentos.')]
    for page,subset in enumerate([cases[:6],cases[6:]],start=5):
        r.new(f'{page}. Casos de uso '+('01-06' if page==5 else '07-12'))
        r.table(['Caso y acción','Control','Criterio y límite'],[[f'CU-{i} {name}',control,limit] for i,name,control,limit in subset],[115,165,CW-280])
        r.heading('Escenario de prueba')
        r.p('Ejecutar un documento público y otro privado con el mismo canal y destino. Registrar la verdad de referencia antes de probar, la clasificación, el modo activo, la decisión y el efecto. Añadir un control negativo que confirme que el receptor funciona sin ese control.')
        r.p('Una restricción por destino, formato desconocido o falta de clave no se cuenta como reconocimiento de sensibilidad. Debe informarse su causa y el posible bloqueo de un documento público.',True)
    r.new('7. Verificación y errores')
    network=load('resultado-red-administrada.json'); linux=load('resultado-linux.json')
    rows=[['Pruebas funcionales','40 pruebas Node y 5 pruebas Python; verificar nuevamente con los comandos del repositorio.'],['HTTPS / SMTP / rclone',f"{network.get('tests',0)} escenarios de red reales. Groq en vivo: {network.get('groqLiveTested',False)}." if network else 'Sin resultado disponible.'],['Servicios Linux',f"{linux.get('tests',0)} comprobaciones superadas antes de terminar. Batería completa: {linux.get('passed',False)}. Modo restaurado: {linux.get('modeRestored',False)}." if linux else 'Prueba de despliegue pendiente.'],['Windows nativo','Plan y preparación de sensores disponibles. USB físico, firewall Apply y enrolamiento de otro equipo requieren verificación en su VM.'],['Groq real','Pendiente de clave y evaluación independiente. No se atribuyen resultados reales a respuestas simuladas.']]
    for row in rows: row[1]=row[1].replace('True','sí').replace('False','no')
    if linux: rows[2][1]+=' Entorno: '+linux.get('backend','Linux Docker')+'.'
    windows=load('resultado-windows.json')
    if windows and any(item.get('evidence')=='REAL_WINDOWS_PRINT_TO_PDF' for item in windows.get('tests',[])):
        rows[3][1]='Impresión pública real a PDF y retención previa del sensible verificadas. USB físico, firewall Apply y enrolamiento de otro equipo requieren prueba en su VM.'
    r.table(['Batería','Estado y lectura correcta'],rows,[125,CW-125])
    r.heading('Diseño de evaluación')
    r.p('Construir dos matrices de confusión: reconocimiento de sensibilidad y prevención de salida. Precisión = TP / (TP + FP); recall = TP / (TP + FN). Informar además latencia, errores, no inspeccionables y bloqueos públicos.')
    r.p('Las muestras actuales son de desarrollo. Repetir un documento en varios canales aumenta las operaciones, pero no crea documentos independientes. La evaluación semántica debe incluir casos nuevos, ambigüedad, formatos distintos e instrucciones incrustadas.')
    r.p('Fuentes de evidencia: auditoría encadenada; recibos de los conectores; hashes/bytes en receptor independiente; alertas Wazuh; firmas Suricata; eventos nativos. Las fuentes y sus límites deben acompañar cada conclusión.',True)
    r.new('8. Instalación, operación y límites')
    r.heading('Despliegue reproducible')
    r.p('Node.js 24+ para el agente. Docker Linux y Compose v2 para el sistema completo. La alternativa VirtualBox provisiona Ubuntu automáticamente. Python 3.12+ permite las pruebas y el laboratorio local reducido. setup genera credenciales y muestras sin imprimir claves.')
    r.p('Inicio preparado: wsl:start, wsl:sync, wsl:ca y agent. La consola usa el token administrativo local. wsl:verify prueba los servicios con reglas y restaura el modo configurado. Para otra PC exportar una configuración de endpoint sin la clave Groq ni el token de administración.')
    r.heading('Controles administrativos')
    r.p('Managed-Egress y System-Controls comienzan en Plan. Apply se reserva al Windows aislado, requiere administrador y conserva respaldo. Restore retira los cambios propios. Instalar Sysmon/Wazuh y configurar DNS/proxy/CA son pasos de despliegue del equipo protegido; no se realizaron silenciosamente en la PC principal.')
    r.heading('Límites de la implementación')
    r.p('No incorpora driver de kernel, OCR, descifrado ni protección frente a administradores. Las copias nativas son observadas después de escritura. Las aplicaciones con certificate pinning pueden no aceptar inspección TLS. La cobertura depende de los conectores y rutas efectivamente desplegados.')
    r.p('Los PDF de portal y endpoint v2 se conservan como históricos; este informe describe la ampliación administrada. La guía y el código fuente incluyen las rutas exactas y los comandos reproducibles.',True)
    r.new('9. Referencias técnicas')
    refs=[('Groq','Structured outputs','https://console.groq.com/docs/structured-outputs'),('Groq','Your data','https://console.groq.com/docs/your-data'),('mitmproxy','Event hooks','https://docs.mitmproxy.org/stable/api/events.html'),('Postfix','Before-queue content filter','https://www.postfix.org/SMTPD_PROXY_README.html'),('Wazuh','Docker deployment','https://documentation.wazuh.com/current/deployment-options/docker/wazuh-container.html'),('Microsoft','Sysmon','https://learn.microsoft.com/en-us/sysinternals/downloads/sysmon'),('Debian','Suricata packages','https://packages.debian.org/trixie/suricata')]
    for author,title,url in refs:
        r.p(f'<b>{author}.</b> {title}.<br/><link href="{escape(url)}" color="#175b68">{escape(url)}</link>',True)
    r.y-=15; r.heading('Trazabilidad del proyecto')
    r.p('Repositorio: github.com/Brando-01/DLP. Arquitectura ampliada: docs/ARQUITECTURA_ADMINISTRADA.md. Resultados: output/evaluacion/. Generador reproducible de este documento: docs/generar_informe_administrado.py.',True)
    r.save(); print(str(OUT))


if __name__=='__main__': main()
