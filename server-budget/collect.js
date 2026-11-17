'use strict';
// A dedicated reader identity can read only the two explicitly shared files.
// Tokens stay in memory; errors are reduced to non-sensitive diagnostic codes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
// Node's 250 ms address-family race was timing out valid Google IPv4
// connections on this host before trying its unavailable IPv6 route.
require('node:net').setDefaultAutoSelectFamilyAttemptTimeout(2000);
const {buildLiveBudget}=require('./transform');
const STATE=process.env.BUDGET_SYNC_STATE||'/var/lib/finance-budget-sync';
const CONFIG=path.join(__dirname,'config');
const SOURCES=[
 {id:'1gdj4Iass8LR8jqwQ_2woOKwV0Z3yB1hGQh2uTm84zAo',ranges:["'План'!A6:R1000","'Четыре блока'!A6:D33","'Разбор ФОТ 16.11'!A6:E51","'Проект налогов'!A6:E49","'Свод'!A6:G17"]},
 {id:'1lipAo1xEMo1mvieSdX-XiWADV1skrx4MB-9FTinlzJU',ranges:["'Стоимость ФОТ'!A6:N150","'Разбор ФОТ'!A6:J80","'Проект налогов'!A6:J60"]}
];
const EMAIL='finance-budget-sync@academy-ceo-dashboard.iam.gserviceaccount.com';
function read(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function atomic(file,data){const tmp=file+'.tmp-'+process.pid;fs.writeFileSync(tmp,JSON.stringify(data),{mode:0o600});fs.renameSync(tmp,file);}
async function request(url,options={}){
 let r;try{r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(25000)});}catch{throw Error('GOOGLE_NETWORK');}
 if(!r.ok){await r.body?.cancel();throw Error([401,403].includes(r.status)?'GOOGLE_ACCESS_DENIED':'GOOGLE_HTTP_'+r.status);}
 let bytes=0,parts=[];for await(const c of r.body){bytes+=c.length;if(bytes>4*1024*1024)throw Error('SOURCE_TOO_LARGE');parts.push(c);}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw Error('GOOGLE_RESPONSE_INVALID');}
}
async function token(){
 const c=read(path.join(process.env.CREDENTIALS_DIRECTORY,'google-budget'));
 if(c.client_email!==EMAIL||c.token_uri!=='https://oauth2.googleapis.com/token')throw Error('IDENTITY_INVALID');
 const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),now=Math.floor(Date.now()/1000);
 const input=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:EMAIL,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:c.token_uri,iat:now,exp:now+3600});
 const assertion=input+'.'+crypto.sign('RSA-SHA256',Buffer.from(input),c.private_key).toString('base64url');
 const r=await request(c.token_uri,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
 if(typeof r.access_token!=='string')throw Error('GOOGLE_TOKEN_INVALID');return r.access_token;
}
async function books(accessToken){
 return Promise.all(SOURCES.map(async s=>{
  const url=new URL('https://sheets.googleapis.com/v4/spreadsheets/'+s.id);
  url.searchParams.set('includeGridData','true');for(const r of s.ranges)url.searchParams.append('ranges',r);
  url.searchParams.set('fields','spreadsheetId,properties(title),sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(effectiveValue,userEnteredValue,note))))');
  return request(url,{headers:{Authorization:'Bearer '+accessToken}});
 }));
}
function hash(data){return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');}
async function main(){
 const checkedAt=new Date().toISOString();let status={};try{status=read(path.join(STATE,'status.json'));}catch{}
 try{
  if(fs.existsSync(path.join(STATE,'access-blocked')))throw Error('GOOGLE_ACCESS_DENIED');
  const accessToken=await token(),first=await books(accessToken),second=await books(accessToken);
  const sourceHash=hash(second);if(sourceHash!==hash(first))throw Error('SOURCE_EDIT_IN_PROGRESS');
  const previous=read(path.join(CONFIG,'budget-explorer.json'));previous.cashPlan=read(path.join(CONFIG,'cash-plan.json'));
  const built=buildLiveBudget(second[0],second[1],previous,'2026-11',checkedAt);
  const candidate={schemaVersion:1,sourceHash,checkedAt,budget:built.budget,cashPlan:built.cashPlan,warnings:built.warnings,excludedRows:built.excludedRows};
  atomic(path.join(STATE,'candidate.json'),candidate);
  atomic(path.join(STATE,'status.json'),{...status,state:'ok',checkedAt,lastSuccessAt:checkedAt,sourceHash,errorCode:null,warnings:built.warnings,excludedRows:built.excludedRows});
  console.log(JSON.stringify({state:'ok',sourceHash,checkedAt,warnings:built.warnings,excludedRows:built.excludedRows}));
 }catch(e){
  const code=/^[A-Z][A-Z0-9_]{2,80}$/.test(e.message)?e.message:'SYNC_VALIDATION_FAILED';
  if(code==='GOOGLE_ACCESS_DENIED')fs.writeFileSync(path.join(STATE,'access-blocked'),'Manual access verification required\n',{mode:0o600});
  atomic(path.join(STATE,'status.json'),{...status,state:'error',checkedAt,errorCode:code});
  console.log(JSON.stringify({state:'error',checkedAt,errorCode:code}));process.exitCode=1;
 }
}
if(require.main===module)main();
module.exports={hash};
