"""Read approved bank MCP, reconcile each account, publish aggregate-only snapshots.

Uses the existing local DPAPI-backed adapter. No bank credentials leave Windows.
"""
from pathlib import Path
from decimal import Decimal
from datetime import datetime, date, timedelta, timezone
import argparse, asyncio, calendar, hashlib, json, os, re, sys

ROOT=Path(__file__).resolve().parents[1]
MOSCOW=timezone(timedelta(hours=3))
FIELDS=('externalIncome','interest','externalExpense','refunds','transferIn','transferOut')
ADAPTER=Path('C:/Users/User/.codex/integrations/tbank-readonly/server.py')
APPROVED_SUFFIXES={'9870','6608','7731','4506'}

def minor(v):
    d=Decimal(str(v))*100
    if d!=d.to_integral_value():raise ValueError('Bank amount has fractions below kopeks')
    return int(d)

def classify(o):
    text=(str(o.get('payPurpose',''))+' '+str(o.get('description',''))).lower()
    credit=o['typeOfOperation']=='Credit'
    cat=o.get('category','')
    # Overnight interest is earned on the deposit account and then transferred.
    # The return to the current account is not a second interest income.
    if 'возврат процентов' in text:return 'transferIn' if credit else 'transferOut'
    if credit and re.search(r'(выплата|начислени[ея]).{0,30}процент',text):return 'interest'
    if cat in ('selfTransferInner','selfTransferOuter','selfIncomeOuter'):
        return 'transferIn' if credit else 'transferOut'
    if re.search(r'(размещение|возврат).{0,35}(депозит|овернайт)',text):
        return 'transferIn' if credit else 'transferOut'
    return 'externalIncome' if credit else 'externalExpense'

def is_refund(o):
    return o['typeOfOperation']=='Debit' and bool(re.search(r'возврат.{0,80}(покупател|клиент|по заявк)',str(o.get('payPurpose','')).lower()))

async def read_pages(call, arguments):
    args=dict(arguments);first=None;operations=[];cursors=set()
    for _ in range(100):
        body=await call(args)
        if not isinstance(body,dict) or not isinstance(body.get('operations'),list):raise ValueError('Missing bank operations')
        if first is None:first=dict(body)
        operations.extend(body['operations'])
        cursor=body.get('nextCursor')
        if not cursor:
            first['operations']=operations;first['nextCursor']=None
            return first
        if cursor in cursors:raise ValueError('Repeated pagination cursor; incomplete statement')
        cursors.add(cursor);args['cursor']=cursor;args['withBalances']=False
    raise ValueError('Statement exceeds bounded pagination; not published')

def build_month(month, end_day, accounts):
    start=date.fromisoformat(month+'-01');end=date.fromisoformat(end_day)
    if end<start or end.strftime('%Y-%m')!=month:raise ValueError('Invalid monthly interval')
    days=[(start+timedelta(days=i)).isoformat() for i in range((end-start).days+1)]
    buckets={day:{k:0 for k in FIELDS}|{'cashBalance':0,'operationCount':0} for day in days}
    account_meta=[];source_hashes=[]
    for account in accounts:
        body=account['body'];balances=body.get('balances')
        if body.get('nextCursor') or not isinstance(balances,dict):raise ValueError('Incomplete statement or missing balances')
        ops=body['operations'];ids=[str(o['operationId']) for o in ops]
        if len(set(ids))!=len(ids) or len(ids)!=balances['operationsCount']:raise ValueError('Duplicate IDs or operation count mismatch')
        incoming=sum(minor(o['accountAmount']) for o in ops if o['typeOfOperation']=='Credit')
        outgoing=sum(minor(o['accountAmount']) for o in ops if o['typeOfOperation']=='Debit')
        opening=minor(balances['balanceBegin']);closing=minor(balances['balanceEnd'])
        if incoming!=minor(balances['credit']) or outgoing!=minor(balances['debit']) or opening+incoming-outgoing!=closing:
            raise ValueError('Bank statement reconciliation failed')
        account_meta.append({k:account[k] for k in ('suffix','name','type','currency')}|{'operations':len(ops),'closing':closing/100})
        source_hashes.append(hashlib.sha256('\n'.join(sorted(ids)).encode()).hexdigest())
        if account['currency']!='643':continue
        daily={day:{'credit':0,'debit':0} for day in days}
        for o in ops:
            if o['typeOfOperation'] not in ('Credit','Debit'):raise ValueError('Unconfirmed operation type')
            day=datetime.fromisoformat(o['operationDate'].replace('Z','+00:00')).astimezone(MOSCOW).date().isoformat()
            if day not in buckets:raise ValueError('Operation outside requested Moscow interval')
            amount=minor(o['accountAmount'])
            if amount<0:raise ValueError('Negative account amount')
            daily[day]['credit' if o['typeOfOperation']=='Credit' else 'debit']+=amount
            buckets[day][classify(o)]+=amount
            buckets[day]['operationCount']+=1
            if is_refund(o) and classify(o)=='externalExpense':buckets[day]['refunds']+=amount
        running=opening
        by_day={r['date']:r for r in balances.get('balances',[])}
        for day in days:
            running+=daily[day]['credit']-daily[day]['debit']
            if day in by_day:
                check=by_day[day]
                if minor(check['balanceEnd'])!=running or minor(check['credit'])!=daily[day]['credit'] or minor(check['debit'])!=daily[day]['debit']:
                    raise ValueError('Bank daily balance/date reconciliation failed')
            buckets[day]['cashBalance']+=running
        if running!=closing:raise ValueError('Closing balance mismatch')
    if not any(a['currency']=='643' for a in accounts):raise ValueError('No approved ruble accounts')
    cumulative={k:0 for k in FIELDS};rows=[]
    for day in days:
        raw=buckets[day]
        for k in FIELDS:cumulative[k]+=raw[k]
        net=raw['externalIncome']+raw['interest']-raw['externalExpense']
        row={'date':day,**{k:raw[k]/100 for k in FIELDS},'cashBalance':raw['cashBalance']/100,'netFlow':net/100,'operationCount':raw['operationCount'],'confirmed':True}
        row['cumulative']={k:v/100 for k,v in cumulative.items()}|{'netFlow':(cumulative['externalIncome']+cumulative['interest']-cumulative['externalExpense'])/100}
        rows.append(row)
    totals=rows[-1]['cumulative']|{'cashBalance':rows[-1]['cashBalance']}
    return {'month':month,'throughDate':end_day,'rows':rows,'totals':totals,'accounts':account_meta,'complete':True,
            'operationCount':sum(a['operations'] for a in account_meta),'sourceHashes':source_hashes,'source':'bank','scope':'Т-Банк · три рублёвых счёта, включая овернайт; евро отдельно; ВТБ не включён',
            'classification':'По категориям банка и явным назначениям. Возвраты — только явно опознанные, входят в списания. Это движения денег, не начисленные расходы или прибыль.',
            'missingDays':[]}

