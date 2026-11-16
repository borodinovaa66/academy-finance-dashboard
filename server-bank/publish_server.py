"""Separate publisher: no bank credential, no primary database access."""
from pathlib import Path
from datetime import datetime
import hashlib,json,os,tempfile,stat
from publish_snapshot import validate_snapshot

def secure_write(path,raw,uid,gid):
    descriptor,temporary=tempfile.mkstemp(prefix='.verified-',dir=path.parent)
    try:
        with os.fdopen(descriptor,'wb') as handle:
            if hasattr(os,'fchmod'):os.fchmod(handle.fileno(),0o600)
            if uid is not None:os.fchown(handle.fileno(),uid,gid)
            handle.write(raw);handle.flush();os.fsync(handle.fileno())
        os.replace(temporary,path)
    finally:
        try:os.unlink(temporary)
        except FileNotFoundError:pass

def secure_json(path,value,uid,gid):secure_write(path,json.dumps(value,ensure_ascii=False,indent=2).encode('utf-8'),uid,gid)

def main():
    import pwd
    state=Path('/var/lib/finance-bank-sync');source=state/'candidate.json'
    private=Path('/opt/finance-dashboard/private');target=private/'bank-daily.json'
    if state.resolve()!=state or private.resolve()!=private or source.is_symlink() or target.is_symlink():raise ValueError('Unexpected publication path')
    descriptor=os.open(source,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(descriptor,'rb') as handle:
        if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):raise ValueError('Unexpected candidate type')
        raw=handle.read(2_000_001)
    if len(raw)>2_000_000:raise ValueError('Snapshot too large')
    value=json.loads(raw);validate_snapshot(value)
    web=pwd.getpwnam('financeapp');bank=pwd.getpwnam('financebank')
    if target.exists():
        previous=json.loads(target.read_text())
        if datetime.fromisoformat(value['updatedAt'].replace('Z','+00:00'))<datetime.fromisoformat(previous['updatedAt'].replace('Z','+00:00')):raise ValueError('Stale candidate rejected')
        secure_write(private/'bank-daily.previous.json',target.read_bytes(),web.pw_uid,web.pw_gid)
    secure_write(target,raw,web.pw_uid,web.pw_gid)
    secure_json(state/'last-good.json',value,bank.pw_uid,bank.pw_gid)
    status={'stage':'published','at':value['updatedAt'],'sha256':hashlib.sha256(raw).hexdigest(),'months':{m:{'through':v['throughDate'],'operations':v['operationCount']} for m,v in value['months'].items()}}
    secure_json(state/'last-run.json',status,bank.pw_uid,bank.pw_gid)
    secure_json(private/'bank-sync-status.json',status,web.pw_uid,web.pw_gid)
    print(json.dumps(status))

if __name__=='__main__':main()
