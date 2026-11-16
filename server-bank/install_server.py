"""Install isolated server jobs. Does not receive or print bank credentials."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json,os,pwd,shutil,subprocess,tarfile

FILES={'connector.py','credential.py','server_collect.py','publish_server.py','bank_daily.py','publish_snapshot.py','requirements.txt','bank-ca-bundle.pem','finance-bank-sync.service','finance-bank-publish.service','finance-bank-sync.timer'}
def run(*args):return subprocess.run(args,check=True,capture_output=True,text=True).stdout.strip()

def main():
    p=argparse.ArgumentParser();p.add_argument('archive');p.add_argument('sha256');p.add_argument('accounts');a=p.parse_args()
    archive=Path(a.archive);accounts=Path(a.accounts)
    if archive.resolve().parent!=Path('/tmp') or accounts.resolve().parent!=Path('/tmp') or archive.is_symlink() or accounts.is_symlink():raise ValueError('Unexpected installation input')
    if hashlib.sha256(archive.read_bytes()).hexdigest()!=a.sha256:raise ValueError('Archive mismatch')
    approved=json.loads(accounts.read_text())['accounts']
    if len(approved)!=4 or {v[-4:] for v in approved}!={'9870','6608','7731','4506'}:raise ValueError('Unexpected account scope')
    try:bank=pwd.getpwnam('financebank')
    except KeyError:
        run('useradd','--system','--user-group','--home-dir','/nonexistent','--no-create-home','--shell','/usr/sbin/nologin','financebank');bank=pwd.getpwnam('financebank')
    target=Path('/opt/finance-bank-sync')
    if target.exists() and target.resolve()!=target:raise ValueError('Unexpected service location')
    target.mkdir(mode=0o755,exist_ok=True)
    with tarfile.open(archive,'r:gz') as tar:
        members=tar.getmembers()
        if {m.name for m in members}!=FILES or any(not m.isfile() for m in members):raise ValueError('Unexpected service files')
        tar.extractall(target,filter='data')
    for item in target.iterdir():
        if item.is_file():os.chown(item,0,0);os.chmod(item,0o644)
    if not (target/'venv/bin/pip').exists():run('/usr/bin/python3','-m','venv',str(target/'venv'))
    run(str(target/'venv/bin/python'),'-m','pip','install','--disable-pip-version-check','-r',str(target/'requirements.txt'))
    for module in ['connector.py','credential.py','server_collect.py','publish_server.py','bank_daily.py','publish_snapshot.py']:
        run(str(target/'venv/bin/python'),'-m','py_compile',str(target/module))
    config=Path('/etc/finance-bank-sync');config.mkdir(mode=0o750,exist_ok=True);os.chown(config,0,bank.pw_gid);os.chmod(config,0o750)
    dest=config/'approved-accounts.json';dest.write_text(json.dumps({'accounts':approved}));os.chown(dest,0,bank.pw_gid);os.chmod(dest,0o640)
    state=Path('/var/lib/finance-bank-sync');state.mkdir(mode=0o700,exist_ok=True);os.chown(state,bank.pw_uid,bank.pw_gid);os.chmod(state,0o700)
    initial=state/'last-good.json'
    if not initial.exists():shutil.copy2('/opt/finance-dashboard/private/bank-daily.json',initial);os.chown(initial,bank.pw_uid,bank.pw_gid);os.chmod(initial,0o600)
    credentials=Path('/etc/credstore.encrypted');credentials.mkdir(mode=0o700,exist_ok=True)
    for name in ['finance-bank-sync.service','finance-bank-publish.service','finance-bank-sync.timer']:
        shutil.copy2(target/name,Path('/etc/systemd/system')/name)
    run('systemd-analyze','verify',str(target/'finance-bank-sync.service'),str(target/'finance-bank-publish.service'),str(target/'finance-bank-sync.timer'))
    run('systemctl','daemon-reload')
    print(json.dumps({'installed':True,'accountCount':len(approved),'codePath':str(target),'bankUser':'financebank','schedule':'11:00 Europe/Moscow','credentialInstalled':Path('/etc/credstore.encrypted/finance-bank-token').exists(),'timerStarted':False}))

if __name__=='__main__':main()
