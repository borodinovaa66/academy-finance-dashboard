const nativeTest=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
// Private source snapshots are deliberately not shipped in the repository.
const test=(name,fn)=>nativeTest(name,{skip:!fs.existsSync(path.join(__dirname,'../local-state/budget-sync-master-fixture.json'))},fn);
const {buildLiveBudget,grid}=require('../server-budget/transform');
const root=path.resolve(__dirname,'..');
function fixture(){return {master:JSON.parse(fs.readFileSync(path.join(root,'local-state/budget-sync-master-fixture.json'))),payroll:JSON.parse(fs.readFileSync(path.join(root,'local-state/budget-sync-payroll-fixture.json'))),previous:JSON.parse(fs.readFileSync(path.join(root,'private/budget-explorer.json')))};}
function setValue(book,title,row,col,value){const s=book.sheets.find(s=>s.properties.title===title);for(const d of s.data){const i=row-1-(d.startRow||0),j=col-1-(d.startColumn||0);if(i>=0&&i<(d.rowData||[]).length&&j>=0){d.rowData[i].values??=[];d.rowData[i].values[j]={effectiveValue:typeof value==='number'?{numberValue:value}:{stringValue:value}};return;}}throw Error('Cell not in fixture');}
function find(n,id){if(n.id===id)return n;for(const c of n.children||[]){const r=find(c,id);if(r)return r;}}
test('live sources reproduce the reviewed hierarchy and explicitly separate old-period reserves',()=>{
 const f=fixture(),x=buildLiveBudget(f.master,f.payroll,f.previous,'2026-11','2026-11-17T10:00:00Z');
 const p=x.budget.months['2026-11'];assert.equal(p.income.amount,11755000);assert.equal(p.expense.amount,7194381);assert.equal(p.priorPeriodReserve,472000);assert.equal(p.namedConditionalCompensation,959650);
 assert.equal(x.cashPlan.months['2026-11'].expense.total,7194381);
});
test('valid source amount/name/note changes refresh leaf detail and every parent',()=>{
 const f=fixture();const g=grid(f.master,'План');const r=[...g.rows].find(r=>g.get(r,15)==='Сервисы'&&g.get(r,7)>0);const old=g.get(r,7);
 setValue(f.master,'План',r,7,old+100);setValue(f.master,'План',r,6,'Updated source leaf');setValue(f.master,'План',r,18,'Reversible sync probe');
 setValue(f.master,'Четыре блока',9,2,1033056);setValue(f.master,'Четыре блока',11,2,7194481);setValue(f.master,'Свод',16,3,7194481);
 const x=buildLiveBudget(f.master,f.payroll,f.previous,'2026-11','2026-11-17T10:02:00Z');const p=x.budget.months['2026-11'];
 const leaf=find(p.expense,'plan-'+g.get(r,1));assert.equal(leaf.amount,old+100);assert.equal(leaf.name,'Updated source leaf');assert.match(leaf.detail,/Reversible sync probe/);assert.equal(p.expense.amount,7194481);
});
test('inconsistent main totals or spreadsheet errors reject a candidate',()=>{
 const f=fixture();setValue(f.master,'Четыре блока',11,2,1);assert.throws(()=>buildLiveBudget(f.master,f.payroll,f.previous,'2026-11'),/CONTROL|TOTAL/);
 const b=fixture(),s=b.master.sheets.find(s=>s.properties.title==='План');s.data[0].rowData[1].values[6]={effectiveValue:{errorValue:{type:'REF',message:'error'}}};
 assert.throws(()=>buildLiveBudget(b.master,b.payroll,b.previous,'2026-11'),/SHEET_ERROR/);
});
test('a changed payroll person refreshes live labels without copying a stale local model',()=>{
 const f=fixture();setValue(f.payroll,'Стоимость ФОТ',26,2,'Updated payroll person');
 const x=buildLiveBudget(f.master,f.payroll,f.previous,'2026-11');assert.match(JSON.stringify(x.budget),/Updated payroll person/);
});
