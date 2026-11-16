const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {validateBudgetSnapshot, readBudget, injectBudgetAssets} = require('../src/budget');

function fixture(){return {schemaVersion:1,months:{'2026-11':{
  asOf:'2026-11-16',version:'draft test',status:'draft',
  income:{id:'income',name:'Поступления',amount:100,children:[{id:'new',name:'Продажи',amount:70},{id:'debt',name:'Дебиторка',amount:30}]},
  expense:{id:'expense',name:'Расходы',amount:50,children:[{id:'pay',name:'ФОТ',amount:40,personalDetail:true,children:[{id:'person',name:'PERSONAL_SENTINEL',amount:40,source:{url:'https://docs.google.com/spreadsheets/d/example/edit'}}]},{id:'reserve',name:'Резерв',amount:10,priorPeriod:true}]},
  notes:['Не прибыль'],sources:[]
}}};}
test('budget checks every hierarchy sum in cents and duplicate IDs',()=>{
 const valid=fixture();assert.doesNotThrow(()=>validateBudgetSnapshot(valid));
 const mismatch=fixture();mismatch.months['2026-11'].expense.children[0].children[0].amount=39.99;
 assert.throws(()=>validateBudgetSnapshot(mismatch),/sum/i);
 const dup=fixture();dup.months['2026-11'].income.children[1].id='new';assert.throws(()=>validateBudgetSnapshot(dup),/duplicate/i);
 const invalid=fixture();invalid.months['2026-11'].expense.amount=NaN;assert.throws(()=>validateBudgetSnapshot(invalid),/amount/i);
 const badLink=fixture();badLink.months['2026-11'].expense.children[0].children[0].source.url='javascript:alert(1)';assert.throws(()=>validateBudgetSnapshot(badLink),/source/i);
});
test('unknown amounts stay null rather than becoming measured zero',()=>{
 const f=fixture();f.months['2026-11'].expense.children.push({id:'unknown',name:'Нет расчёта',amount:null,unknown:true});
 assert.doesNotThrow(()=>validateBudgetSnapshot(f));
 f.months['2026-11'].expense.children.at(-1).unknown=false;assert.throws(()=>validateBudgetSnapshot(f),/unknown/i);
});
test('owner drill-down is private, current other finance roles receive aggregates only',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'budget-reader-'));
 try{
  fs.writeFileSync(path.join(dir,'budget-explorer.json'),JSON.stringify(fixture()));
  const owner=readBudget(dir,'2026-11','owner');assert.match(JSON.stringify(owner),/PERSONAL_SENTINEL/);
  const viewer=readBudget(dir,'2026-11','viewer');assert.doesNotMatch(JSON.stringify(viewer),/PERSONAL_SENTINEL/);
  assert.equal(viewer.expense.children[0].restricted,true);assert.equal(viewer.expense.amount,50);
  assert.equal(readBudget(dir,'2026-12','owner'),null);
  assert.throws(()=>readBudget(dir,'2026-99','owner'),e=>e.statusCode===400);
  assert.throws(()=>readBudget(dir,'2026-11','admin'),e=>e.statusCode===403);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('budget asset injection is idempotent and does not replace other cabinet assets',()=>{
 const html='<html><head></head><body><script src="/cabinet-daily.js"></script></body></html>';
 const once=injectBudgetAssets(html);assert.match(once,/cabinet-budget\.js/);assert.match(once,/cabinet-daily\.js/);
 assert.equal(injectBudgetAssets(once),once);
});

test('public budget assets contain no real budget figures or personnel',()=>{
 const js=fs.readFileSync(path.join(__dirname,'../public/cabinet-budget.js'),'utf8');
 for(const value of ['472 000','3 500 000','7194381','11755000','959650','Родин','Татульян'])assert.equal(js.includes(value),false,value);
});
