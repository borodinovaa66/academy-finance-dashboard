"""Unattended Linux collector. Only aggregate candidates persist on disk."""
from pathlib import Path
from datetime import datetime,date,timedelta,timezone
import asyncio,calendar,json,os,re,sys
from bank_daily import MOSCOW,APPROVED_SUFFIXES,build_month,read_pages,atomic_json
from connector import BankMCP,extract_body,SafeError,BankAuthDenied

def record_failure(state,error,transport_blocked):
    if transport_blocked or isinstance(error,BankAuthDenied):atomic_json(state/'auth-blocked.json',{'at':datetime.now(timezone.utc).isoformat(),'reason':'bank_auth_denied'})
    atomic_json(state/'last-run.json',{'stage':'failed','at':datetime.now(timezone.utc).isoformat(),'reason':type(error).__name__})

async def prepare_snapshot(state,client,approved,now=None):
    if (state/'auth-blocked.json').exists():raise SafeError('Bank authentication is blocked pending manual repair')
    now=now or datetime.now(MOSCOW);yesterday=now.astimezone(MOSCOW).date()-timedelta(days=1)
    current=now.astimezone(MOSCOW).strftime('%Y-%m')
    previous=(yesterday.replace(day=1)-timedelta(days=1)).strftime('%Y-%m') if yesterday.strftime('%Y-%m')==current else yesterday.strftime('%Y-%m')
    months=list(dict.fromkeys([previous,current]))
    old=json.loads((state/'last-good.json').read_text()) if (state/'last-good.json').exists() else {'months':{}}
    snapshots=dict(old.get('months',{}))
    async def read(name,args):return extract_body(await asyncio.to_thread(client.call,name,args))
    accounts=await read('getApiV4Bank-accounts',{'withInvest':False})
    if not isinstance(accounts,list) or len(accounts)!=4 or {a['accountNumber'] for a in accounts}!=set(approved):raise SafeError('Approved four-account scope changed')
    for month in months:
        first=date.fromisoformat(month+'-01');last=min(date(first.year,first.month,calendar.monthrange(first.year,first.month)[1]),yesterday)
        if last<first:continue
        if month!=current and snapshots.get(month,{}).get('throughDate')==last.isoformat():continue
        start=datetime.combine(first,datetime.min.time(),MOSCOW);end=datetime.combine(last+timedelta(days=1),datetime.min.time(),MOSCOW)
        bank_accounts=[]
        for account in accounts:
            args={'accountNumber':account['accountNumber'],'from':start.isoformat(),'to':end.isoformat(),'operationStatus':'Transaction','withBalances':True,'limit':200}
            async def page(request):return await read('getApiV1Statement',request)
            body=await read_pages(page,args)
            bank_accounts.append({'suffix':account['accountNumber'][-4:],'name':account.get('name',''),'type':account.get('accountType',account.get('type','')),'currency':account['currency'],'body':body})
        snapshots[month]=build_month(month,last.isoformat(),bank_accounts)
        snapshots[month]['asOf']=datetime.now(timezone.utc).isoformat()
    return {'schemaVersion':1,'updatedAt':datetime.now(timezone.utc).isoformat(),'months':snapshots,'fullCompanyCoverage':False,'source':'approved-server-readonly-bank-mcp'}

async def main():
    state=Path(os.environ.get('STATE_DIRECTORY','/var/lib/finance-bank-sync'))
    if (state/'auth-blocked.json').exists():raise SafeError('Bank authentication blocked; no secret read or retry')
    approved=json.loads(Path('/etc/finance-bank-sync/approved-accounts.json').read_text())['accounts']
    if len(approved)!=4 or len(set(approved))!=4 or any(not re.fullmatch(r'\d{20}',a) for a in approved) or {a[-4:] for a in approved}!=APPROVED_SUFFIXES:
        raise SafeError('Missing or invalid approved account configuration')
    client=BankMCP(approved)
    try:
        value=await prepare_snapshot(state,client,approved)
        atomic_json(state/'candidate.json',value)
        status={'stage':'collected','at':value['updatedAt'],'months':{m:{'through':v['throughDate'],'operations':v['operationCount']} for m,v in value['months'].items()}}
        atomic_json(state/'last-run.json',status);print(json.dumps(status))
    except Exception as error:
        record_failure(state,error,client.blocked)
        raise
    finally:client.close()

if __name__=='__main__':
    try:asyncio.run(main())
    except Exception as error:
        print('Bank sync stopped: '+(str(error) if isinstance(error,SafeError) else type(error).__name__),file=sys.stderr);sys.exit(1)
