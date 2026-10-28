"""E2E dentro del host Docker aislado. No toca el firewall del anfitrion Windows.

Usa temporalmente reglas locales para que la prueba no consuma Groq. Restaura
el modo configurado al terminar, incluso si una comprobacion falla.
"""
import datetime
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = ["docker", "compose", "--env-file", str(ROOT / ".env"), "-f", str(ROOT / "deploy/compose.yaml"), "--profile", "extended", "--profile", "wazuh"]
RESULTS = []


def run(args, data=None, timeout=90, env=None, check=True):
    result = subprocess.run(args, input=data, capture_output=True, timeout=timeout, env=env, cwd=ROOT)
    if check and result.returncode:
        # Nunca emitir argumentos ni variables: pueden contener credenciales.
        raise RuntimeError("Fallo de un servicio de laboratorio: " + result.stderr.decode(errors="replace")[-500:])
    return result


def execute(service, code, payload=None, timeout=60):
    args = BASE + ["exec", "-T", service, "python3", "-c", code]
    return run(args, json.dumps(payload).encode() if payload is not None else None, timeout=timeout).stdout.decode().strip()


def record(case, name, evidence):
    RESULTS.append({"case": case, "test": name, "passed": True, "evidence": evidence})
    print(case + " " + name + " OK", flush=True)


def wait_health():
    for _ in range(60):
        try:
            with urllib.request.urlopen("http://127.0.0.1:3100/healthz", timeout=2) as response:
                if response.status == 200:
                    return
        except OSError:
            pass
        time.sleep(1)
    raise RuntimeError("Control central no disponible")


