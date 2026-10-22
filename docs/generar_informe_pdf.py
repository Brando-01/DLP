"""Informe técnico del laboratorio DLP. Diagramas vectoriales y maquetación A4.

Dependencia de autoría: reportlab. El PDF final no requiere herramientas externas.
"""
from pathlib import Path
from math import atan2, cos, sin, pi
from html import escape

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY, TA_LEFT, TA_CENTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "Informe_tecnico_DLP.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)
FONT_DIR = Path("C:/Windows/Fonts")
for name, file in [("TimesDoc", "times.ttf"), ("TimesDoc-Bold", "timesbd.ttf"),
                   ("TimesDoc-Italic", "timesi.ttf"), ("ArialDoc", "arial.ttf"),
                   ("ArialDoc-Bold", "arialbd.ttf")]:
    pdfmetrics.registerFont(TTFont(name, str(FONT_DIR / file)))
pdfmetrics.registerFontFamily("TimesDoc", normal="TimesDoc", bold="TimesDoc-Bold", italic="TimesDoc-Italic", boldItalic="TimesDoc-Bold")

PW, PH = A4
M = 62
CW = PW - 2 * M
INK = colors.HexColor("#202124")
GRAY = colors.HexColor("#666666")
LINE = colors.HexColor("#a7a7a7")
LIGHT = colors.HexColor("#f2f2f2")


class Figure:
    """Coordenadas de figura en puntos, origen superior izquierdo."""
    def __init__(self, c, top):
        self.c, self.top = c, top

    def xy(self, x, y):
        return M + x, PH - self.top - y

    def text(self, x, y, lines, size=8.7, bold=False, align="center", leading=None, background=False):
        lines = [lines] if isinstance(lines, str) else lines
        self.c.setFillColor(INK)
        self.c.setFont("ArialDoc-Bold" if bold else "ArialDoc", size)
        for i, text in enumerate(lines):
            px, py = self.xy(x, y + i * (leading or size * 1.3))
            if background:
                tw = pdfmetrics.stringWidth(text, "ArialDoc-Bold" if bold else "ArialDoc", size)
                self.c.setFillColor(colors.white)
                self.c.rect(px - tw / 2 - 2 if align == "center" else px - 2, py - 2, tw + 4, size + 3, fill=1, stroke=0)
                self.c.setFillColor(INK)
            fn = self.c.drawCentredString if align == "center" else self.c.drawString
            fn(px, py, text)

    def line(self, points, arrow=False, dashed=False, return_arrow=False, width=.7):
        c = self.c
        c.setStrokeColor(INK)
        c.setFillColor(INK)
        c.setLineWidth(width)
        c.setDash(3, 2) if dashed else c.setDash()
        p = c.beginPath()
        p.moveTo(*self.xy(*points[0]))
        for point in points[1:]:
            p.lineTo(*self.xy(*point))
        c.drawPath(p)
        c.setDash()
        if arrow or return_arrow:
            a, b = points[-2:]
            angle = atan2(b[1] - a[1], b[0] - a[0])
            length = 4.7
            wings = [(b[0] - length * cos(angle + offset), b[1] - length * sin(angle + offset)) for offset in [-.48, .48]]
            head = c.beginPath()
            head.moveTo(*self.xy(*wings[0]))
            head.lineTo(*self.xy(*b))
            head.lineTo(*self.xy(*wings[1]))
            c.drawPath(head, stroke=1, fill=0)

    def rect(self, x, y, w, h, lines=None, size=8.6, fill=None, bold=False, dashed=False):
        c = self.c
        c.setLineWidth(.7)
        c.setStrokeColor(INK)
        c.setDash(3, 2) if dashed else c.setDash()
        c.setFillColor(fill or colors.white)
        c.rect(*self.xy(x, y + h), w, h, fill=1, stroke=1)
        c.setDash()
        if lines:
            lines = [lines] if isinstance(lines, str) else lines
            for line in lines:
                if pdfmetrics.stringWidth(line, "ArialDoc-Bold" if bold else "ArialDoc", size) > w - 8:
                    raise ValueError(f"Texto excede caja ({w} pt): {line}")
            self.text(x + w / 2, y + h / 2 - ((len(lines) - 1) * size * 1.3) / 2 + size * .33, lines, size, bold)

    def ellipse(self, x, y, w, h, lines, size=8.4):
        self.c.setStrokeColor(INK)
        self.c.setFillColor(colors.white)
        self.c.setLineWidth(.7)
        self.c.ellipse(*self.xy(x, y + h), *self.xy(x + w, y), fill=1, stroke=1)
        lines = [lines] if isinstance(lines, str) else lines
        self.text(x + w / 2, y + h / 2 - (len(lines) - 1) * size * .65 + size * .33, lines, size)

    def diamond(self, cx, cy, w, h, lines, size=8.5):
        pts = [(cx, cy - h / 2), (cx + w / 2, cy), (cx, cy + h / 2), (cx - w / 2, cy), (cx, cy - h / 2)]
        self.line(pts)
        self.text(cx, cy - (len(lines) - 1) * size * .65 + 3, lines, size)

    def actor(self, x, y, label):
        c = self.c
        c.setStrokeColor(INK)
        c.setLineWidth(.7)
        c.circle(*self.xy(x, y + 8), 7, fill=0, stroke=1)
        self.line([(x, y + 15), (x, y + 36)])
        self.line([(x - 12, y + 24), (x + 12, y + 24)])
        self.line([(x - 11, y + 50), (x, y + 36), (x + 11, y + 50)])
        self.text(x, y + 64, label, size=8.1)

    def cylinder(self, x, y, w, h, lines):
        c = self.c
        c.setStrokeColor(INK)
        c.setFillColor(colors.white)
        c.setLineWidth(.7)
        c.rect(*self.xy(x, y + h - 6), w, h - 12, fill=1, stroke=0)
        self.line([(x, y + 6), (x, y + h - 6)])
        self.line([(x + w, y + 6), (x + w, y + h - 6)])
        c.setFillColor(colors.white)
        c.ellipse(*self.xy(x, y + 12), *self.xy(x + w, y), fill=1, stroke=1)
        c.ellipse(*self.xy(x, y + h), *self.xy(x + w, y + h - 12), fill=0, stroke=1)
        self.text(x + w / 2, y + h / 2 + 3 - (len(lines) - 1) * 5, lines, size=8.2)


