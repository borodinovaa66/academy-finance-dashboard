const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
let proc,dir,base;
test.before(async()=>{
 dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-cabinet-test-'));
 fs.mkdirSync(path.join(dir,'private'));
 fs.writeFileSync(path.join(dir,'private','cabinet.html'),'<h1>PROTECTED_FINANCIAL_SENTINEL</h1>');
 fs.writeFileSync(path.join(dir,'private','cash-plan.json'),JSON.stringify({schemaVersion:1,months:{'2026-11':{status:'draft',income:{kind:'cash_receipts_target',total:10,rows:[{name:'FICTIONAL_BUDGET_SENTINEL',kind:'new_sales',amount:10}]},expense:{total:5,blocks:[{name:'Test',amount:5}]}}}}));
 const port=22000+Math.floor(Math.random()*5000);base=`http://127.0.0.1:${port}`;
 proc=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),FINANCE_DATA_DIR:path.join(dir,'data'),FINANCE_PRIVATE_DIR:path.join(dir,'private'),SESSION_SECRET:'isolated-integration-test'},stdio:'ignore'});
 for(let i=0;i<80;i++){try{await fetch(base+'/api/auth/me');return;}catch{await new Promise(r=>setTimeout(r,50));}}
 throw new Error('Test server did not start');
});
test.after(async()=>{if(proc){proc.kill();await new Promise(r=>proc.once('exit',r));}if(dir){assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});}});
async function login(role){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:role,password:role+'-change-me'})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
test('anonymous cannot fetch sensitive cabinet or daily API',async()=>{
 const r=await fetch(base+'/cabinet',{redirect:'manual'});assert.equal(r.status,302);assert.equal((await r.text()).includes('PROTECTED_FINANCIAL_SENTINEL'),false);
 assert.equal((await fetch(base+'/api/cabinet/daily?month=2026-11')).status,401);
 assert.equal((await (await fetch(base+'/private/cabinet.html')).text()).includes('PROTECTED_FINANCIAL_SENTINEL'),false);
 assert.equal((await (await fetch(base+'/private/cash-plan.json')).text()).includes('FICTIONAL_BUDGET_SENTINEL'),false);
});
test('owner sees cabinet and unknown month, administration role has no new financial access',async()=>{
 const owner=await login('owner');
 const page=await fetch(base+'/cabinet',{headers:{Cookie:owner}});assert.equal(page.status,200);assert.match(await page.text(),/PROTECTED_FINANCIAL_SENTINEL/);assert.match(page.headers.get('cache-control'),/no-store/);
 const daily=await fetch(base+'/api/cabinet/daily?month=2026-11&source=bank',{headers:{Cookie:owner}});assert.equal(daily.status,200);const data=await daily.json();assert.equal(data.totals,null);assert.equal(data.budget.income.total,10);assert.equal(data.budget.executionPercent,null);
 assert.equal((await fetch(base+'/api/cabinet/daily?month=bad',{headers:{Cookie:owner}})).status,400);
 const admin=await login('admin');assert.equal((await fetch(base+'/api/cabinet/daily?month=2026-11',{headers:{Cookie:admin}})).status,403);
});
