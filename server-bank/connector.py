"""Fixed-endpoint, two-tool bank transport. Never logs token or response bodies."""
from datetime import datetime,timedelta
from pathlib import Path
import json,requests
from jsonschema import validate,ValidationError
from credential import load_token

BASE=Path(__file__).resolve().parent
ENDPOINT='https://mcp.tbank.ru/b2b'
ALLOWED=frozenset({'getApiV4Bank-accounts','getApiV1Statement'})
SCHEMAS={
 'getApiV4Bank-accounts':{'type':'object','properties':{'withInvest':{'const':False}},'required':['withInvest'],'additionalProperties':False},
 'getApiV1Statement':{'type':'object','properties':{
  'accountNumber':{'type':'string','pattern':r'^\d{20}$'},'from':{'type':'string'},'to':{'type':'string'},
  'operationStatus':{'const':'Transaction'},'withBalances':{'type':'boolean'},'limit':{'type':'integer','minimum':1,'maximum':200},
  'cursor':{'type':'string','minLength':1}},'required':['accountNumber','from','to','operationStatus','withBalances','limit'],'additionalProperties':False}
}
class SafeError(Exception):pass
class BankAuthDenied(SafeError):pass

def validate_call(name,arguments):
    if name not in ALLOWED:raise SafeError('Only the two approved reading methods are allowed')
    try:validate(arguments,SCHEMAS[name])
    except ValidationError:raise SafeError('Bank request is outside the approved bounded schema') from None
    if name=='getApiV1Statement':
        try:
            start=datetime.fromisoformat(arguments['from'].replace('Z','+00:00'));end=datetime.fromisoformat(arguments['to'].replace('Z','+00:00'))
            if start.tzinfo is None or end.tzinfo is None or not timedelta(0)<end-start<=timedelta(days=31):raise ValueError()
        except (ValueError,TypeError):raise SafeError('Bank period must be bounded to 31 days with explicit timezone') from None

def extract_body(result):
    if not isinstance(result,dict):raise SafeError('Bank reading method failed; response contents suppressed')
    value=result.get('structuredContent')
    if value is None:
        for block in result.get('content',[]):
            if block.get('type')=='text':
                try:value=json.loads(block['text']);break
                except (ValueError,KeyError):pass
    if isinstance(value,dict) and 'data' in value:value=value['data']
    if isinstance(value,dict) and value.get('status') in (401,403,'401','403'):raise BankAuthDenied('Bank authentication denied; no automatic retries')
    if result.get('isError'):raise SafeError('Bank reading method failed; response contents suppressed')
    if not isinstance(value,dict) or value.get('status')!=200:raise SafeError('No verified HTTP 200 bank payload')
    return value['body']

class BankMCP:
    def __init__(self,approved_accounts=()):
        self.approved_accounts=frozenset(approved_accounts);self.session=None;self.headers={};self.ready=False;self.blocked=False;self.counter=0
    def _connect(self):
        if self.session is not None:return
        ca=BASE/'bank-ca-bundle.pem'
        if not ca.is_file():raise SafeError('Approved bank TLS trust bundle is absent')
        self.headers={'Authorization':'Bearer '+load_token(),'Content-Type':'application/json','Accept':'application/json, text/event-stream'}
        self.session=requests.Session();self.session.trust_env=False
    def close(self):
        if self.session:self.session.close()
        self.headers.clear();self.session=None
    def rpc(self,method,params=None,notification=False):
        if self.blocked:raise SafeError('Bank authentication failed earlier; no retry')
        self.counter+=1;request={'jsonrpc':'2.0','method':method}
        if not notification:request['id']=self.counter
        if params is not None:request['params']=params
        try:
            with self.session.post(ENDPOINT,headers=self.headers,json=request,verify=str(BASE/'bank-ca-bundle.pem'),timeout=(15,40),allow_redirects=False,stream=True) as response:
                if response.status_code in (401,403):
                    self.blocked=True;raise BankAuthDenied('Bank authentication denied; no automatic retries')
                if not 200<=response.status_code<300:raise SafeError('Bank MCP returned an unsuccessful HTTP status')
                if notification:return {}
                if response.headers.get('mcp-session-id'):self.headers['Mcp-Session-Id']=response.headers['mcp-session-id']
                if 'text/event-stream' in response.headers.get('content-type',''):
                    result=None
                    for line in response.iter_lines():
                        if len(line)>8_000_000:raise SafeError('Bank response exceeds the approved size')
                        if line.startswith(b'data:'):
                            candidate=json.loads(line[5:].strip())
                            if candidate.get('id')==request['id']:result=candidate;break
                    if result is None:raise SafeError('Bank response is incomplete')
                else:result=response.json()
                if 'error' in result:raise SafeError('Bank MCP rejected the RPC request')
                return result['result']
        except requests.exceptions.SSLError:raise SafeError('Bank TLS verification failed; verification remains enabled') from None
        except requests.exceptions.RequestException:raise SafeError('Bank network read failed; no automatic retry') from None
        except (ValueError,KeyError,TypeError):raise SafeError('Unexpected bank response; details suppressed') from None
    def call(self,name,arguments):
        validate_call(name,arguments)
        if name=='getApiV1Statement' and arguments['accountNumber'] not in self.approved_accounts:raise SafeError('Account is outside the four approved accounts')
        self._connect()
        if not self.ready:
            result=self.rpc('initialize',{'protocolVersion':'2025-03-26','capabilities':{},'clientInfo':{'name':'finance-server-readonly','version':'1.0.0'}})
            self.headers['MCP-Protocol-Version']=result['protocolVersion'];self.rpc('notifications/initialized',notification=True);self.ready=True
        return self.rpc('tools/call',{'name':name,'arguments':arguments})