def use_case_figure(f):
    f.rect(100, 5, 280, 205)
    f.text(240, 21, "Sistema DLP: portal y API", size=9, bold=True)
    f.actor(30, 65, ["Participante", "de prueba"])
    f.actor(439, 65, ["Evaluador", "/ auditor"])
    f.line([(42, 89), (120, 69)])
    f.line([(42, 89), (120, 152)])
    f.line([(427, 89), (365, 69)])
    f.line([(427, 89), (365, 152)])
    f.ellipse(120, 44, 114, 50, ["CU-01 Transferir archivo", "y consultar decisión"], size=8)
    f.ellipse(251, 44, 114, 50, ["CU-02 Consultar", "políticas activas"])
    f.ellipse(120, 127, 114, 50, ["CU-04 Descargar", "ejemplos de prueba"])
    f.ellipse(251, 127, 114, 50, ["CU-03 Consultar", "eventos recientes"])
    f.text(240, 198, "Roles descriptivos; sin control de acceso diferenciado.", size=7.8)
    f.rect(100, 237, 280, 84, dashed=True)
    f.text(240, 251, "Operación técnica local", size=9, bold=True)
    f.actor(30, 249, ["Operador", "técnico"])
    f.actor(439, 249, ["Evaluador"])
    f.line([(42, 273), (115, 283)])
    f.line([(427, 273), (365, 283)])
    f.rect(115, 265, 119, 38, ["CU-05 Configurar", "y activar políticas"])
    f.rect(251, 265, 114, 38, ["CU-06 Evaluar", "el control DLP"])


def network_figure(f):
    f.rect(0, 0, CW, 307)
    f.text(CW / 2, 16, "Equipo físico Windows: anfitrión de VirtualBox y del servicio DLP", size=9, bold=True)
    f.rect(14, 39, 135, 219)
    f.text(81.5, 56, "Máquina virtual Kali", size=9, bold=True)
    f.rect(26, 75, 111, 47, ["Cliente de pruebas", "192.168.56.X /24"])
    f.rect(26, 148, 111, 44, ["Archivo ficticio", "TXT, CSV o JSON"])
    f.rect(26, 214, 111, 30, "Firefox / curl")
    f.line([(81.5, 192), (81.5, 214)], arrow=True)
    f.rect(178, 126, 99, 68, ["Red Host-only", "192.168.56.0/24", "HTTP / TCP 3000"], size=8.2)
    f.line([(137, 229), (163, 229), (163, 160), (178, 160)], arrow=True)
    f.rect(306, 39, 151, 219)
    f.text(381.5, 56, "Servicio en Windows", size=9, bold=True)
    f.rect(318, 75, 127, 47, ["Node.js / Express", "192.168.56.1:3000"])
    f.rect(318, 138, 127, 45, ["Recepción y análisis", "POST /api/upload"])
    f.line([(277, 160), (318, 160)], arrow=True)
    f.line([(349, 183), (349, 205)], arrow=True)
    f.line([(414, 183), (414, 205)], arrow=True)
    f.cylinder(317, 205, 65, 39, ["recibidos/"])
    f.cylinder(389, 205, 65, 39, ["logs/"])
    f.line([(382, 258), (382, 279), (81, 279), (81, 244)], arrow=True)
    f.text(230, 273, "Respuesta: HTTP 200 o 403", size=8.5)
    f.text(CW / 2, 299, "Acceso local desde Windows: http://localhost:3000", size=8.5)


def component_figure(f):
    f.rect(112, 0, 242, 294)
    f.text(233, 15, "Proceso Node.js", size=9, bold=True)
    f.rect(0, 91, 88, 105, ["Navegador", "public/app.js", "FormData / fetch"], size=8.4)
    f.rect(126, 32, 214, 40, ["Recursos estáticos", "public/"], fill=LIGHT)
    f.rect(126, 96, 214, 44, ["API HTTP de Express", "Carga, políticas, eventos y estado"])
    f.line([(88, 111), (100, 111), (100, 52), (126, 52)], arrow=True)
    f.line([(88, 142), (126, 118)], arrow=True)
    f.rect(126, 174, 98, 55, ["Recepción", "Multer y UTF-8"])
    f.rect(245, 174, 95, 55, ["Motor de reglas", "analyzeContent"], size=8.2)
    f.line([(176, 140), (176, 174)], arrow=True)
    f.line([(224, 201), (245, 201)], arrow=True)
    f.rect(126, 254, 214, 27, "Aplicar decisión y registrar resultado", size=8.5)
    f.line([(292, 229), (292, 254)], arrow=True)
    f.cylinder(390, 158, 80, 54, ["recibidos/", "Permitido / alerta"])
    f.cylinder(390, 244, 80, 54, ["eventos.jsonl", "Decisiones"])
    f.line([(340, 266), (372, 266), (372, 185), (390, 185)], arrow=True)
    f.line([(340, 273), (390, 273)], arrow=True)
    f.text(433, 325, "Disco local", size=8.6)