def main():
    values = dict(line.strip().split("=", 1) for line in (ROOT / ".env").read_text().splitlines() if line.strip() and not line.startswith("#") and "=" in line)
    environment = {**os.environ, "DLP_LLM_MODE": "off", "DLP_LAB_BIND": "0.0.0.0"}
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    failure = None
    try:
        run(BASE + ["up", "-d", "--no-deps", "--force-recreate", "control"], env=environment)
        wait_health()
        # El receptor no contiene reglas DLP: su volumen permite comprobar ausencia de efectos.
        received = lambda: execute("receiver", "from pathlib import Path; p=Path('/receipts/recepciones.jsonl'); print(len(p.read_text().splitlines()) if p.exists() else 0)")
        for label, text, allowed in [("publico", "Horario del laboratorio", True), ("privado", "DNI: 12345678", False)]:
            before = received()
            code = "import subprocess,sys,json; p=json.load(sys.stdin); r=subprocess.run(['curl','--silent','--show-error','--noproxy','','--proxy','http://172.30.50.11:8080','--cacert','/ca/mitmproxy-ca-cert.pem','--max-time','45','-H','Content-Type: text/plain','--data-binary',p['text'],'-o','/tmp/dlp-response','-w','%{http_code}','https://sink.dlp.test:4201/upload'],capture_output=True); print(r.stdout.decode()); assert r.returncode==0, r.stderr.decode()"
            status = execute("client", code, {"text": text})
            assert status == ("200" if allowed else "403"), status
            after = received(); assert (int(after) == int(before) + 1) if allowed else (after == before)
            record("CU-05/06", "HTTPS " + label, "REAL_PROXY_TLS_AND_INDEPENDENT_RECEIVER")
        mail = "import smtplib,json,sys; from email.message import EmailMessage; p=json.load(sys.stdin); m=EmailMessage(); m['From']='a@dlp.test'; m['To']='b@dlp.test'; m['Subject']='Prueba'; m.set_content(p['text'],cte='base64'); s=smtplib.SMTP('172.30.50.12',25,timeout=60);\ntry:\n s.send_message(m); print('250')\nexcept smtplib.SMTPDataError as e:\n print(e.smtp_code)\nfinally:\n s.quit()"
        for label, text, allowed in [("publico", "Horario del laboratorio", True), ("privado", "DNI: 12345678", False)]:
            before = received(); code = execute("client", mail, {"text": text})
            assert code == ("250" if allowed else "550"), code
            after = received(); assert (int(after) == int(before) + 1) if allowed else (after == before)
            record("CU-04", "Postfix MIME " + label, "REAL_POSTFIX_BEFORE_QUEUE_FILTER_AND_RECEIVER")
        attachment_mail = "import smtplib,json,sys,base64; from email.message import EmailMessage; p=json.load(sys.stdin); m=EmailMessage(); m['From']='a@dlp.test'; m['To']='b@dlp.test'; m['Subject']='Adjunto'; m.set_content('Documento de prueba'); m.add_attachment(base64.b64decode(p['data']),maintype='application',subtype='vnd.openxmlformats-officedocument.spreadsheetml.sheet',filename=p['name']); s=smtplib.SMTP('172.30.50.12',25,timeout=60);\ntry:\n s.send_message(m); print('250')\nexcept smtplib.SMTPDataError as e:\n print(e.smtp_code)\nfinally:\n s.quit()"
        for name,allowed in [("publico.xlsx",True),("privado.xlsx",False)]:
            before=received(); payload={"name":name,"data":base64.b64encode((ROOT/'evaluacion/muestras'/name).read_bytes()).decode()}
            code=execute("client",attachment_mail,payload)
            assert code == ("250" if allowed else "550"), code
            after=received(); assert (int(after)==int(before)+1) if allowed else (after==before)
            record("CU-03","Postfix adjunto "+name,"REAL_POSTFIX_XLSX_MIME_AND_INDEPENDENT_RECEIVER")
        upload_binary="import json,sys,base64,subprocess; p=json.load(sys.stdin); r=subprocess.run(['curl','--silent','--noproxy','','--proxy','http://172.30.50.11:8080','--cacert','/ca/mitmproxy-ca-cert.pem','--max-time','45','-H','Content-Type: application/octet-stream','--data-binary','@-','-o','/tmp/dlp-response','-w','%{http_code}','https://sink.dlp.test:4201/'+p['name']],input=base64.b64decode(p['data']),capture_output=True); assert r.returncode==0; print(r.stdout.decode())"
        cipher=execute("receiver","from cryptography.fernet import Fernet; import base64; print(base64.b64encode(Fernet(Fernet.generate_key()).encrypt(b'DNI: 12345678')).decode())")
        for case,name,data in [("CU-11","cifrado.bin",cipher),("CU-12","renombrado.jpg",base64.b64encode((ROOT/'evaluacion/muestras/renombrado.jpg').read_bytes()).decode())]:
            before=received(); assert execute("client",upload_binary,{"name":name,"data":data})=="403"; assert before==received()
            record(case,name,"REAL_TLS_REQUEST_BLOCKED_BEFORE_RECEIVER")
        # Prueba negativa independiente: SSH esta operativo desde el host Linux.
        run(["python3", "-c", "import socket; s=socket.create_connection(('172.30.50.23',22),3); assert s.recv(100).startswith(b'SSH-'); s.close()"])
        connect = "import socket; s=socket.socket(); s.settimeout(3); r=s.connect_ex(('172.30.50.23',22)); s.close(); assert r!=0; print('REJECTED')"
        assert execute("client", connect) == "REJECTED"
        record("CU-08", "SSH operativo y denegado desde cliente", "REAL_SSH_BANNER_NEGATIVE_CONTROL_AND_CLIENT_FIREWALL")
        dns = "import socket,struct; name='sink.dlp.test'; raw=b''.join(bytes([len(p)])+p.encode() for p in name.split('.'))+b'\\0'; q=struct.pack('!6H',551,256,1,0,0,0)+raw+struct.pack('!HH',1,1); s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.settimeout(3); s.sendto(q,('172.30.50.53',53)); r=s.recv(4096); assert (r[3]&15)==0 and r.endswith(bytes([172,30,50,20])); print('RESOLVED')"
        assert execute("client", dns) == "RESOLVED"
        record("CU-10", "DNS permitido resuelto por dnsmasq", "REAL_DNS_GUARD_AND_DNSMASQ_RESPONSE")
        dns_block = "import socket,struct; name='" + "a" * 50 + ".dlp.test'; raw=b''.join(bytes([len(p)])+p.encode() for p in name.split('.'))+b'\\0'; q=struct.pack('!6H',552,256,1,0,0,0)+raw+struct.pack('!HH',1,1); s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.settimeout(3); s.sendto(q,('172.30.50.53',53)); r=s.recv(4096); assert (r[3]&15)==5; print('REFUSED')"
        assert execute("client", dns_block) == "REFUSED"
        record("CU-10", "Carga en etiqueta DNS rechazada", "REAL_DNS_REFUSED_BEFORE_UPSTREAM")
        direct = "import socket; s=socket.socket(); s.settimeout(3); r=s.connect_ex(('172.30.50.20',4201)); s.close(); assert r!=0; print('REJECTED')"
        assert execute("client", direct) == "REJECTED"
        record("CU-05", "HTTPS directo sin proxy denegado", "REAL_CLIENT_EGRESS_FIREWALL")
        # FTP: excepcion temporal para demostrar deteccion IDS, no atribuir bloqueo de contenido.
        ftp_rule = ["-d", "172.30.50.22/32", "-p", "tcp", "-m", "multiport", "--dports", "21,30000:30009", "-j", "ACCEPT"]
        run(BASE + ["exec", "-T", "client", "iptables", "-I", "DLP_CLIENT", "2"] + ftp_rule)
        try:
            code = "import ftplib,io,json,sys; p=json.load(sys.stdin); f=ftplib.FTP('172.30.50.22',timeout=10); f.login('dlplab',p['password']); f.storbinary('STOR prueba-dlp.txt',io.BytesIO(b'CONFIDENCIAL DNI: 12345678\\n'*100)); f.quit(); print('STORED')"
            assert execute("client", code, {"password": values["DLP_LAB_PASSWORD"]}) == "STORED"
        finally:
            run(BASE + ["exec", "-T", "client", "iptables", "-D", "DLP_CLIENT"] + ftp_rule)
        time.sleep(3)
        alert = execute("dns", "import json; from pathlib import Path; p=Path('/logs/suricata/eve.json'); a=[json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []; assert any(str(x.get('alert',{}).get('signature','')).startswith('DLP LAB') and x.get('app_proto')=='ftp-data' for x in a); print('IDS_ALERT')")
        assert alert == "IDS_ALERT"
        record("CU-09", "FTP permitido deja firma Suricata", "REAL_FTP_TRANSFER_AND_PASSIVE_IDS_ALERT_NOT_PREVENTION")
        # Samba: acceso real auditado; se hace desde host de control y no evade la politica del cliente.
        smb = "import os,subprocess,json,sys,tempfile; p=json.load(sys.stdin); fd,n=tempfile.mkstemp(); os.write(fd,('username=dlplab\\npassword='+p['password']+'\\n').encode()); os.close(fd);\ntry:\n r=subprocess.run(['smbclient','//172.30.50.21/Finanzas','-A',n,'-c','get privado.txt /tmp/dlp-finanzas.txt'],capture_output=True); assert r.returncode==0,r.stderr.decode(); assert b'DNI' in open('/tmp/dlp-finanzas.txt','rb').read(); print('READ')\nfinally:\n os.unlink(n)"
        assert execute("samba", smb, {"password": values["DLP_LAB_PASSWORD"]}) == "READ"
        time.sleep(1)
        assert "DLP_SAMBA" in execute("dns", "from pathlib import Path; print(Path('/logs/samba/audit.log').read_text()[-5000:])")
        record("CU-02", "Lectura Samba con full_audit", "REAL_SMB_READ_AND_SERVER_AUDIT_NOT_LOCAL_COPY_PREVENTION")
        # Logtest evalua las reglas reales cargadas por analysisd, luego se comprueba el archivo vivo.
        event = json.dumps({"channel": "mail", "activity": "RESULTADO_CONECTOR_LOCAL", "decision": "BLOQUEADO", "prevented": True, "outcome": "CANCELLED"}) + "\n"
        result = run(BASE + ["exec", "-T", "wazuh-manager", "/var/ossec/bin/wazuh-logtest"], event.encode())
        logtest_output=result.stdout+result.stderr
        assert b"100204" in logtest_output, logtest_output.decode(errors="replace")[-1000:]
        record("SIEM", "Regla de bloqueo en wazuh-logtest", "REAL_WAZUH_DECODER_AND_RULE_ENGINE")
        for _ in range(20):
            text = execute("wazuh-forwarder", "import json; from pathlib import Path; p=Path('/wazuh/alerts/alerts.json'); a=[json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []; print(sum(100200<=int(x.get('rule',{}).get('id',0))<=100299 for x in a))")
            if int(text) > 0:
                break
            time.sleep(2)
        assert int(text) > 0, "Wazuh no correlaciono eventos vivos"
        record("SIEM", "Alertas vivas de los sensores", "REAL_WAZUH_ALERTS_JSON")
        for _ in range(15):
            request = urllib.request.Request("http://127.0.0.1:3100/v1/admin/status", headers={"X-DLP-Token": values["DLP_CONTROL_ADMIN_TOKEN"]})
            with urllib.request.urlopen(request, timeout=5) as response:
                status = json.load(response)
            if any(item.get("activity", "").startswith("WAZUH_") for item in status["events"]):
                break
            time.sleep(2)
        assert any(item.get("activity", "").startswith("WAZUH_") for item in status["events"]), "Reenviador Wazuh no entrego al panel"
        record("SIEM", "Alertas correlacionadas en el panel central", "REAL_WAZUH_FORWARDER_AND_CENTRAL_API")
    except Exception as error:
        failure = str(error)
    finally:
        restore = run(BASE + ["up", "-d", "--no-deps", "--force-recreate", "control"], env={**os.environ, "DLP_LAB_BIND": "0.0.0.0"}, check=False)
        output = ROOT / "output/evaluacion/resultado-linux.json"; output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps({"generatedAt": started, "backend": os.environ.get("DLP_TEST_BACKEND", "LINUX_DOCKER"), "kernel": os.uname().release, "groqLiveTested": False, "classification": "RULES_ONLY_FOR_DEPLOYMENT_TEST", "tests": len(RESULTS), "passed": failure is None and restore.returncode == 0, "error": failure, "modeRestored": restore.returncode == 0, "results": RESULTS}, indent=2, ensure_ascii=False))
    if failure:
        raise RuntimeError(failure)


if __name__ == "__main__":
    main()
