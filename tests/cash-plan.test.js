const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readCashPlan}=require('../src/cash-plan');
const {readDailyReport}=require('../src/daily');
function fixture(){return {schemaVersion:1,months:{'2026-11':{asOf:'2026-11-16',status:'draft',income:{kind:'cash_receipts_target',rows:[{name:'Новые продажи',kind:'new_sales',amount:80},{name:'Дебиторка',kind:'receivables',amount:20}],total:100},expense:{blocks:[{name:'ФОТ',amount:40},{name:'Налоги',amount:10}],total:50},sources:[]}}};}
function withPlan(value,fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cash-plan-'));try{fs.writeFileSync(path.join(dir,'cash-plan.json'),JSON.stringify(value));fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('cash target splits receivables from new sales and preserves unknown daily calendar',()=>withPlan(fixture(),dir=>{
 const p=readCashPlan(dir,'2026-11');assert.equal(p.income.total,100);assert.equal(p.income.receivables,20);assert.equal(p.income.newSales,80);assert.equal(p.income.dailySchedule,null);assert.equal(p.income.revenuePlan,null);assert.equal(p.comparable,false);assert.equal(p.executionPercent,null);assert.equal(p.status,'draft');
}));
test('a November plan is never copied into another month or invented when absent',()=>withPlan(fixture(),dir=>{assert.equal(readCashPlan(dir,'2026-10'),null);assert.equal(readCashPlan(dir,'2026-12'),null);}));
test('inconsistent totals and nonfinite or negative amounts reject the budget',()=>{
 for(const change of [v=>v.months['2026-11'].income.total=101,v=>v.months['2026-11'].expense.total=49,v=>v.months['2026-11'].income.rows[0].amount=-1,v=>v.months['2026-11'].income.rows[0].amount='80']){const v=fixture();change(v);withPlan(v,dir=>assert.throws(()=>readCashPlan(dir,'2026-11')));}
});
test('no private source file returns unavailable plan',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cash-plan-empty-'));try{assert.equal(readCashPlan(dir,'2026-11'),null);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('broken optional budget preserves validated bank facts with a warning',()=>{
 const bad=fixture();bad.months['2026-11'].income.total=101;
 withPlan(bad,dir=>{
  fs.writeFileSync(path.join(dir,'bank-daily.json'),JSON.stringify({updatedAt:'2026-11-16',months:{'2026-11':{complete:true,totals:{externalIncome:75},rows:[]}}}));
  const r=readDailyReport(null,'2026-11','bank',dir);assert.equal(r.totals.externalIncome,75);assert.equal(r.budget,null);assert.ok(r.budgetWarning);
 });
});
