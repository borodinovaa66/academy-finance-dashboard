"""Install a narrowly scoped reader and preserve unrelated services and data."""
from pathlib import Path
from datetime import datetime, timezone
import argparse,hashlib,json,os,pwd,shutil,subprocess,tarfile
APP=Path('/opt/finance-dashboard');CODE=Path('/opt/finance-receivables-sync')
APP_FILES=['src/daily.js','src/daily-sources.js','public/cabinet-daily.js']
SERVER=['server-receivables/'+f for f in ['collect.js','publish.js','transform.js','finance-receivables-sync.service','finance-receivables-publish.service','finance-receivables-sync.timer']]
FILES=set(APP_FILES+SERVER+['manifest.json'])
def run(*a):return subprocess.run(a,check=True,capture_output=True,text=True).stdout.strip()
def main():
 p=argparse.ArgumentParser();p.add_argument('archive');p.add_argument('sha256');a=p.parse_args();archive=Path(a.archive)
 if archive.resolve().parent!=Path('/tmp') or archive.is_symlink() or not archive.name.startswith('finance-receivables-release-'):raise ValueError('Unexpected archive')
 if hashlib.sha256(archive.read_bytes()).hexdigest()!=a.sha256:raise ValueError('Archive checksum')
 for root in [APP,CODE,APP/'private']:
  if root.exists() and root.resolve()!=root:raise ValueError('Unexpected symlink')
 with tarfile.open(archive,'r:gz') as t:
  members=t.getmembers()
  if set(m.name for m in members)!=FILES or any(not m.isfile() for m in members):raise ValueError('Unexpected members')
  manifest=json.load(t.extractfile('manifest.json'))
  for n,h in manifest['expectedServerHashes'].items():
   if n not in APP_FILES or hashlib.sha256((APP/n).read_bytes()).hexdigest()!=h:raise ValueError('Server changed: '+n)
  try:worker=pwd.getpwnam('financereceivables')
  except KeyError:
   run('useradd','--system','--user-group','--home-dir','/nonexistent','--no-create-home','--shell','/usr/sbin/nologin','financereceivables');worker=pwd.getpwnam('financereceivables')
  identity=pwd.getpwnam('financeapp');stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ');backup=Path('/opt/finance-dashboard-backups')/(stamp+'-receivables');backup.mkdir(parents=True,mode=0o700)
  CODE.mkdir(mode=0o755,exist_ok=True)
  for name in APP_FILES+SERVER:
   destination=APP/name if name in APP_FILES else CODE/name
   if destination.is_symlink():raise ValueError('Unexpected destination link')
   if destination.exists():saved=backup/name;saved.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(destination,saved)
   if name in SERVER:
    destination.parent.mkdir(parents=True,exist_ok=True);destination.write_bytes(t.extractfile(name).read());os.chmod(destination,0o644);os.chown(destination,0,0)
  shared=CODE/'src/daily-sources.js';shared.parent.mkdir(exist_ok=True);shared.write_bytes(t.extractfile('src/daily-sources.js').read());os.chmod(shared,0o644)
  for n in SERVER:
   if n.endswith('.js'):run('/usr/bin/node','--check',str(CODE/n))
  for n in SERVER:
   if n.endswith(('.service','.timer')):
    dst=Path('/etc/systemd/system')/Path(n).name
    if dst.exists():shutil.copy2(dst,backup/dst.name)
    shutil.copy2(CODE/n,dst);os.chmod(dst,0o644)
  env=Path('/etc/finance-receivables-publisher');env.write_text(f'FINANCE_UID={identity.pw_uid}\nFINANCE_GID={identity.pw_gid}\n');os.chmod(env,0o600)
  run('systemctl','daemon-reload');run('systemctl','start','finance-receivables-sync.service');run('systemctl','start','finance-receivables-publish.service')
  status=json.loads(Path('/var/lib/finance-receivables-sync/status.json').read_text())
  if status['state']!='ok':raise ValueError('Real-source collection failed; web code unchanged')
  # Only after real-source success, replace this feature's web modules.
  staged=backup/'web-staged';staged.mkdir()
  for name in APP_FILES:
   destination=staged/name;destination.parent.mkdir(parents=True,exist_ok=True);destination.write_bytes(t.extractfile(name).read())
   run('/usr/bin/node','--check',str(destination))
  try:
   for name in APP_FILES:
    destination=APP/name;shutil.copy2(staged/name,destination);os.chmod(destination,0o644);os.chown(destination,identity.pw_uid,identity.pw_gid)
   run('systemctl','restart','finance-dashboard')
   import urllib.request,time
   for _ in range(20):
    try:
     if urllib.request.urlopen('http://127.0.0.1:3020/api/auth/me',timeout=2).status==200:break
    except Exception:time.sleep(.2)
   else:raise ValueError('Dashboard health failed')
  except Exception:
   for name in APP_FILES:shutil.copy2(backup/name,APP/name)
   run('systemctl','restart','finance-dashboard')
   raise
 run('systemctl','enable','--now','finance-receivables-sync.timer')
 import sqlite3
 db=sqlite3.connect('file:'+str(APP/'data/finance-dashboard.sqlite')+'?mode=ro',uri=True);rows=db.execute('select count(*) from daily_entries').fetchone()[0];db.close()
 print(json.dumps({'installed':True,'backup':str(backup),'collector':status,'manualRows':rows,'timer':run('systemctl','is-active','finance-receivables-sync.timer')}))
if __name__=='__main__':main()
