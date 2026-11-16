"""Run on the server as the service user. Existing credentials stay in memory."""
from pathlib import Path
import hashlib,http.cookiejar,json,urllib.request,urllib.error

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def main():
    base='http://127.0.0.1:3020'
    jar=http.cookiejar.CookieJar();opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar),NoRedirect())
    def get(path):
        try:
            with opener.open(base+path,timeout=10) as r:return r.status,r.read(),r.headers
        except urllib.error.HTTPError as e:return e.code,e.read(),e.headers
    checks={}
    checks['anonymousCabinet']=get('/cabinet')[0]
    checks['anonymousDaily']=get('/api/cabinet/daily?month=2026-11')[0]
    assert checks['anonymousCabinet']==302 and checks['anonymousDaily']==401
    values={}
    for line in Path('/opt/finance-dashboard/.env').read_text().splitlines():
        key,sep,value=line.partition('=')
        if sep and key.strip() in ('OWNER_LOGIN','OWNER_PASSWORD'):values[key.strip()]=value.strip().strip('"').strip("'")
    if not values.get('OWNER_LOGIN') or not values.get('OWNER_PASSWORD'):
        print(json.dumps({'status':'publicChecksPassed','checks':checks,'ownerReadback':'existing credential fields unavailable; no credential changes made'}));return
    data=json.dumps({'login':values['OWNER_LOGIN'],'password':values['OWNER_PASSWORD']}).encode()
    request=urllib.request.Request(base+'/api/auth/login',data=data,headers={'Content-Type':'application/json'})
    try:
        with opener.open(request,timeout=10) as r:
            user=json.load(r)['user'];assert user['role']=='owner'
    except urllib.error.HTTPError as error:
        values.clear();data=None
        if error.code==401:
            print(json.dumps({'status':'publicChecksPassed','checks':checks,'ownerReadback':'existing environment credential is not current; no resets or further login attempts'}));return
        raise
    values.clear();data=None
    try:
        status,html,headers=get('/cabinet');assert status==200 and b'fc-tab-daily' in html and 'no-store' in headers.get('Cache-Control','')
        checks['ownerCabinet']=status;checks['cabinetSha256']=hashlib.sha256(html).hexdigest()
        status,body,_=get('/api/cabinet/daily?month=2026-11&source=bank');report=json.loads(body)
        assert status==200 and report['complete'] and report['throughDate']=='2026-11-15' and report['operationCount']==86
        expected=json.loads(Path('/opt/finance-dashboard/private/bank-daily.json').read_text())['months']['2026-11']
        assert report['totals']==expected['totals']
        checks['bankDaily']={'status':status,'throughDate':report['throughDate'],'operations':report['operationCount'],'totalsMatchSnapshot':True}
        status,body,_=get('/api/cabinet/daily?month=2026-10&source=accountant');report=json.loads(body)
        assert status==200 and report['throughDate']=='2026-10-08' and len(report['rows'])==6
        checks['accountantHistory']={'status':status,'throughDate':report['throughDate'],'rows':len(report['rows'])}
    finally:
        request=urllib.request.Request(base+'/api/auth/logout',data=b'{}',headers={'Content-Type':'application/json'})
        with opener.open(request,timeout=10) as r:assert r.status==200
    assert get('/api/cabinet/daily?month=2026-11')[0]==401
    checks['ownerSessionLoggedOut']=True
    print(json.dumps({'status':'verified','checks':checks}))

if __name__=='__main__':main()
