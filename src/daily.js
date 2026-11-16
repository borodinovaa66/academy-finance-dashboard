const fs=require('node:fs');
const path=require('node:path');
const {readCashPlan}=require('./cash-plan');
const fields=['externalIncome','interest','externalExpense','refunds'];
const cents=v=>Math.round(Number(v||0)*100);
const rub=v=>v/100;
function validateMonth(value){
  if(typeof value!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(value))throw Object.assign(new Error('Некорректный месяц'),{statusCode:400});
  return value;
}
function manualReport(entries,month,today){
  validateMonth(month);
  const rows=entries.filter(r=>r.report_date?.startsWith(month+'-')&&r.status==='confirmed'&&!/стартовые данные из примера/i.test(r.comment||'')).sort((a,b)=>a.report_date.localeCompare(b.report_date));
  const totals=Object.fromEntries(fields.map(k=>[k,0]));
  const result=rows.map(r=>{
    const row={date:r.report_date,externalIncome:cents(r.client_income),interest:cents(r.deposit_income),externalExpense:cents(r.expense),refunds:cents(r.client_refunds)};
    for(const k of fields)totals[k]+=row[k];
    const out={...row};for(const k of fields)out[k]=rub(row[k]);
    return {...out,netFlow:rub(row.externalIncome+row.interest-row.externalExpense),cashBalance:r.cash_balance==null?null:Number(r.cash_balance),confirmed:true,
      cumulative:{...Object.fromEntries(fields.map(k=>[k,rub(totals[k])])),netFlow:rub(totals.externalIncome+totals.interest-totals.externalExpense)}};
  });
  const last=result.at(-1)||null;
  const missingDays=[];
  if(last){const end=Number(last.date.slice(-2)),present=new Set(result.map(r=>r.date));for(let d=1;d<=end;d++){const day=month+'-'+String(d).padStart(2,'0');if(!present.has(day))missingDays.push(day);}}
  return {month,source:'accountant',scope:'Ввод бухгалтерии · исходный периметр не подтверждён выписками',throughDate:last?.date||null,
    totals:last?{...last.cumulative,cashBalance:last.cashBalance}:null,rows:result,missingDays,complete:false,
    classification:'Исторический ручной ввод. Возвраты входят в списания и повторно не вычитаются. Пропущенные дни не заполнены нулями.',today};
}
function readDailyReport(db,month,source,privateDir){
  validateMonth(month);
  let budget=null,budgetWarning=null;
  try{budget=readCashPlan(privateDir,month);}catch{budgetWarning='Бюджет не прошёл проверку. Банковские факты сохранены; план временно недоступен.';}
  if(source==='accountant'){
    const entries=db.prepare('SELECT report_date,client_income,deposit_income,expense,client_refunds,cash_balance,status,comment FROM daily_entries WHERE substr(report_date,1,7)=? ORDER BY report_date').all(month);
    const latest=db.prepare("SELECT MAX(report_date) date FROM daily_entries WHERE status='confirmed' AND comment NOT LIKE '%Стартовые данные из примера%'").get();
    return {...manualReport(entries,month,new Date().toISOString().slice(0,10)),latestAvailableDate:latest?.date||null,budget,budgetWarning};
  }
  if(source!=='bank')throw Object.assign(new Error('Неизвестный источник'),{statusCode:400});
  const file=path.join(privateDir,'bank-daily.json');
  if(!fs.existsSync(file))return {month,source:'bank',rows:[],totals:null,complete:false,scope:'Т-Банк · автоматический снимок ещё не получен',budget,budgetWarning};
  const snapshot=JSON.parse(fs.readFileSync(file,'utf8'));
  const availableMonths=Object.keys(snapshot.months||{}).sort();
  const report=snapshot.months?.[month];
  return report?{...report,updatedAt:snapshot.updatedAt,availableMonths,fullCompanyCoverage:false,budget,budgetWarning}:
    {month,source:'bank',rows:[],totals:null,complete:false,scope:'Т-Банк · за выбранный месяц снимка нет',availableMonths,budget,budgetWarning};
}
module.exports={manualReport,validateMonth,readDailyReport};