def flow_figure(f):
    f.ellipse(160, 0, 150, 25, "Solicitud de carga", size=9)
    f.line([(235, 25), (235, 44)], arrow=True)
    f.rect(160, 44, 150, 37, ["Recibir y validar", "extensión, tamaño y UTF-8"])
    f.line([(235, 81), (235, 88)], arrow=True)
    f.diamond(235, 115, 116, 54, ["¿Entrada", "válida?"])
    f.line([(177, 115), (126, 115)], arrow=True)
    f.text(150, 106, "No", size=8.2)
    f.rect(0, 91, 126, 48, ["ERROR", "Sin decisión DLP", "ni evento de contenido"], size=8.1)
    f.line([(235, 142), (235, 164)], arrow=True)
    f.text(246, 157, "Sí", size=8.2)
    f.rect(160, 164, 150, 34, ["Preparar texto", "Normalizar columnas CSV"])
    f.line([(235, 198), (235, 219)], arrow=True)
    f.rect(160, 219, 150, 34, ["Aplicar reglas", "y sumar puntajes"])
    f.line([(235, 253), (235, 266)], arrow=True)
    f.diamond(235, 291, 100, 50, ["Puntaje", "total"])
    f.line([(185, 291), (66, 291), (66, 345)], arrow=True)
    f.line([(235, 316), (235, 345)], arrow=True)
    f.line([(285, 291), (405, 291), (405, 345)], arrow=True)
    f.text(66, 336, "0", size=8.5, background=True)
    f.text(254, 335, "1 a 2", size=8.5)
    f.text(405, 336, "3 o más", size=8.5, background=True)
    f.rect(0, 345, 133, 49, ["PERMITIDO", "Guardar archivo", "Respuesta HTTP 200"], size=8.3)
    f.rect(169, 345, 133, 49, ["ALERTA", "Guardar archivo", "Respuesta HTTP 200"], size=8.3)
    f.rect(338, 345, 133, 49, ["BLOQUEADO", "No guardar archivo", "Respuesta HTTP 403"], size=8.3)
    f.line([(66, 394), (66, 413), (235, 413)])
    f.line([(405, 394), (405, 413), (235, 413)])
    f.line([(235, 394), (235, 431)], arrow=True)
    f.rect(160, 431, 150, 30, "Agregar evento de auditoría")
    f.line([(235, 461), (235, 481)], arrow=True)
    f.ellipse(160, 481, 150, 25, "Responder al cliente", size=9)


def sequence_figure(f):
    xs = [46, 170, 297, 427]
    heads = [["Navegador"], ["API Express"], ["Motor de reglas"], ["Disco local"]]
    for x, title in zip(xs, heads):
        f.rect(x - 43, 0, 86, 29, title, size=8.5)
        f.line([(x, 29), (x, 464)], dashed=True, width=.45)
    def msg(a, b, y, label, reverse=False):
        f.line([(a, y), (b, y)], arrow=not reverse, dashed=reverse, return_arrow=reverse)
        f.text((a+b)/2, y - 6, label, size=8, background=True)
    msg(46, 170, 59, "POST /api/upload")
    f.line([(170, 78), (185, 78), (185, 95), (170, 95)], arrow=True)
    f.text(195, 89, "Validar y decodificar", size=8, align="left")
    msg(170, 297, 124, "Analizar contenido")
    msg(297, 170, 154, "Puntaje y decisión", True)
    f.rect(138, 177, 332, 99)
    f.rect(138, 177, 26, 15, "alt", size=8, fill=LIGHT)
    f.text(174, 190, "[PERMITIDO o ALERTA]", size=7.7, align="left")
    msg(170, 427, 214, "Guardar archivo")
    f.line([(138, 230), (470, 230)], dashed=True, width=.45)
    f.text(174, 244, "[BLOQUEADO]", size=7.7, align="left")
    f.text(299, 263, "Se omite la escritura del archivo", size=8.1)
    msg(170, 427, 306, "Agregar evento JSONL")
    msg(427, 170, 332, "Escritura completada", True)
    msg(170, 46, 361, "HTTP 200 o 403", True)
    msg(46, 170, 392, "GET /api/events")
    msg(170, 427, 418, "Leer eventos recientes")
    msg(427, 170, 442, "Hasta 50 registros", True)
    msg(170, 46, 466, "JSON para la tabla", True)


