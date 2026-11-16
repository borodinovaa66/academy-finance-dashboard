const fs=require('node:fs'),path=require('node:path');

// Budget targets and bank facts have different coverage. Keep that distinction
// even when a month has a complete statement for the approved bank accounts.
function readCashPlan(privateDir,month){
  const file=path.join(privateDir,'cash-plan.json');
  if(!fs.existsSync(file))return null;
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  if(data.schemaVersion!==1)throw new Error('Unsupported cash plan schema');
  const p=data.months?.[month];if(!p)return null;
  const cents=n=>{if(typeof n!=='number'||!Number.isFinite(n)||n<0)throw new Error('Invalid budget amount');return Math.round(n*100);};
  const sum=rows=>rows.reduce((s,r)=>s+cents(r.amount),0);
  if(p.income.kind!=='cash_receipts_target'||p.income.rows.some(r=>!['new_sales','receivables'].includes(r.kind))||sum(p.income.rows)!==cents(p.income.total)||sum(p.expense.blocks)!==cents(p.expense.total))throw new Error('Budget does not reconcile');
  return {...p,month,comparable:false,executionPercent:null,
    income:{...p.income,newSales:sum(p.income.rows.filter(r=>r.kind==='new_sales'))/100,receivables:sum(p.income.rows.filter(r=>r.kind==='receivables'))/100,dailySchedule:null,revenuePlan:null}};
}
module.exports={readCashPlan};
