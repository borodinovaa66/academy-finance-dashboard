"""Run over the existing approved SSH route. Deploy only the budget module.

No credentials, user permissions, source Sheets, payment registers, bank jobs or
financial DB rows are changed. Failed release rolls back its files, never the DB.
"""
from pathlib import Path
from datetime import datetime,timezone
import argparse,fcntl,hashlib,json,os,pwd,re,shutil,sqlite3,subprocess,tarfile,time,urllib.request,urllib.error
FILES={'server.js','src/budget.js','public/cabinet-budget.js','public/cabinet-budget.css','private/budget-explorer.json'}
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(*cmd):return subprocess.run(cmd,check=True,capture_output=True,text=True).stdout.strip()
def financial_state(root):
 c=sqlite3.connect('file:'+str(root/'data/finance-dashboard.sqlite')+'?mode=ro',uri=True)
 result={}
 for table in ['daily_entries','plans','users']:
  rows=c.execute('SELECT * FROM '+table+' ORDER BY 1').fetchall()
  result[table]={'rows':len(rows),'sha256':hashlib.sha256(json.dumps(rows,default=str,separators=(',',':')).encode()).hexdigest()}
 c.close();return result
def main():
 p=argparse.ArgumentParser();p.add_argument('archive');p.add_argument('sha256');p.add_argument('expected_server_sha256');args=p.parse_args()
 archive=Path(args.archive)
 if not re.fullmatch(r'/tmp/finance-budget-release-[a-z0-9]+/budget.tgz',str(archive)) or archive.is_symlink():raise ValueError('Unexpected archive path')
 if digest(archive)!=args.sha256:raise ValueError('Archive checksum mismatch')
 target=Path('/opt/finance-dashboard')
 if target.resolve()!=target or not (target/'data/finance-dashboard.sqlite').is_file():raise ValueError('Unexpected target')
 if digest(target/'server.js')!=args.expected_server_sha256:raise ValueError('Server changed since review; nothing deployed')
 lock=open('/var/lock/finance-budget-release.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 backup=Path('/opt/finance-dashboard-backups')/(stamp+'-budget');backup.mkdir(mode=0o700)
 staged=backup/'staged';staged.mkdir(mode=0o700)
 with tarfile.open(archive,'r:gz') as tar:
  members=tar.getmembers()
  if {m.name for m in members}!=FILES or len(members)!=len(FILES) or any(not m.isfile() for m in members):raise ValueError('Unexpected release files')
  tar.extractall(staged,filter='data')
 for name in FILES:
  if name.endswith('.js'):run('/usr/bin/node','--check',str(staged/name))
 checked=json.loads(run('/usr/bin/node','-e',"const x=require(process.argv[1]).readBudget(process.argv[2],'2026-11','owner'); console.log(JSON.stringify({income:x.income.amount,expense:x.expense.amount}));",str(staged/'src/budget.js'),str(staged/'private')))
 cash_plan=target/'private/cash-plan.json'
 if cash_plan.exists():
  reference=json.loads(cash_plan.read_text())['months']['2026-11']
  if checked!={'income':reference['income']['total'],'expense':reference['expense']['total']}:raise ValueError('Interactive budget differs from the published reviewed cash-plan version')
 before=financial_state(target);cabinet_before=digest(target/'private/cabinet.html')
 copied=[];new=[]
 for name in FILES:
  original=target/name
  if original.is_symlink() or original.parent.resolve()!=original.parent:raise ValueError('Unexpected target symlink')
  if original.exists():
   saved=backup/'files'/name;saved.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(original,saved);copied.append(name)
  else:new.append(name)
 c=sqlite3.connect('file:'+str(target/'data/finance-dashboard.sqlite')+'?mode=ro',uri=True);bc=sqlite3.connect(backup/'finance-dashboard.sqlite');c.backup(bc);bc.close();c.close();os.chmod(backup/'finance-dashboard.sqlite',0o600)
 identity=pwd.getpwnam('financeapp')
 if digest(target/'server.js')!=args.expected_server_sha256:raise ValueError('Concurrent release detected; nothing changed')
 try:
  run('systemctl','stop','finance-dashboard')
  for name in sorted(FILES):
   dest=target/name;dest.parent.mkdir(parents=True,exist_ok=True)
   temp=dest.with_name(dest.name+'.budget-new');shutil.copy2(staged/name,temp)
   os.chown(temp,identity.pw_uid,identity.pw_gid);os.chmod(temp,0o600 if name.startswith('private/') else 0o644);os.replace(temp,dest)
  run('systemctl','start','finance-dashboard')
  for _ in range(25):
   try:
    with urllib.request.urlopen('http://127.0.0.1:3020/api/auth/me',timeout=2) as response:
     if response.status==200:break
   except Exception:time.sleep(.2)
  else:raise RuntimeError('Health check failed')
  try:urllib.request.urlopen('http://127.0.0.1:3020/api/cabinet/budget?month=2026-11',timeout=5)
  except urllib.error.HTTPError as e:
   if e.code!=401:raise RuntimeError('Anonymous budget access not protected')
  else:raise RuntimeError('Anonymous budget unexpectedly readable')
  after=financial_state(target)
  if after!=before:raise RuntimeError('Concurrent database change detected; never restore financial database')
  if digest(target/'private/cabinet.html')!=cabinet_before:raise RuntimeError('Other cabinet release changed during publication')
  result={'deployed':True,'url':'https://finance.academy-management.ru/cabinet#budget','deployedAt':stamp,'backup':str(backup),'snapshot':checked,'files':{n:digest(target/n) for n in sorted(FILES)},'manualRows':after['daily_entries']['rows'],'financialRowsAndUsersUnchanged':True,'cabinetFileUnchanged':True,'bankJobsUnchanged':True,'service':run('systemctl','is-active','finance-dashboard')}
  (backup/'result.json').write_text(json.dumps(result,indent=2));os.chmod(backup/'result.json',0o600)
  print(json.dumps(result))
 except Exception:
  for name in copied:shutil.copy2(backup/'files'/name,target/name)
  for name in new:
   dest=target/name
   if dest.exists() and dest.is_file() and not dest.is_symlink():dest.unlink()
  run('systemctl','restart','finance-dashboard');raise
 finally:
  archive.unlink(missing_ok=True)
if __name__=='__main__':main()
