"""Lectura de envolturas HTTP y MIME. Los documentos los extrae el motor local."""
from email import policy
from email.parser import BytesParser
import json
import re
import urllib.parse
import zlib

MAX_BYTES = 10 * 1024 * 1024


def bounded_body(data, encoding=""):
    if len(data) > MAX_BYTES:
        raise ValueError("Carga superior a 10 MiB")
    if not encoding or encoding.lower() == "identity":
        return data
    if encoding.lower() not in ("gzip", "deflate"):
        raise ValueError("Codificación HTTP no inspeccionable")
    decoder = zlib.decompressobj(31 if encoding.lower() == "gzip" else zlib.MAX_WBITS)
    output = decoder.decompress(data, MAX_BYTES + 1)
    if len(output) > MAX_BYTES or decoder.unconsumed_tail or not decoder.eof or decoder.unused_data:
        raise ValueError("Expansión HTTP incompleta o superior al límite")
    return output


def safe_name(value, fallback="documento.bin"):
    name = str(value or fallback).replace("\\", "/").split("/")[-1]
    return name[:160] or fallback


def mime_parts(message, include_headers=False):
    result = []
    total = 0
    count = 0
    if include_headers:
        # También el asunto puede transportar datos, sin persistirlo en la auditoría.
        result.append(("asunto.txt", str(message.get("Subject", "")).encode("utf-8")))

    def walk(part, depth):
        nonlocal total, count
        count += 1
        if depth > 8 or count > 100 or part.defects:
            raise ValueError("MIME malformado o excesivamente complejo")
        if part.get_content_type() in ("multipart/encrypted", "application/pgp-encrypted", "application/pkcs7-mime"):
            raise ValueError("Mensaje cifrado no inspeccionable")
        if part.is_multipart():
            for child in part.iter_parts():
                walk(child, depth + 1)
            return
        data = part.get_payload(decode=True)
        if data is None or part.defects:
            raise ValueError("Parte MIME sin decodificación completa")
        name = part.get_filename()
        content_type = part.get_content_type()
        if content_type.startswith("text/") and not name:
            try:
                data = data.decode(part.get_content_charset() or "utf-8", errors="strict").encode("utf-8")
            except (UnicodeError, LookupError):
                raise ValueError("Texto MIME con codificación inválida") from None
            name = "cuerpo.html" if content_type == "text/html" else "cuerpo.txt"
        total += len(data)
        if total > MAX_BYTES or len(result) >= 20:
            raise ValueError("Límite de partes o tamaño excedido")
        result.append((safe_name(name), data))

    walk(message, 0)
    return result


def parse_mail(data):
    if len(data) > MAX_BYTES:
        raise ValueError("Correo demasiado grande")
    return mime_parts(BytesParser(policy=policy.default).parsebytes(data), include_headers=True)


def http_parts(data, content_type, filename="documento.bin"):
    content_type = content_type or "application/octet-stream"
    media_type = content_type.split(";", 1)[0].strip().lower()
    if not data:
        return []
    if media_type.startswith("multipart/"):
        if media_type != "multipart/form-data" or "\r" in content_type or "\n" in content_type:
            raise ValueError("Multipart no admitido")
        message = BytesParser(policy=policy.default).parsebytes(b"MIME-Version: 1.0\r\nContent-Type: " + content_type.encode("ascii") + b"\r\n\r\n" + data)
        parts = mime_parts(message)
        # Los campos de formulario pueden no tener Content-Type; deben ser texto decodificable.
        return [("campo.txt" if name == "documento.bin" and b"\x00" not in value else name, value) for name, value in parts]
    if media_type == "application/x-www-form-urlencoded":
        values = urllib.parse.parse_qsl(data.decode("utf-8", "strict"), keep_blank_values=True, max_num_fields=200, errors="strict")
        return [("formulario.txt", "\n".join(f"{key}: {value}" for key, value in values).encode())]
    if media_type == "application/json" or media_type.endswith("+json"):
        decoded = json.loads(data.decode("utf-8", "strict"))
        return [("cuerpo.json", json.dumps(decoded, ensure_ascii=False).encode())]
    if media_type.startswith("text/"):
        return [("cuerpo.html" if media_type == "text/html" else "cuerpo.txt", data)]
    if media_type in ("application/xml", "application/x-www-form+xml") or media_type.endswith("+xml"):
        return [("cuerpo.xml", data)]
    inferred = {"application/pdf": "documento.pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "documento.docx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "documento.xlsx"}.get(media_type, filename)
    return [(safe_name(inferred), data)]