class Report:
    def __init__(self):
        self.c = canvas.Canvas(str(OUT), pagesize=A4, pageCompression=1)
        self.c.setTitle("Control de transferencia de archivos mediante políticas DLP")
        self.c.setAuthor("Proyecto DLP")
        self.c.setCreator("Documentación técnica del proyecto DLP")
        self.c.setSubject("Casos de uso, arquitectura de red y diseño del laboratorio Windows / Kali")
        self.page = 0
        self.y = 0
        self.styles = {
            "body": ParagraphStyle("Body", fontName="TimesDoc", fontSize=11.1, leading=15.4, alignment=TA_JUSTIFY, textColor=INK),
            "small": ParagraphStyle("Small", fontName="TimesDoc", fontSize=9.7, leading=12.8, alignment=TA_LEFT, textColor=INK),
            "caption": ParagraphStyle("Caption", fontName="TimesDoc", fontSize=9.6, leading=12.4, alignment=TA_LEFT, textColor=INK),
            "table": ParagraphStyle("Table", fontName="TimesDoc", fontSize=10, leading=12.8, alignment=TA_LEFT, textColor=INK),
        }

    def new(self, section=""):
        if self.page:
            if self.y > PH - 60:
                raise ValueError(f"Página {self.page}: contenido fuera del área útil (y={self.y})")
            self.c.showPage()
        self.page += 1
        self.y = 85
        c = self.c
        c.setStrokeColor(LINE)
        c.setLineWidth(.45)
        c.line(M, PH - 49, PW - M, PH - 49)
        c.setFillColor(GRAY)
        c.setFont("ArialDoc", 8.1)
        c.drawString(M, PH - 39, "CONTROL DE TRANSFERENCIA DE ARCHIVOS MEDIANTE POLÍTICAS DLP")
        c.setFont("TimesDoc-Italic", 9)
        c.drawString(M, 36, "Laboratorio de ciberseguridad")
        c.setFont("TimesDoc", 9)
        c.drawRightString(PW - M, 36, str(self.page))
        if section:
            key = f"page-{self.page}"
            self.c.bookmarkPage(key)
            level = 1 if section.startswith(("2.1.", "2.2.", "2.3.")) else 0
            self.c.addOutlineEntry(section, key, level=level)
            self.h(section)

    def h(self, text, level=1):
        size = 17 if level == 1 else 12.5
        p = Paragraph(escape(text), ParagraphStyle("H", fontName="TimesDoc-Bold", fontSize=size, leading=size*1.2, textColor=INK))
        _, height = p.wrap(CW, 1000)
        p.drawOn(self.c, M, PH - self.y - height)
        self.y += height + (16 if level == 1 else 9)

    def p(self, text, small=False, after=10):
        p = Paragraph(text, self.styles["small" if small else "body"])
        _, height = p.wrap(CW, 1000)
        if self.y + height > PH - 60:
            raise ValueError(f"Página {self.page}: párrafo desbordado ({self.y + height})")
        p.drawOn(self.c, M, PH - self.y - height)
        self.y += height + after

    def items(self, texts):
        for i, text in enumerate(texts, 1):
            self.p(f"<b>{i}.</b> {text}", after=6)

    def table(self, headers, rows, widths, caption=None):
        if caption:
            self.p(f"<b>{caption}</b>", small=True, after=6)
        data = []
        for idx, row in enumerate([headers] + rows):
            data.append([Paragraph(("<b>" + escape(str(cell)) + "</b>") if idx == 0 else str(cell), self.styles["table"]) for cell in row])
        t = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("LINEABOVE", (0, 0), (-1, 0), .8, INK),
            ("LINEBELOW", (0, 0), (-1, 0), .55, INK),
            ("LINEBELOW", (0, 1), (-1, -1), .25, LINE),
            ("LINEBELOW", (0, -1), (-1, -1), .8, INK),
        ]))
        _, height = t.wrap(CW, 1000)
        if self.y + height > PH - 60:
            raise ValueError(f"Página {self.page}: tabla desbordada ({self.y + height})")
        t.drawOn(self.c, M, PH - self.y - height)
        self.y += height + 14

    def fig(self, height, draw, number, caption, note):
        if self.y + height + 36 > PH - 60:
            raise ValueError(f"Página {self.page}: figura desbordada")
        draw(Figure(self.c, self.y))
        self.y += height + 9
        for text in [f"<b>Figura {number}.</b> {caption}", f"<i>Nota.</i> {note}"]:
            p = Paragraph(text, self.styles["caption"])
            _, h = p.wrap(CW, 1000)
            p.drawOn(self.c, M, PH - self.y - h)
            self.y += h + 3
        self.y += 12

    def finish(self):
        if self.y > PH - 60:
            raise ValueError(f"Página {self.page}: desbordamiento al finalizar")
        self.c.save()


def cover(r):
    r.page = 1
    c = r.c
    c.bookmarkPage("cover")
    c.addOutlineEntry("Portada", "cover", level=0)
    c.setFillColor(INK)
    c.setFont("ArialDoc", 11)
    c.drawCentredString(PW/2, PH - 110, "PROYECTO ACADÉMICO DE CIBERSEGURIDAD")
    c.setStrokeColor(INK)
    c.setLineWidth(.8)
    c.line(M + 65, PH - 136, PW - M - 65, PH - 136)
    title = Paragraph("Control de transferencia<br/>de archivos mediante<br/>políticas DLP", ParagraphStyle("Cover", fontName="TimesDoc-Bold", fontSize=29, leading=35.5, alignment=TA_CENTER, textColor=INK))
    _, h = title.wrap(CW, 300)
    title.drawOn(c, M, PH - 245 - h)
    sub = Paragraph("Casos de uso, arquitectura de red<br/>y diseño del sistema", ParagraphStyle("CoverSub", fontName="TimesDoc", fontSize=16, leading=23, alignment=TA_CENTER, textColor=INK))
    _, sh = sub.wrap(CW, 150)
    sub.drawOn(c, M, PH - 410 - sh)
    c.setFont("TimesDoc", 12)
    c.drawCentredString(PW/2, PH - 527, "INFORME TÉCNICO")
    c.setFont("TimesDoc-Italic", 11)
    c.drawCentredString(PW/2, PH - 555, "Prototipo de laboratorio Windows / Kali Linux")
    c.setFont("TimesDoc", 11)
    c.drawCentredString(PW/2, 121, "Lima, Perú")
    c.drawCentredString(PW/2, 100, "Octubre de 2026")
    c.setFont("ArialDoc", 8.5)
    c.setFillColor(GRAY)
    c.drawCentredString(PW/2, 63, "Estado documentado: implementación por reglas, previa a la integración de Groq")
    r.y = 700


