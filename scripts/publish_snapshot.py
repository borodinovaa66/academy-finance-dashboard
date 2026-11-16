"""Atomic, bounded receiver for aggregate bank snapshots on the existing server."""
from pathlib import Path
from decimal import Decimal
from datetime import date,timedelta,datetime
import argparse,hashlib,json,os,re,shutil

FIELDS=('externalIncome','interest','externalExpense','refunds')
APPROVED={'9870','6608','7731','4506'}
def cents(v):
    d=Decimal(str(v))*100
    if not d.is_finite() or d!=d.to_integral_value():raise ValueError('Invalid monetary precision')
    return int(d)

def validate_snapshot(value):
    if value.get('schemaVersion')!=1 or not isinstance(value.get('months'),dict) or not value['months']:raise ValueError('Invalid snapshot schema')
    datetime.fromisoformat(value['updatedAt'].replace('Z','+00:00'))
    for key,m in value['months'].items():
        if not re.fullmatch(r'20\d{2}-(0[1-9]|1[0-2])',key) or m.get('complete') is not True:raise ValueError('Month not verified')
        first=date.fromisoformat(key+'-01');last=date.fromisoformat(m['throughDate'])
        if last.strftime('%Y-%m')!=key:raise ValueError('Invalid through date')
        rows=m['rows'];expected=[(first+timedelta(days=i)).isoformat() for i in range((last-first).days+1)]
        if [r['date'] for r in rows]!=expected:raise ValueError('Incomplete or duplicate days')
        accounts=m['accounts']
        if len(accounts)!=4 or {a['suffix'] for a in accounts}!=APPROVED:raise ValueError('Approved account scope changed')
        if sum(a['operations'] for a in accounts)!=m['operationCount']:raise ValueError('Operation count mismatch')
        accumulated={k:0 for k in FIELDS}
        for row in rows:
            for k in FIELDS:
                amount=cents(row[k])
                if amount<0:raise ValueError('Negative cash component')
                accumulated[k]+=amount
                if cents(row['cumulative'][k])!=accumulated[k]:raise ValueError('Cumulative mismatch')
            if cents(row['refunds'])>cents(row['externalExpense']):raise ValueError('Refund outside expense')
            if cents(row['netFlow'])!=cents(row['externalIncome'])+cents(row['interest'])-cents(row['externalExpense']):raise ValueError('Net flow mismatch')
            if cents(row['cumulative']['netFlow'])!=accumulated['externalIncome']+accumulated['interest']-accumulated['externalExpense']:raise ValueError('Cumulative flow mismatch')
        if not rows:raise ValueError('No verified days')
        for k,v in accumulated.items():
            if cents(m['totals'][k])!=v:raise ValueError('Month total mismatch')
        if cents(m['totals']['netFlow'])!=accumulated['externalIncome']+accumulated['interest']-accumulated['externalExpense']:raise ValueError('Total net flow mismatch')
        balance=sum(cents(a['closing']) for a in accounts if a['currency']=='643')
        if cents(rows[-1]['cashBalance'])!=balance or cents(m['totals']['cashBalance'])!=balance:raise ValueError('Closing balance mismatch')
    return True

def main():
    import pwd
    p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('sha256');args=p.parse_args()
    source=Path(args.source)
    if source.is_symlink() or source.resolve().parent!=Path('/tmp') or not re.fullmatch(r'finance-bank-daily-[A-Za-z0-9-]+\.json',source.name):raise ValueError('Unexpected incoming path')
    data=source.read_bytes()
    if len(data)>2_000_000 or hashlib.sha256(data).hexdigest()!=args.sha256:raise ValueError('Incoming checksum/size mismatch')
    value=json.loads(data);validate_snapshot(value)
    folder=Path('/opt/finance-dashboard/private')
    if folder.resolve()!=folder:raise ValueError('Unexpected private directory')
    folder.mkdir(exist_ok=True)
    target=folder/'bank-daily.json'
    if target.exists():
        previous=json.loads(target.read_text())
        if datetime.fromisoformat(value['updatedAt'].replace('Z','+00:00'))<datetime.fromisoformat(previous['updatedAt'].replace('Z','+00:00')):raise ValueError('Older snapshot rejected')
        shutil.copy2(target,folder/'bank-daily.previous.json')
    temp=folder/'bank-daily.incoming.json'
    temp.write_bytes(data)
    identity=pwd.getpwnam('financeapp')
    os.chown(temp,identity.pw_uid,identity.pw_gid);os.chmod(temp,0o600)
    os.replace(temp,target)
    source.unlink()
    print(json.dumps({'published':True,'sha256':args.sha256,'updatedAt':value['updatedAt'],'months':list(value['months'])}))

if __name__=='__main__':main()
