"""Install this feature's exact files with a hash guard and rollback copies.
No database, bank-job, role, source-workbook or accounting changes.
"""
from pathlib import Path
from datetime import datetime, timezone
import argparse, hashlib, json, os, pwd, shutil, subprocess, tarfile

APP=Path('/opt/finance-dashboard')
CODE=Path('/opt/finance-budget-sync')
MODULES=['src/budget.js','src/cash-plan.js','src/budget-generation.js']
APP_FILES=MODULES+['public/cabinet-budget.js']
SERVER=['server-budget/collect.js','server-budget/transform.js','server-budget/publish.js']
UNITS=['finance-budget-sync.service','finance-budget-publish.service','finance-budget-sync.timer']
FILES=set(APP_FILES+SERVER+['server-budget/'+u for u in UNITS]+['manifest.json'])
def run(*args):return subprocess.run(args,check=True,capture_output=True,text=True).stdout.strip()
def main():
 p=argparse.ArgumentParser();p.add_argument('archive');p.add_argument('sha256');a=p.parse_args();archive=Path(a.archive)
 if archive.resolve().parent!=Path('/tmp') or archive.is_symlink():raise ValueError('Unexpected archive path')
 if hashlib.sha256(archive.read_bytes()).hexdigest()!=a.sha256:raise ValueError('Archive checksum mismatch')
 with tarfile.open(archive,'r:gz') as t:
  members=t.getmembers()
  if set(m.name for m in members)!=FILES or any(not m.isfile() for m in members):raise ValueError('Unexpected archive member')
  manifest=json.load(t.extractfile('manifest.json'))
  for name,expected in manifest['expectedServerHashes'].items():
   f=APP/name
   actual=hashlib.sha256(f.read_bytes()).hexdigest() if f.exists() else None
   if actual!=expected:raise ValueError('Server changed since review: '+name)
  try:worker=pwd.getpwnam('financebudget')
  except KeyError:
   run('useradd','--system','--user-group','--home-dir','/nonexistent','--no-create-home','--shell','/usr/sbin/nologin','financebudget');worker=pwd.getpwnam('financebudget')
  appuser=pwd.getpwnam('financeapp')
  stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
  backup=Path('/opt/finance-dashboard-backups')/(stamp+'-budget-sync');backup.mkdir(parents=True,mode=0o700)
  for name in APP_FILES:
   src=APP/name
   if src.exists():dst=backup/name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
  for root in [CODE,APP/'private/budget-sync']:
   if root.exists() and root.is_symlink():raise ValueError('Unexpected symlink')
  CODE.mkdir(mode=0o755,exist_ok=True)
  for m in members:
   if m.name=='manifest.json':continue
   dest=CODE/m.name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(t.extractfile(m).read());os.chown(dest,0,0);os.chmod(dest,0o644)
 config=CODE/'server-budget/config';config.mkdir(mode=0o750,exist_ok=True);os.chown(config,0,worker.pw_gid)
 # Private seed keeps other months and source metadata; never serves these files.
 from_file=APP/'private'
 pointer=from_file/'budget-sync/current.json'
 if pointer.exists():from_file=from_file/'budget-sync/generations'/json.loads(pointer.read_text())['generation']
 for name in ['budget-explorer.json','cash-plan.json']:
  dest=config/name;shutil.copy2(from_file/name,dest);os.chown(dest,0,worker.pw_gid);os.chmod(dest,0o640)
 state=Path('/var/lib/finance-budget-sync');state.mkdir(mode=0o700,exist_ok=True);os.chown(state,worker.pw_uid,worker.pw_gid);os.chmod(state,0o700)
 for name in MODULES+SERVER:run('/usr/bin/node','--check',str(CODE/name))
 # Change no application files until the isolated collector code passes syntax checks.
 for name in APP_FILES:
  dest=APP/name;tmp=dest.with_name(dest.name+'.budget-sync-new');shutil.copy2(CODE/name,tmp);os.chown(tmp,appuser.pw_uid,appuser.pw_gid);os.chmod(tmp,0o644);os.replace(tmp,dest)
 for name in UNITS:shutil.copy2(CODE/'server-budget'/name,Path('/etc/systemd/system')/name)
 env=Path('/etc/finance-budget-publisher');env.write_text(f'FINANCE_UID={appuser.pw_uid}\nFINANCE_GID={appuser.pw_gid}\n');os.chmod(env,0o600)
 run('systemd-analyze','verify',*[str(Path('/etc/systemd/system')/name) for name in UNITS])
 run('systemctl','daemon-reload');run('systemctl','restart','finance-dashboard')
 run('systemctl','enable','--now','finance-budget-sync.timer')
 print(json.dumps({'installed':True,'backup':str(backup),'timerEnabled':True,'credentialEncrypted':Path('/etc/credstore.encrypted/finance-budget-google').exists(),'appFiles':APP_FILES,'databaseChanged':False}))
if __name__=='__main__':main()