def main():
    r = Report()
    cover(r)

    r.new("Resumen")
    r.p("Se documenta un prototipo de prevención de fuga de información aplicado a un canal de carga de archivos. El laboratorio utiliza una computadora Windows como anfitrión del servicio y una máquina virtual Kali Linux como cliente de pruebas. La comunicación se realiza mediante una red Host-only y un servicio HTTP que recibe documentos ficticios en formato TXT, CSV o JSON.")
    r.p("El control inspecciona el texto con siete reglas, suma sus puntajes y resuelve si permite el almacenamiento, lo permite con alerta o lo bloquea. La decisión conserva una explicación basada en las reglas coincidentes y un registro de auditoría. Este informe presenta los actores, seis casos de uso, la topología de red, los componentes de software y la secuencia de procesamiento. También establece el alcance de los resultados experimentales y las limitaciones de la implementación.")
    r.p("<b>Palabras clave:</b> DLP, clasificación de información, transferencia de archivos, auditoría, laboratorio de ciberseguridad.", small=True, after=21)
    r.h("Contenido", 2)
    r.table(["Sección", "Página"], [
        ["1. Propósito, alcance y actores", '<link href="#page-3">3</link>'],
        ["2. Modelo de casos de uso", '<link href="#page-4">4</link>'],
        ["2.1. Especificación de la transferencia de archivos", '<link href="#page-5">5</link>'],
        ["2.2. Consultas y obtención de ejemplos", '<link href="#page-6">6</link>'],
        ["2.3. Operación técnica y evaluación", '<link href="#page-7">7</link>'],
        ["3. Arquitectura de red", '<link href="#page-8">8</link>'],
        ["4. Arquitectura de software", '<link href="#page-9">9</link>'],
        ["5. Políticas de clasificación y decisión", '<link href="#page-10">10</link>'],
        ["6. Flujo de procesamiento", '<link href="#page-11">11</link>'],
        ["7. Secuencia y persistencia", '<link href="#page-12">12</link>'],
        ["8. Evaluación y lectura de resultados", '<link href="#page-13">13</link>'],
        ["9. Conclusiones, limitaciones y fuentes", '<link href="#page-14">14</link>'],
    ], [CW - 48, 48])

    r.new("1. Propósito, alcance y actores")
    r.h("1.1. Problema y objetivo del control", 2)
    r.p("En un canal de transferencia, la recepción de un documento no basta para determinar si su almacenamiento está permitido. Un archivo puede contener información académica individual, credenciales o una clasificación interna que requiera un tratamiento distinto al de un documento público. El prototipo permite ensayar esa decisión con datos ficticios y observar sus consecuencias.")
    r.p("El objetivo general es implementar y evaluar un control que inspeccione el contenido antes de guardarlo en el destino del laboratorio. Se busca identificar indicadores de sensibilidad, aplicar una política reproducible y conservar evidencia suficiente para contrastar cada decisión con una clasificación de referencia.")
    r.h("1.2. Delimitación del escenario", 2)
    r.p("El servicio Windows funciona como receptor y punto de control del canal simulado. Kali inicia las cargas desde el navegador o desde una terminal. Aunque se utilicen dos sistemas operativos, ambos pueden ejecutarse en una única computadora física: Windows aloja la máquina virtual mediante VirtualBox.")
    r.p("El bloqueo ocurre después de recibir los bytes en memoria y antes de escribirlos en la carpeta de destino. Por tanto, la evidencia demuestra control del almacenamiento en este servicio. No demuestra inspección de todas las transferencias de la PC ni interceptación de tráfico hacia otros destinos.")
    r.table(["Actor", "Responsabilidad en el laboratorio"], [
        ["Participante de prueba", "Seleccionar archivos ficticios, intentar transferirlos y observar la decisión del control."],
        ["Evaluador o auditor", "Examinar políticas y eventos; contrastar las decisiones con la clasificación de referencia."],
        ["Operador técnico", "Instalar y arrancar el servicio; modificar reglas, ejecutar pruebas y activar cambios mediante un reinicio."],
    ], [125, CW - 125], "Tabla 1. Actores del sistema")
    r.p("Los actores representan responsabilidades y pueden ser desempeñados por una misma persona. La implementación no incorpora cuentas, inicio de sesión ni autorización por roles. Las consultas del portal son accesibles a quienes alcanzan el servicio en la red del laboratorio.", small=True)

    r.new("2. Modelo de casos de uso")
    r.p("El modelo distingue las funciones ofrecidas por el portal de las tareas que requieren terminal o edición del código. Esta separación evita atribuir a la interfaz capacidades de administración que todavía no están implementadas.")
    r.fig(326, use_case_figure, 1, "Casos de uso del portal y operación técnica local.", "Los roles son descriptivos. Fuente: interfaz y código del prototipo [1, 2].")
    r.table(["Código", "Caso de uso", "Acceso"], [
        ["CU-01", "Transferir archivo y consultar decisión", "Portal / API"],
        ["CU-02", "Consultar políticas activas", "Portal / API"],
        ["CU-03", "Consultar eventos recientes", "Portal / API"],
        ["CU-04", "Descargar ejemplos de prueba", "Portal"],
        ["CU-05", "Configurar y activar políticas", "Código / terminal"],
        ["CU-06", "Evaluar el control DLP", "Terminal"],
    ], [57, 273, CW - 330], "Tabla 2. Catálogo de casos de uso")

    r.new("2.1. Transferencia de archivos: CU-01")
    r.table(["Campo", "Especificación"], [
        ["Actor principal", "Participante de prueba."],
        ["Objetivo", "Solicitar una transferencia al destino controlado y conocer si su almacenamiento se permite o se bloquea."],
        ["Precondiciones", "Servicio disponible y accesible; archivo ficticio presente en el equipo cliente."],
        ["Disparador", "Pulsar «Analizar y transferir» o enviar una solicitud a POST /api/upload."],
        ["Entrada", "Un archivo en el campo multipart denominado archivo. Extensiones admitidas: .txt, .csv y .json; texto UTF-8; máximo 1 MiB (1.048.576 bytes)."],
        ["Salida", "Decisión, puntaje, coincidencias, mensaje y metadatos del evento."],
        ["Postcondición", "Si se permite o alerta: archivo guardado y evento registrado. Si se bloquea: evento registrado y archivo sin guardar."],
    ], [100, CW - 100], "Tabla 3. Especificación de CU-01")
    r.h("Flujo principal", 2)
    r.items([
        "El cliente selecciona el archivo y envía la carga al servicio HTTP.",
        "Multer comprueba la extensión y los límites; el servidor verifica la presencia del archivo y decodifica el texto UTF-8.",
        "El motor prepara el contenido y aplica las reglas. Para CSV añade una representación de columnas y valores; para TXT y JSON examina el texto recibido.",
        "Se suman los puntos de las reglas coincidentes y se calcula la decisión.",
        "Si corresponde, se guarda el archivo con un nombre normalizado y un identificador UUID. Después se agrega el evento de auditoría.",
        "La API devuelve HTTP 200 o 403. El navegador presenta el resultado y actualiza la consulta de eventos.",
    ])
    r.h("Alternativas y errores", 2)
    r.p("La ausencia de archivo, una extensión no admitida, el exceso de tamaño o un texto UTF-8 inválido se rechazan antes de clasificar el contenido. Esos casos producen ERROR, habitualmente HTTP 400, y no generan un evento DLP en la versión actual. Un fallo interno puede producir HTTP 500. El rechazo por formato debe distinguirse del bloqueo por una política de sensibilidad.", small=True)

    r.new("2.2. Consultas y obtención de ejemplos")
    r.h("CU-02. Consultar políticas activas", 2)
    r.p("El participante o evaluador consulta las reglas que explican el comportamiento del sistema. La precondición es que el servicio se encuentre disponible. Al abrir el portal se solicita GET /api/policies y se muestran identificador, nombre, descripción y puntos de las siete reglas.")
    r.p("La postcondición es disponer de las políticas para interpretar una decisión. La consulta no cambia los parámetros del motor ni permite editar reglas. Si la solicitud falla, la interfaz informa un error de carga.")
    r.h("CU-03. Consultar eventos recientes", 2)
    r.p("El evaluador revisa las decisiones previas mediante GET /api/events. La consulta ocurre al abrir la página, después de una carga y al pulsar «Actualizar». Se muestran hasta 50 eventos, empezando por los más recientes, con hora, archivo, reglas, puntaje y decisión.")
    r.p("Si no existen eventos, se presenta una tabla vacía. La consulta no descarga documentos recibidos. El registro conserva la fecha en formato ISO UTC; la hora visible se formatea en el navegador del cliente.")
    r.h("CU-04. Descargar ejemplos de prueba", 2)
    r.p("El participante obtiene un archivo ficticio desde los enlaces de la interfaz. Se ofrecen un JSON público, un JSON confidencial y un texto privado sin etiqueta. El servidor entrega los recursos alojados en public/ejemplos/ y el usuario puede utilizarlos posteriormente en CU-01.")
    r.p("La descarga del ejemplo y su posterior carga son operaciones distintas. Descargarlo no implica que el motor haya analizado una transferencia y no añade un evento DLP.")
    r.table(["Operación", "Resultado observable"], [
        ["Consultar políticas", "Tarjetas con las reglas vigentes y sus puntajes."],
        ["Consultar eventos", "Tabla de decisiones o mensaje de ausencia de registros."],
        ["Descargar ejemplo", "Archivo ficticio disponible en el equipo del participante."],
    ], [145, CW - 145], "Tabla 4. Resultados de los casos de consulta")

    r.new("2.3. Operación técnica y evaluación")
    r.h("CU-05. Configurar y activar políticas", 2)
    r.p("El operador técnico modifica los patrones o puntajes en la colección rules de app.js, o ajusta los umbrales en analyzeContent. La operación requiere acceso al código y una terminal en el equipo que ejecuta el servicio.")
    r.p("El flujo consiste en editar la política, comprobar su comportamiento con archivos ficticios y reiniciar el proceso Node.js. Las cargas posteriores utilizan la nueva configuración. No existe un editor web de políticas ni un registro automático de cambios administrativos.")
    r.h("CU-06. Evaluar el control DLP", 2)
    r.p("El evaluador ejecuta npm.cmd test para comprobar los comportamientos funcionales y npm.cmd run evaluate para procesar el conjunto de 20 archivos. Ambas herramientas levantan una instancia HTTP local con directorios temporales independientes de los del portal principal.")
    r.p("La evaluación compara las decisiones con las etiquetas de evaluacion/casos.json, obtiene matrices de confusión y comprueba que el registro y la cantidad de archivos almacenados sean coherentes con la decisión. Una aserción incumplida o un error de ejecución interrumpe la comprobación; debe resolverse antes de usar esa salida como evidencia.")
    r.table(["Caso", "Elemento principal de implementación"], [
        ["CU-01", "POST /api/upload; analyzeContent; appendEvent."],
        ["CU-02", "GET /api/policies; carga de tarjetas en public/app.js."],
        ["CU-03", "GET /api/events; readRecentEvents; tabla de auditoría."],
        ["CU-04", "Recursos estáticos en public/ejemplos/."],
        ["CU-05", "Colección rules y umbrales en app.js; reinicio manual."],
        ["CU-06", "test/app.test.js y evaluacion/evaluar.js."],
    ], [62, CW - 62], "Tabla 5. Trazabilidad entre casos de uso e implementación")
    r.p("La configuración y la evaluación pertenecen al procedimiento técnico del laboratorio. El diagrama las representa fuera del límite de interacción web para conservar la correspondencia con el código disponible.", small=True)

    r.new("3. Arquitectura de red")
    r.p("La red Host-only conecta el cliente Kali con el anfitrión Windows. El servicio expone el portal y la API en el puerto TCP 3000; la transferencia de prueba utiliza HTTP.")
    r.fig(310, network_figure, 2, "Despliegue del laboratorio en una computadora física.", "La X representa la IP de Kali pendiente de comprobación. Fuente: configuración del laboratorio y app.js [1].")
    r.table(["Parámetro", "Valor o función"], [
        ["Windows", "192.168.56.1; dirección observada con ipconfig el 21/10/2026."],
        ["Subred", "192.168.56.0/24; máscara 255.255.255.0."],
        ["Kali", "Dirección propia dentro de la subred; verificar con ip -4 addr."],
        ["Destino de carga", "http://192.168.56.1:3000/api/upload, desde Kali."],
        ["Escucha del servicio", "0.0.0.0:3000 por defecto; configurable con HOST y PORT."],
    ], [112, CW - 112], "Tabla 6. Parámetros del escenario de red")
    r.p("El ping comprueba conectividad ICMP, no la disponibilidad de TCP 3000. La escucha 0.0.0.0 abarca las interfaces IPv4 del equipo y no equivale a una restricción exclusiva a Host-only. La IP de Kali, el estado de la VM y el firewall no se verificaron en la revisión documental.", small=True)

    r.new("4. Arquitectura de software")
    r.p("La aplicación tiene una interfaz web y un servidor Express. Los módulos del servidor pertenecen a un mismo proceso Node.js y coordinan el análisis y la persistencia en archivos.")
    r.fig(330, component_figure, 3, "Componentes de software y almacenamiento local.", "Las cajas representan responsabilidades lógicas, no servicios independientes. Fuente: código del prototipo [1, 2].")
    r.table(["Responsabilidad", "Implementación"], [
        ["Interfaz", "HTML y CSS; public/app.js construye FormData y consume la API."],
        ["Validación", "Multer, comprobación de presencia y TextDecoder para UTF-8."],
        ["Análisis", "rules, parseCsvRows, csvFieldsAsText y analyzeContent."],
        ["Persistencia", "UUID, normalización de nombre y escritura en recibidos/."],
        ["Auditoría", "appendEvent y readRecentEvents sobre eventos.jsonl."],
    ], [108, CW - 108], "Tabla 7. Correspondencia de componentes con el código")
    r.p("Los JSON se examinan como texto; el motor no exige una estructura validada mediante JSON.parse. Para CSV se recorren las columnas y se agrega una representación campo: valor. El sistema no necesita una base de datos ni un servicio externo para clasificar con las reglas actuales.", small=True, after=2)

    r.new("5. Políticas de clasificación y decisión")
    r.p("La sensibilidad se aproxima mediante indicadores textuales. Cada regla coincidente aporta sus puntos una sola vez por archivo, aunque el patrón aparezca varias veces. El total expresa una política de decisión; no es una probabilidad de que el documento sea privado.")
    r.table(["Regla", "Indicador examinado", "Puntos"], [
        ["DLP-001", "Campo CLASIFICACION con valor CONFIDENCIAL, admitiendo comillas como en JSON.", "3"],
        ["DLP-002", "Campo CLASIFICACION con valor RESTRINGIDO.", "5"],
        ["DLP-003", "Campo CODIGO_ESTUDIANTE con ocho dígitos; incluye columnas CSV normalizadas.", "2"],
        ["DLP-004", "Patrón de NOTA_FINAL con un valor entre 0 y 20; incluye columnas CSV normalizadas.", "2"],
        ["DLP-005", "Correo del dominio ficticio universidad.edu.pe.", "1"],
        ["DLP-006", "Etiqueta CONTRASEÑA_TEMPORAL: o CONTRASENA_TEMPORAL:.", "3"],
        ["DLP-007", "Presencia conjunta de estudiante/alumno con nombre y nota/calificación final en el texto.", "3"],
    ], [65, CW - 112, 47], "Tabla 8. Reglas y puntajes de la implementación")
    r.table(["Puntaje", "Decisión", "Archivo", "HTTP"], [
        ["0", "PERMITIDO", "Se guarda", "200"],
        ["1 a 2", "ALERTA", "Se guarda", "200"],
        ["3 o más", "BLOQUEADO", "No se guarda", "403"],
    ], [75, 130, CW - 250, 45], "Tabla 9. Umbrales y efecto sobre el almacenamiento")
    r.h("Ejemplo de aplicación", 2)
    r.p('Un JSON con los campos <font name="ArialDoc" size="9">"codigo_estudiante":"20261234"</font> y <font name="ArialDoc" size="9">"nota_final":18</font> activa DLP-003 y DLP-004. El puntaje total es cuatro y el archivo se bloquea, aunque no incluya una clasificación confidencial.')
    r.p("DLP-007 comprueba que ambos patrones estén presentes en el contenido, pero no acredita que correspondan a la misma persona o frase. Las reglas tampoco verifican identidades contra un padrón institucional. Estas limitaciones explican por qué la evaluación debe incluir redacciones distintas y documentos públicos que citan ejemplos.", small=True)

    r.new("6. Flujo de procesamiento")
    r.p("La validación precede a la clasificación. Cuando la entrada es válida, las tres decisiones convergen en el registro del resultado antes de responder al cliente.", after=14)
    r.fig(510, flow_figure, 4, "Flujo de validación, análisis y aplicación de la decisión.", "Se representa una ejecución sin fallos internos de escritura. Fuente: POST /api/upload y manejador de errores [1].")
    r.p("ALERTA permite almacenar y deja la decisión visible para revisión. BLOQUEADO omite la escritura del documento. Los errores previos al análisis no aparecen en el archivo de eventos DLP actual.", small=True)

    r.new("7. Secuencia y persistencia")
    r.p("La secuencia muestra el orden de las operaciones de una carga válida y la consulta posterior que actualiza los eventos del portal.", after=14)
    r.fig(474, sequence_figure, 5, "Interacción del cliente, la API, el motor y el disco local.", "El fragmento alt distingue las alternativas de almacenamiento. Fuente: servidor y cliente JavaScript [1, 2].")
    r.h("Consistencia de los registros", 2)
    r.p("El archivo permitido o en alerta se guarda antes de agregar el evento. Las escrituras no son atómicas: un fallo de auditoría puede dejar un archivo almacenado con una respuesta de error. En un bloqueo, storedName es nulo.", small=True, after=4)
    r.p("El evento conserva identificador, fecha, IP del cliente, nombre del archivo, nombre almacenado, tamaño, puntaje, coincidencias y decisión. No contiene una copia completa del documento.", small=True, after=2)

    r.new("8. Evaluación y lectura de resultados")
    r.h("8.1. Diseño de la comprobación", 2)
    r.p("El repositorio incluye 20 archivos ficticios: diez públicos y diez sensibles. La clasificación de referencia está declarada en evaluacion/casos.json según el propósito y contenido del archivo, de forma independiente del puntaje que produce el motor. La batería automatizada se ejecuta por HTTP local en Windows; no debe describirse como 20 cargas originadas desde Kali.")
    r.p("Para medir detección se considera positivo ALERTA o BLOQUEADO. Para medir prevención solo se considera positivo BLOQUEADO, porque una alerta permite guardar. La herramienta también contrasta el número de eventos y archivos almacenados con las decisiones emitidas [3].")
    r.table(["Medición", "VP", "FP", "VN", "FN", "Precisión", "Recall"], [
        ["Detección", "10", "2", "8", "0", "83,3 %", "100,0 %"],
        ["Prevención", "9", "1", "9", "1", "90,0 %", "90,0 %"],
    ], [103, 36, 36, 36, 36, 110, CW - 357], "Tabla 10. Resultados del conjunto de 20 casos del repositorio")
    r.p("VP: verdadero positivo; FP: falso positivo; VN: verdadero negativo; FN: falso negativo. Precisión = VP / (VP + FP). Recall = VP / (VP + FN). Fuente: informe de evaluación incluido en el proyecto [3].", small=True)
    r.h("8.2. Interpretación de los errores", 2)
    r.p("Los casos B09 y B10 son públicos, pero contienen una etiqueta de clasificación citada con fines didácticos o un correo ficticio de ejemplo. Producen falsos positivos de detección. Solo B09 se bloquea, por lo que constituye el falso positivo de prevención.")
    r.p("S09 corresponde a un directorio interno que activa únicamente la regla de correo institucional. El sistema lo detecta con una alerta, pero permite guardarlo; por ello es un falso negativo de prevención. El texto de notas sin etiqueta, S10, activa DLP-007 en la versión documentada.")
    r.h("8.3. Validez de la evidencia", 2)
    r.p("Las reglas se ajustaron utilizando este mismo conjunto. Sus resultados describen una comprobación de desarrollo y no una prueba independiente de generalización. El recall de 100 % en detección no demuestra reconocimiento perfecto en documentos nuevos. Una evaluación posterior debe reservar archivos no usados al diseñar las reglas y conservar las mismas etiquetas de referencia al comparar alternativas.")

    r.new("9. Conclusiones, limitaciones y fuentes")
    r.h("9.1. Conclusiones del diseño", 2)
    r.p("El prototipo permite observar una cadena completa de control: recepción, validación, clasificación, decisión, almacenamiento condicional y auditoría. La separación entre detección y prevención facilita explicar por qué una alerta no equivale a detener una transferencia. La correspondencia entre casos de uso, componentes y endpoints hace verificable el alcance de la implementación.")
    r.h("9.2. Limitaciones y siguiente ampliación", 2)
    r.p("El alcance se limita a TXT, CSV y JSON de hasta 1 MiB, codificados como texto UTF-8 y enviados por el portal o su API. No se inspeccionan otros canales de salida ni se realiza análisis antivirus. La aplicación carece de autenticación, cuarentena y un proceso de aprobación manual; también debe mejorarse el registro de entradas inválidas y la consistencia entre archivo y auditoría.")
    r.p("La incorporación de Groq se plantea como una ampliación para clasificar contexto. A la fecha de este documento no forma parte del flujo. Su evaluación deberá comparar las decisiones con las del motor por reglas, usando casos nuevos y midiendo errores, tiempo de respuesta y comportamiento ante indisponibilidad.")
    r.h("9.3. Fuentes de la implementación", 2)
    r.p("Las figuras y especificaciones se elaboraron a partir de los siguientes materiales del propio proyecto. Las referencias documentan el sistema observado y no sustituyen una revisión bibliográfica sobre DLP.", small=True)
    refs = [
        "[1] Proyecto DLP. (2026). <i>app.js</i> [Código fuente]. Recepción de cargas, reglas, umbrales, persistencia y endpoints. Repositorio: https://github.com/Brando-01/DLP.",
        "[2] Proyecto DLP. (2026). <i>public/index.html y public/app.js</i> [Código fuente]. Interfaz de carga, presentación de resultados y consulta de eventos.",
        "[3] Proyecto DLP. (2026). <i>evaluacion/casos.json, evaluacion/evaluar.js y evaluacion/INFORME.md</i> [Materiales de evaluación]. Conjunto ficticio, procedimiento y resultados registrados.",
        "[4] Proyecto DLP. (2026). <i>test/app.test.js</i> [Pruebas de software]. Comprobaciones funcionales del analizador y del endpoint de carga.",
        "[5] Proyecto DLP. (2026). <i>README.md</i> [Documentación técnica]. Instalación, ejecución y configuración del laboratorio Windows / Kali.",
    ]
    for ref in refs:
        r.p(ref, small=True, after=8)
    r.p("Revisión documental: 21 de octubre de 2026. Los parámetros de red se describen según la configuración y la evidencia disponibles para esa fecha.", small=True)

    r.finish()
    print(f"PDF generado: {OUT}")
    print(f"Páginas: {r.page}")


if __name__ == "__main__":
    main()