def atomic_json(path, value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(path.suffix+'.tmp')
    temp.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
    os.replace(temp,path)

def payload(result):
    if result.isError:raise ValueError('Approved bank MCP read failed; no retry or token changes')
    value=result.structuredContent
    if value is None:
        for c in result.content:
            if c.type=='text':
                try:value=json.loads(c.text);break
                except ValueError:pass
    if isinstance(value,dict) and 'data' in value:value=value['data']
    if not isinstance(value,dict) or value.get('status')!=200:raise ValueError('Bank did not return verified HTTP 200')
    return value['body']

async def collect(args):
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    now=datetime.now(MOSCOW);yesterday=now.date()-timedelta(days=1)
    current=now.strftime('%Y-%m');previous=(now.date().replace(day=1)-timedelta(days=1)).strftime('%Y-%m')
    months=args.months or [previous,current]
    path=Path(args.output)
    previous_snapshot=json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'months':{}}
    snapshots=dict(previous_snapshot.get('months',{}))
    params=StdioServerParameters(command=sys.executable,args=['-X','utf8',str(ADAPTER)])
    async with stdio_client(params) as (reader,writer):
      async with ClientSession(reader,writer) as session:
        await session.initialize()
        accounts=payload(await session.call_tool('getApiV4Bank-accounts',{'withInvest':False}))
        if not isinstance(accounts,list) or {a['accountNumber'][-4:] for a in accounts}!=APPROVED_SUFFIXES or len(accounts)!=4:
            raise ValueError('Approved four-account scope changed; stop, do not expand')
        for month in months:
            if not re.fullmatch(r'20\d{2}-(0[1-9]|1[0-2])',month):raise ValueError('Invalid month')
            first=date.fromisoformat(month+'-01')
            last=min(date(first.year,first.month,calendar.monthrange(first.year,first.month)[1]),yesterday)
            if last<first:continue
            if month!=current and snapshots.get(month,{}).get('throughDate')==last.isoformat() and not args.refresh_history:continue
            start=datetime.combine(first,datetime.min.time(),MOSCOW)
            end=datetime.combine(last+timedelta(days=1),datetime.min.time(),MOSCOW)
            read_accounts=[]
            for a in accounts:
                call_args={'accountNumber':a['accountNumber'],'from':start.isoformat(),'to':end.isoformat(),
                  'operationStatus':'Transaction','withBalances':True,'limit':200}
                async def call(request):return payload(await session.call_tool('getApiV1Statement',request))
                body=await read_pages(call,call_args)
                item={'suffix':a['accountNumber'][-4:],'name':a.get('name',''),'type':a.get('accountType',a.get('type','')),'currency':a.get('currency',''),'body':body}
                # Account type is not used to infer income; all original rows stay local.
                atomic_json(ROOT/'local-state'/'bank-source'/f'{month}-{item["suffix"]}.json',item)
                read_accounts.append(item)
            snapshots[month]=build_month(month,last.isoformat(),read_accounts)
            snapshots[month]['asOf']=datetime.now(timezone.utc).isoformat()
    result={'schemaVersion':1,'updatedAt':datetime.now(timezone.utc).isoformat(),'months':snapshots,'fullCompanyCoverage':False,'source':'approved-local-readonly-bank-mcp'}
    atomic_json(path,result)
    print(json.dumps({'status':'verified','months':{m:{'through':s['throughDate'],'operations':s['operationCount']} for m,s in snapshots.items()},'output':str(path)},ensure_ascii=False))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--months',nargs='+');p.add_argument('--refresh-history',action='store_true')
    p.add_argument('--output',default=str(ROOT/'private'/'bank-daily.json'));arguments=p.parse_args()
    try:asyncio.run(collect(arguments))
    except Exception as error:
        print(f'Bank sync stopped: {type(error).__name__}: {error}',file=sys.stderr);sys.exit(1)
