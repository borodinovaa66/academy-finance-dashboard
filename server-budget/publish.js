'use strict';
// Runs without a Google credential or network. Only this process may publish.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validateBudgetSnapshot}=require('../src/budget');
const {readCashPlan}=require('../src/cash-plan');
const STATE=process.env.BUDGET_SYNC_STATE||'/var/lib/finance-budget-sync';
const PRIVATE=process.env.BUDGET_PRIVATE_DIR||'/opt/finance-dashboard/private';
function read(file){const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>4*1024*1024)throw Error('Unsafe input');return JSON.parse(fs.readFileSync(file,'utf8'));}
function atomic(file,data,uid,gid){const tmp=file+'.tmp-'+process.pid;fs.writeFileSync(tmp,JSON.stringify(data),{mode:0o600});if(uid!==undefined)fs.chownSync(tmp,uid,gid);fs.renameSync(tmp,file);}
function validateCandidate(c){
 if(c.schemaVersion!==1||!/^[a-f0-9]{64}$/.test(c.sourceHash)||!Number.isFinite(Date.parse(c.checkedAt))||Math.abs(Date.now()-Date.parse(c.checkedAt))>5*60*1000)throw Error('Invalid candidate metadata');
 validateBudgetSnapshot(c.budget);
 const b=c.budget.months['2026-11'],p=c.cashPlan?.months?.['2026-11'];
 if(!b||!p||c.cashPlan.schemaVersion!==1||b.income.amount!==p.income.total||b.expense.amount!==p.expense.total||p.income.kind!=='cash_receipts_target')throw Error('Inconsistent budget pair');
 for(const [rows,total] of [[p.income.rows,p.income.total],[p.expense.blocks,p.expense.total]]){
  if(!Array.isArray(rows)||rows.some(r=>typeof r.amount!=='number'||!Number.isFinite(r.amount)||r.amount<0)||rows.reduce((s,r)=>s+Math.round(r.amount*100),0)!==Math.round(total*100))throw Error('Invalid cash plan totals');
 }
 if(p.income.rows.some(r=>!['new_sales','receivables'].includes(r.kind)))throw Error('Invalid income kind');
 return c;
}
function publish(state=STATE,privateDir=PRIVATE,uid,gid){
 const status=read(path.join(state,'status.json')),sync=path.join(privateDir,'budget-sync');fs.mkdirSync(path.join(sync,'generations'),{recursive:true,mode:0o700});
 let current={};try{current=read(path.join(sync,'current.json'));}catch{}
 let publishedAt=current.publishedAt;
 if(status.state==='ok'){
  const c=validateCandidate(read(path.join(state,'candidate.json')));
  if(c.sourceHash!==status.sourceHash||c.checkedAt!==status.checkedAt)throw Error('Candidate is not the last successful read');
  if(current.sourceHash!==c.sourceHash){
   const generation=Date.now()+'-'+crypto.randomBytes(8).toString('hex'),dir=path.join(sync,'generations',generation);fs.mkdirSync(dir,{mode:0o700});
   atomic(path.join(dir,'budget-explorer.json'),c.budget,uid,gid);atomic(path.join(dir,'cash-plan.json'),c.cashPlan,uid,gid);
   // Exercise the same cash-plan reader used by the live cabinet.
   readCashPlan(dir,'2026-11');publishedAt=new Date().toISOString();
   if(uid!==undefined)fs.chownSync(dir,uid,gid);
   atomic(path.join(sync,'current.json'),{generation,sourceHash:c.sourceHash,publishedAt},uid,gid);
   const dirs=fs.readdirSync(path.join(sync,'generations')).filter(n=>/^\d{13}-[a-f0-9]{16}$/.test(n)).sort().reverse();
   for(const old of dirs.slice(3))fs.rmSync(path.join(sync,'generations',old),{recursive:true});
  }
 }
 if(uid!==undefined){fs.chownSync(sync,uid,gid);fs.chownSync(path.join(sync,'generations'),uid,gid);}
 atomic(path.join(privateDir,'budget-sync-status.json'),{...status,publishedAt,sourceHash:current.sourceHash||status.sourceHash,...(status.state==='ok'?{sourceHash:status.sourceHash}:{})},uid,gid);
 return {state:status.state,publishedAt,changed:publishedAt!==current.publishedAt};
}
if(require.main===module){
 const uid=Number(process.env.FINANCE_UID),gid=Number(process.env.FINANCE_GID);
 try{console.log(JSON.stringify(publish(STATE,PRIVATE,uid,gid)));}catch{
  // A collector success is not a publication success. Preserve last publication
  // timestamps and expose this distinct failure without any source payload.
  try{let old={};try{old=read(path.join(PRIVATE,'budget-sync-status.json'));}catch{}atomic(path.join(PRIVATE,'budget-sync-status.json'),{...old,state:'error',checkedAt:new Date().toISOString(),errorCode:'PUBLICATION_REJECTED'},uid,gid);}catch{}
  console.error('BUDGET_PUBLICATION_REJECTED');process.exitCode=1;
 }
}
module.exports={publish,validateCandidate};
