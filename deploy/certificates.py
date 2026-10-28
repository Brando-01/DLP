"""Certificado del receptor ficticio. No instala CAs en el sistema operativo."""
import datetime
import ipaddress
import os
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


def generate(private_directory, public_directory):
    private_directory, public_directory = Path(private_directory), Path(public_directory)
    private_directory.mkdir(parents=True, exist_ok=True)
    public_directory.mkdir(parents=True, exist_ok=True)
    cert_file, key_file = private_directory / "receiver.pem", private_directory / "receiver.key"
    if cert_file.exists() and key_file.exists():
        public_directory.joinpath("receiver-ca.pem").write_bytes(cert_file.read_bytes())
        return
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "DLP laboratorio receptor")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(minutes=5)).not_valid_after(now + datetime.timedelta(days=90)).add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost"), x509.DNSName("sink.dlp.test"), x509.DNSName("receiver"), x509.IPAddress(ipaddress.ip_address("127.0.0.1")), x509.IPAddress(ipaddress.ip_address("172.30.50.20"))]), critical=False).add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True).sign(key, hashes.SHA256())
    key_file.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    key_file.chmod(0o600)
    cert_file.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    public_directory.joinpath("receiver-ca.pem").write_bytes(cert_file.read_bytes())


if __name__ == "__main__":
    generate(os.environ.get("DLP_LAB_CERTS", "datos-control/certs-private"), os.environ.get("DLP_LAB_PUBLIC_CA", "datos-control/certs-public"))
    print("Certificado de receptor generado; CA privada no compartida", flush=True)
