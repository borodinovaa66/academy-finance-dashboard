const test=require('node:test');
const assert=require('node:assert/strict');
const {manualReport,validateMonth}=require('../src/daily');

test('manual cumulative adds flows and carries last balance, never sums balances',()=>{
  const r=manualReport([
    {report_date:'2026-10-01',client_income:10.1,deposit_income:0.2,expense:3.3,client_refunds:1,cash_balance:100,status:'confirmed'},
    {report_date:'2026-10-03',client_income:2,deposit_income:0,expense:1,client_refunds:0,cash_balance:101,status:'confirmed'}
  ],'2026-10','2026-11-16');
  assert.equal(r.totals.externalIncome,12.1);
  assert.equal(r.totals.netFlow,8);
  assert.equal(r.totals.cashBalance,101);
  assert.equal(r.rows.length,2);
  assert.equal(r.missingDays.includes('2026-10-02'),true);
  assert.equal(r.rows[1].cumulative.netFlow,8);
});
test('missing manual month is unavailable rather than zero',()=>{
  const r=manualReport([],'2026-11','2026-11-16');
  assert.equal(r.totals,null);
  assert.equal(r.complete,false);
});
test('unconfirmed and template records never become confirmed business figures',()=>{
  const r=manualReport([{report_date:'2026-10-01',client_income:100,status:'draft'},
    {report_date:'2026-10-02',client_income:300,status:'confirmed',comment:'Стартовые данные из примера'}],'2026-10','2026-11-16');
  assert.equal(r.totals,null);
});
test('month input is bounded calendar month',()=>{
  assert.equal(validateMonth('2026-11'),'2026-11');
  for(const value of ['2026-13','../../data','2026-1',null])assert.throws(()=>validateMonth(value));
});
