"""Deploy an explicit file set, keep SQLite and credentials intact, retain rollback."""
from pathlib import Path
import argparse,hashlib,json,os,pwd,shutil,sqlite3,subprocess,tarfile,time
from datetime import datetime,timezone

FILES={'.gitignore','server.js','src/database.js','src/daily.js','public/app.js','public/cabinet-daily.js','public/cabinet-daily.css',
       'scripts/publish_snapshot.py','private/cabinet.html','private/bank-daily.json'}
BUDGET_FILES={'src/daily.js','src/cash-plan.js','public/cabinet-daily.js','public/cabinet-daily.css','private/cabinet.html','private/cash-plan.json'}

def run(*cmd):return subprocess.run(cmd,check=True,capture_output=True,text=True).stdout.strip()
def main():
    p=argparse.ArgumentParser();p.add_argument('archive');p.add_argument('sha256');p.add_argument('commit');p.add_argument('--budget-only',action='store_true');args=p.parse_args()
    files=BUDGET_FILES if args.budget_only else FILES
    archive=Path(args.archive)
    if archive.resolve().parent!=Path('/tmp') or archive.is_symlink() or not archive.name.startswith('finance-cabinet-release-'):raise ValueError('Unexpected release archive')
    if hashlib.sha256(archive.read_bytes()).hexdigest()!=args.sha256:raise ValueError('Archive checksum mismatch')
    target=Path('/opt/finance-dashboard')
    if target.resolve()!=target or not (target/'data/finance-dashboard.sqlite').is_file():raise ValueError('Unexpected target')
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup=Path('/opt/finance-dashboard-backups')/stamp
    backup.mkdir(parents=True,mode=0o700)
    staged=backup/'staged';staged.mkdir()
    with tarfile.open(archive,'r:gz') as tar:
        members=tar.getmembers()
        if {m.name for m in members}!=files or any(not m.isfile() for m in members):raise ValueError('Release contains unexpected files')
        tar.extractall(staged,filter='data')
    if args.budget_only:
        checked=json.loads(run('/usr/bin/node','-e',"console.log(JSON.stringify(require(process.argv[1]).readCashPlan(process.argv[2],'2026-11')))",str(staged/'src/cash-plan.js'),str(staged/'private')))
        if checked['income']['total']!=11755000 or checked['expense']['total']!=7194381:raise ValueError('Unexpected reviewed budget')
    else:
        from importlib.util import spec_from_file_location,module_from_spec
        spec=spec_from_file_location('publish_snapshot',staged/'scripts/publish_snapshot.py');publisher=module_from_spec(spec);spec.loader.exec_module(publisher)
        publisher.validate_snapshot(json.loads((staged/'private/bank-daily.json').read_text()))
    for name in files:
        if name.endswith('.js'):run('/usr/bin/node','--check',str(staged/name))
    copied=[]
    for relative in files:
        original=target/relative
        if original.is_symlink():raise ValueError('Symlink in deployment file path')
        if original.exists():
            dest=backup/'files'/relative;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(original,dest);copied.append(relative)
    source=sqlite3.connect('file:'+str(target/'data/finance-dashboard.sqlite')+'?mode=ro',uri=True)
    before=source.execute('select count(*),max(report_date),sum(client_income),sum(expense) from daily_entries').fetchone()
    dbbackup=sqlite3.connect(backup/'finance-dashboard.sqlite');source.backup(dbbackup);dbbackup.close();source.close()
    os.chmod(backup/'finance-dashboard.sqlite',0o600)
    identity=pwd.getpwnam('financeapp')
    try:
        run('systemctl','stop','finance-dashboard')
        for relative in sorted(files):
            destination=target/relative;destination.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(staged/relative,destination);os.chown(destination,identity.pw_uid,identity.pw_gid)
            os.chmod(destination,0o600 if relative.startswith('private/') else 0o644)
        os.chown(target/'private',identity.pw_uid,identity.pw_gid);os.chmod(target/'private',0o750)
        run('systemctl','start','finance-dashboard')
        for _ in range(25):
            import urllib.request
            try:
                if urllib.request.urlopen('http://127.0.0.1:3020/api/auth/me',timeout=2).status==200:break
            except Exception:time.sleep(.2)
        else:raise RuntimeError('Health check failed')
        c=sqlite3.connect('file:'+str(target/'data/finance-dashboard.sqlite')+'?mode=ro',uri=True)
        after=c.execute('select count(*),max(report_date),sum(client_income),sum(expense) from daily_entries').fetchone();c.close()
        if after!=before:raise RuntimeError('Financial records changed during deployment; stop for review, never restore live DB automatically')
        result={'deployed':True,'commit':args.commit,'archiveSha256':args.sha256,'backup':str(backup),'manualRowsPreserved':after[0],'manualLatestDate':after[1],'service':run('systemctl','is-active','finance-dashboard'),'deployedAt':stamp}
        (target/'private/release.json').write_text(json.dumps(result,indent=2));os.chown(target/'private/release.json',identity.pw_uid,identity.pw_gid);os.chmod(target/'private/release.json',0o600)
        print(json.dumps(result))
    except Exception:
        for relative in copied:shutil.copy2(backup/'files'/relative,target/relative)
        run('systemctl','restart','finance-dashboard')
        raise

if __name__=='__main__':main()
