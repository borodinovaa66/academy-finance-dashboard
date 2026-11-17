const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {readSupplement,combineBankReports,validateBankReport}=require('../src/daily-sources');

const moneyFields=['externalIncome','interest','externalExpense','refunds','transferIn','transferOut','depositPlaced','depositReturned','ownerWithdrawal'];
function report(bank,days){
  const cumulative=Object.fromEntries(moneyFields.map(k=>[k,0]));
  const rows=days.map((values,i)=>{
    const row={date:`2026-11-0${i+1}`,...Object.fromEntries(moneyFields.map(k=>[k,0])),operationCount:0,confirmed:true,...values};
    row.netFlow=Number((row.externalIncome+row.interest-row.externalExpense).toFixed(2));
    for(const k of moneyFields)cumulative[k]=Number((cumulative[k]+row[k]).toFixed(2));
    row.cumulative={...cumulative,netFlow:Number((cumulative.externalIncome+cumulative.interest-cumulative.externalExpense).toFixed(2))};
    return row;
  });
  return {month:'2026-11',source:'bank',scope:bank,throughDate:rows.at(-1).date,asOf:bank==='VTB'?'2026-11-04T11:00:00Z':'2026-11-03T10:00:00Z',complete:true,missingDays:[],rows,
    totals:{...rows.at(-1).cumulative,cashBalance:rows.at(-1).cashBalance},operationCount:rows.reduce((n,r)=>n+r.operationCount,0),
    accounts:[{suffix:bank==='VTB'?'1826':'1234',name:bank,type:'current',currency:'643',closing:rows.at(-1).cashBalance,operations:rows.reduce((n,r)=>n+r.operationCount,0)}]};
}
function banks(){return [report('TBank',[
  {externalIncome:10.01,interest:0.02,externalExpense:2.03,refunds:1, cashBalance:100,operationCount:2},
  {externalIncome:0.02,externalExpense:0.01,cashBalance:101,operationCount:1}
]),report('VTB',[
  {interest:0.01,externalExpense:0.02,depositPlaced:1000,ownerWithdrawal:50,cashBalance:10,operationCount:3},
  {interest:0.02,externalExpense:0.01,depositReturned:1000,cashBalance:11,operationCount:2},
  {interest:99,externalExpense:20,cashBalance:9999,operationCount:5}
])];}
function temporary(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'daily-sources-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function snapshot(vtb){return {schemaVersion:1,updatedAt:'2026-11-04T12:00:00Z',vtb:{months:{'2026-11':vtb}},receivables:{fullCoverage:false,selectedAmount:123.45,notes:['Partial selection']},onec:{status:'reconciled',bankCount:2}};}

test('bank union uses the common day balance and excludes future flow and operation counts',()=>{
  const [tbank,vtb]=banks(),original=JSON.stringify([tbank,vtb]);
  const result=combineBankReports(tbank,vtb,'2026-11');
  assert.equal(result.throughDate,'2026-11-02');
  assert.equal(result.rows.length,2);
  assert.equal(result.totals.cashBalance,112);
  assert.equal(result.totals.externalIncome,10.03);
  assert.equal(result.totals.interest,0.05);
  assert.equal(result.totals.externalExpense,2.07);
  assert.equal(result.totals.netFlow,8.01);
  assert.equal(result.operationCount,8);
  assert.equal(result.rows[1].cumulative.netFlow,8.01);
  assert.equal(result.accounts[1].closing,9999);
  assert.equal(result.accounts[1].closingDate,'2026-11-03');
  assert.equal(result.accounts[1].bank,'vtb');
  assert.equal(result.sourceCoverage[1].throughDate,'2026-11-03');
  assert.equal(result.asOf,'2026-11-04T11:00:00Z');
  assert.equal(result.bankScope,'combined');
  assert.equal(result.fullCompanyCoverage,false);
  assert.equal(JSON.stringify([tbank,vtb]),original);
});
test('deposit principal and owner withdrawals stay separate from business expense and net flow',()=>{
  const result=combineBankReports(...banks(),'2026-11');
  assert.equal(result.totals.depositPlaced,1000);
  assert.equal(result.totals.depositReturned,1000);
  assert.equal(result.totals.ownerWithdrawal,50);
  assert.equal(result.totals.refunds,1);
  assert.equal(result.rows[0].netFlow,7.99);
  assert.equal(result.rows[1].netFlow,0.02);
  assert.equal(result.rows[1].cumulative.ownerWithdrawal,50);
});
test('missing dates are preserved as unknown rather than zero filled',()=>{
  const [tbank,vtb]=banks();
  tbank.rows[1].date='2026-11-03';tbank.throughDate='2026-11-03';tbank.complete=false;tbank.missingDays=['2026-11-02'];
  const result=combineBankReports(tbank,vtb,'2026-11');
  assert.deepEqual(result.rows.map(r=>r.date),['2026-11-01','2026-11-03']);
  assert.deepEqual(result.missingDays,['2026-11-02']);
  assert.equal(result.complete,false);
});
test('optional supplement missing on disk returns null',t=>assert.equal(readSupplement(temporary(t)),null));
test('supplement reader accepts private aggregates without opening budget data',t=>{
  const dir=temporary(t),value=snapshot(banks()[1]);
  fs.writeFileSync(path.join(dir,'daily-supplement.json'),JSON.stringify(value));
  fs.writeFileSync(path.join(dir,'cash-plan.json'),'invalid budget');
  const result=readSupplement(dir);
  assert.equal(result.receivables.selectedAmount,123.45);
  assert.equal(result.vtb.months['2026-11'].totals.cashBalance,9999);
});
test('malformed, oversized and unsupported supplemental snapshots throw',t=>{
  const dir=temporary(t),file=path.join(dir,'daily-supplement.json');
  for(const value of ['{',JSON.stringify({...snapshot(banks()[1]),schemaVersion:2}),' '.repeat(3*1024*1024+1)]){
    fs.writeFileSync(file,value);assert.throws(()=>readSupplement(dir));
  }
});
test('reader rejects secret and raw customer rows instead of returning them',t=>{
  const dir=temporary(t),value=snapshot(banks()[1]);
  value.receivables.clientRows=[{name:'Synthetic client',amount:10}];
  fs.writeFileSync(path.join(dir,'daily-supplement.json'),JSON.stringify(value));
  assert.throws(()=>readSupplement(dir));
  delete value.receivables.clientRows;value.token='synthetic secret';
  fs.writeFileSync(path.join(dir,'daily-supplement.json'),JSON.stringify(value));
  assert.throws(()=>readSupplement(dir));
});
test('bank validation rejects invalid calendar dates, wrong month and duplicate days',()=>{
  for(const date of ['2026-11-31','2026-12-01','2026-11-01']){
    const value=banks()[0];value.rows[1].date=date;value.throughDate=date;
    assert.throws(()=>validateBankReport(value,'2026-11'));
  }
});
test('bank validation rejects complete calendar with a missing day',()=>{
  const value=banks()[0];value.rows[1].date='2026-11-03';value.throughDate='2026-11-03';
  assert.throws(()=>validateBankReport(value,'2026-11'));
});
test('bank validation rejects invalid amounts and sub-cent precision',()=>{
  for(const amount of [NaN,Infinity,'10',null,0.001]){
    const value=banks()[0];value.rows[0].interest=amount;
    assert.throws(()=>validateBankReport(value,'2026-11'));
  }
});
test('large cent-exact bank totals tolerate only binary floating point noise',()=>{
  const value=report('TBank',[{externalIncome:312345678.03,cashBalance:312345678.03,operationCount:1}]);
  assert.equal(validateBankReport(value,'2026-11'),value);
});
test('non-ruble account metadata remains labelled and does not enter ruble balances',()=>{
  const [tbank,vtb]=banks();
  tbank.accounts.push({suffix:'5678',name:'EUR',currency:'978',closing:1000,operations:0});
  const result=combineBankReports(tbank,vtb,'2026-11');
  assert.equal(result.totals.cashBalance,112);
  assert.equal(result.accounts.find(a=>a.suffix==='5678').currency,'978');
});
test('bank validation rejects incorrect flow, cumulative, total and operation counts',()=>{
  for(const mutate of [r=>r.rows[0].netFlow=99,r=>r.rows[1].cumulative.externalIncome=99,r=>r.totals.cashBalance=99,r=>r.totals.interest=99,r=>r.operationCount=99,r=>r.rows[0].operationCount=-1]){
    const value=banks()[0];mutate(value);assert.throws(()=>validateBankReport(value,'2026-11'));
  }
});
test('combined totals match every monetary field in cents without summing daily balances',()=>{
  const result=combineBankReports(...banks(),'2026-11');
  assert.deepEqual(result.totals,{externalIncome:10.03,interest:0.05,externalExpense:2.07,refunds:1,transferIn:0,transferOut:0,depositPlaced:1000,depositReturned:1000,ownerWithdrawal:50,netFlow:8.01,cashBalance:112});
});

test('foreign-currency account operations do not break the ruble report validator',()=>{
 const [tbank,vtb]=banks();tbank.accounts.push({suffix:'7731',currency:'978',closing:50,operations:1});tbank.operationCount+=1;
 assert.doesNotThrow(()=>validateBankReport(tbank,'2026-11'));
 const union=combineBankReports(tbank,vtb,'2026-11');assert.equal(union.operationCount,8);assert.equal(union.totals.cashBalance,112);
});
test('a missing common cutoff never labels an earlier balance with a later date',()=>{
 const [tbank,vtb]=banks();vtb.rows.splice(1,1);vtb.complete=false;vtb.operationCount-=2;
 for(const k of moneyFields)vtb.totals[k]-=k==='interest'?.02:k==='externalExpense'?.01:k==='depositReturned'?1000:0;
 vtb.rows.at(-1).cumulative={...vtb.totals};vtb.totals.netFlow=vtb.totals.externalIncome+vtb.totals.interest-vtb.totals.externalExpense;vtb.rows.at(-1).cumulative.netFlow=vtb.totals.netFlow;
 const union=combineBankReports(tbank,vtb,'2026-11');assert.equal(union.throughDate,'2026-11-01');assert.equal(union.requestedThroughDate,'2026-11-02');assert.equal(union.totals.cashBalance,110);assert.equal(union.complete,false);assert.ok(union.missingDays.includes('2026-11-02'));
});
