"""Create an encrypted server-local key; return only its PUBLIC certificate."""
from pathlib import Path
from datetime import datetime,timedelta,timezone
import hashlib,json,os,subprocess
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa

EMAIL='finance-budget-sync@academy-ceo-dashboard.iam.gserviceaccount.com'
target=Path('/etc/credstore.encrypted/finance-budget-google')
state=Path('/var/lib/finance-budget-sync')
if target.exists():
 certificate=(state/'public-cert.pem').read_text()
 print(json.dumps({'created':False,'email':EMAIL,'publicCertificate':certificate}));raise SystemExit()
if target.parent.resolve()!=target.parent:raise ValueError('Unexpected credential directory')
state.mkdir(mode=0o700,exist_ok=True)
key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
subject=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,EMAIL)])
now=datetime.now(timezone.utc)
cert=(x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=5)).not_valid_after(now+timedelta(days=365)).sign(key,hashes.SHA256()))
certificate=cert.public_bytes(serialization.Encoding.PEM).decode()
private=key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()).decode()
info={'type':'service_account','client_email':EMAIL,'private_key':private,'token_uri':'https://oauth2.googleapis.com/token'}
target.parent.mkdir(mode=0o700,exist_ok=True)
result=subprocess.run(['systemd-creds','encrypt','--name=google-budget','-',str(target)],input=json.dumps(info).encode(),capture_output=True)
info.clear();private=None;key=None
if result.returncode:raise RuntimeError('Credential encryption failed; details suppressed')
os.chmod(target,0o600)
(state/'public-cert.pem').write_text(certificate);os.chmod(state/'public-cert.pem',0o600)
print(json.dumps({'created':True,'email':EMAIL,'publicCertificate':certificate,'publicSha256':hashlib.sha256(certificate.encode()).hexdigest(),'expires':(now+timedelta(days=365)).isoformat(),'privateKeyExported':False}))
