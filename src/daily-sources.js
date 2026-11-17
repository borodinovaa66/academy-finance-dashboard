const fs=require('node:fs');
const path=require('node:path');

// All arithmetic uses integer kopecks. Deposit principal and owner transfers
// are informational fields and never enter business expense or net flow.
const flowFields=['externalIncome','interest','externalExpense','refunds','transferIn','transferOut','depositPlaced','depositReturned','ownerWithdrawal'];
const requiredFields=['externalIncome','interest','externalExpense','refunds'];
const fail=()=>{throw new Error('Дополнительный банковский снимок не прошёл проверку');};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function money(value){
  if(typeof value!=='number'||!Number.isFinite(value))return fail();
  const result=Math.round(value*100);
  const floatingNoise=Math.max(0.000001,Math.abs(value*100)*Number.EPSILON*2);
  if(!Number.isSafeInteger(result)||Math.abs(value*100-result)>floatingNoise)return fail();
  return result;
}
function sum(a,b){const result=a+b;if(!Number.isSafeInteger(result))return fail();return result;}
const rub=value=>value/100;
function calendarDate(value,month){
  if(typeof value!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)||!value.startsWith(month+'-'))return fail();
  if(new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)return fail();
  return value;
}
function validMonth(month){if(typeof month!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))return fail();}
function count(value){if(!Number.isSafeInteger(value)||value<0)return fail();return value;}
function timestamp(value){if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}T/.test(value)||!Number.isFinite(Date.parse(value)))return fail();return value;}
function missingDays(month,throughDate,dates){
  const result=[];
  for(let d=1;d<=Number(throughDate.slice(-2));d++){
    const date=month+'-'+String(d).padStart(2,'0');if(!dates.has(date))result.push(date);
  }
  return result;
}
function checkAccumulated(value,accumulated){
  if(!object(value))return fail();
  for(const k of flowFields)if(k in value&&money(value[k])!==accumulated[k])return fail();
  const net=sum(sum(accumulated.externalIncome,accumulated.interest),-accumulated.externalExpense);
  if('netFlow' in value&&money(value.netFlow)!==net)return fail();
}

/** Validate a report without mutating it; gaps are only allowed if incomplete. */
function validateBankReport(report,month){
  validMonth(month);
  if(!object(report)||report.month!==month||report.source!=='bank'||!Array.isArray(report.rows)||!report.rows.length||typeof report.complete!=='boolean')return fail();
  calendarDate(report.throughDate,month);
  if(report.asOf!==undefined)timestamp(report.asOf);
  const accumulated=Object.fromEntries(flowFields.map(k=>[k,0]));
  let previous='',operations=0;
  for(const row of report.rows){
    if(!object(row))return fail();
    calendarDate(row.date,month);
    if(row.date<=previous||row.date>report.throughDate||row.confirmed!==true)return fail();
    previous=row.date;
    for(const k of requiredFields)if(!(k in row))return fail();
    for(const k of flowFields){const value=k in row?money(row[k]):0;if(value<0)return fail();accumulated[k]=sum(accumulated[k],value);}
    money(row.cashBalance);
    if(money(row.netFlow)!==sum(sum(money(row.externalIncome),money(row.interest)),-money(row.externalExpense)))return fail();
    operations=sum(operations,count(row.operationCount));
    if(row.cumulative!==undefined)checkAccumulated(row.cumulative,accumulated);
  }
  const foreignOperations=(report.accounts||[]).filter(a=>String(a.currency)!=='643').reduce((n,a)=>sum(n,count(a.operations||0)),0);
  if(previous!==report.throughDate||count(report.operationCount)!==sum(operations,foreignOperations))return fail();
  const gaps=missingDays(month,report.throughDate,new Set(report.rows.map(r=>r.date)));
  if(report.complete&&gaps.length)return fail();
  if(!object(report.totals))return fail();
  for(const k of requiredFields)if(!(k in report.totals))return fail();
  checkAccumulated(report.totals,accumulated);
  if(money(report.totals.cashBalance)!==money(report.rows.at(-1).cashBalance))return fail();
  if(report.accounts!==undefined){
    if(!Array.isArray(report.accounts))return fail();
    for(const account of report.accounts){
      if(!object(account)||typeof account.suffix!=='string'||!/^\d{4}$/.test(account.suffix)||!/^\d{3}$/.test(String(account.currency)))return fail();
      money(account.closing);if(account.operations!==undefined)count(account.operations);
      if(account.closingDate!==undefined)calendarDate(account.closingDate,month);
    }
  }
  return report;
}

// Keep the API response at aggregate level even if a private source later grows.
function projectReport(report){
  const result={};
  for(const key of ['month','source','scope','classification','throughDate','asOf','complete','missingDays','operationCount'])if(report[key]!==undefined)result[key]=report[key];
  result.rows=report.rows.map(row=>{
    const out={};for(const k of ['date',...flowFields,'cashBalance','netFlow','operationCount','confirmed'])if(row[k]!==undefined)out[k]=row[k];
    if(row.cumulative!==undefined)out.cumulative=Object.fromEntries([...flowFields,'netFlow'].filter(k=>k in row.cumulative).map(k=>[k,row.cumulative[k]]));
    return out;
  });
  result.totals=Object.fromEntries([...flowFields,'netFlow','cashBalance'].filter(k=>k in report.totals).map(k=>[k,report.totals[k]]));
  result.accounts=(report.accounts||[]).map(account=>Object.fromEntries(['suffix','name','type','currency','closing','operations','closingDate'].filter(k=>k in account).map(k=>[k,account[k]])));
  return result;
}
function checkAggregate(value,depth=0){
  if(depth>12)return fail();
  if(value===null||typeof value==='boolean')return;
  if(typeof value==='number'){if(!Number.isFinite(value))return fail();return;}
  if(typeof value==='string'){if(value.length>10000)return fail();return;}
  if(Array.isArray(value)){if(value.length>1000)return fail();for(const item of value)checkAggregate(item,depth+1);return;}
  if(!object(value))return fail();
  for(const [key,item] of Object.entries(value)){
    if(/(?:password|token|secret|cookie|authorization|transactions|clientRows|personalRows|rawOperations|accountNumber|iban|phone|email|fullName)/i.test(key))return fail();
    checkAggregate(item,depth+1);
  }
}

/** Optional private aggregate snapshot; malformed input deliberately throws. */
function readSupplement(privateDir){
  const file=path.join(privateDir,'daily-supplement.json');
  let descriptor;
  try{descriptor=fs.openSync(file,'r');}catch(error){if(error.code==='ENOENT')return null;throw error;}
  let value;
  try{if(fs.fstatSync(descriptor).size>3*1024*1024)return fail();value=JSON.parse(fs.readFileSync(descriptor,'utf8'));}finally{fs.closeSync(descriptor);}
  if(!object(value)||value.schemaVersion!==1)return fail();
  timestamp(value.updatedAt);checkAggregate(value);
  const allowed=new Set(['schemaVersion','updatedAt','vtb','receivables','onec','status','notes']);
  for(const key of Object.keys(value))if(!allowed.has(key))return fail();
  if(value.receivables!==undefined&&!object(value.receivables))return fail();
  if(value.onec!==undefined&&!object(value.onec))return fail();
  if(value.vtb!==undefined){
    if(!object(value.vtb)||!object(value.vtb.months))return fail();
    const months={};
    for(const [month,report] of Object.entries(value.vtb.months)){validateBankReport(report,month);months[month]=projectReport(report);}
    value.vtb={...value.vtb,months};
  }
  return value;
}

/** Combine only days confirmed by both banks, using their common cutoff. */
function combineBankReports(tbank,vtb,month){
  validateBankReport(tbank,month);validateBankReport(vtb,month);
  const throughDate=[tbank.throughDate,vtb.throughDate].sort()[0];
  const vtbRows=new Map(vtb.rows.map(row=>[row.date,row]));
  const accumulated=Object.fromEntries(flowFields.map(k=>[k,0]));
  let operations=0;
  const rows=[];
  for(const left of tbank.rows){
    const right=vtbRows.get(left.date);
    if(left.date>throughDate||!right)continue;
    const row={date:left.date};
    for(const k of flowFields){const value=sum(k in left?money(left[k]):0,k in right?money(right[k]):0);row[k]=rub(value);accumulated[k]=sum(accumulated[k],value);}
    row.netFlow=rub(sum(sum(money(row.externalIncome),money(row.interest)),-money(row.externalExpense)));
    row.cashBalance=rub(sum(money(left.cashBalance),money(right.cashBalance)));
    row.operationCount=sum(left.operationCount,right.operationCount);operations=sum(operations,row.operationCount);
    row.confirmed=true;
    row.cumulative={...Object.fromEntries(flowFields.map(k=>[k,rub(accumulated[k])])),netFlow:rub(sum(sum(accumulated.externalIncome,accumulated.interest),-accumulated.externalExpense))};
    rows.push(row);
  }
  const gaps=missingDays(month,throughDate,new Set(rows.map(row=>row.date)));
  const sourceCoverage=[['tbank',tbank],['vtb',vtb]].map(([bank,report])=>({bank,source:'bank',throughDate:report.throughDate,asOf:report.asOf||null,complete:report.complete}));
  const snapshots=sourceCoverage.map(source=>source.asOf).filter(Boolean).sort((a,b)=>Date.parse(a)-Date.parse(b));
  const last=rows.at(-1);
  return {month,source:'bank',bankScope:'combined',scope:'Т-Банк + ВТБ · общий подтверждённый период',throughDate:last?.date||null,requestedThroughDate:throughDate,
    asOf:snapshots.at(-1)||null,sourceCoverage,fullCompanyCoverage:false,rows,
    totals:last?{...last.cumulative,cashBalance:last.cashBalance}:null,operationCount:operations,
    complete:!!last&&!gaps.length&&tbank.complete&&vtb.complete,missingDays:gaps,
    accounts:[['tbank',tbank],['vtb',vtb]].flatMap(([bank,report])=>projectReport(report).accounts.map(account=>({...account,bank,source:'bank',closingDate:account.closingDate||report.throughDate}))),
    classification:'Проценты включены в денежный результат; возвраты входят в списания и повторно не вычитаются. Тело депозитов и вывод владельцу показаны отдельно. Остаток — на общую дату банков; остатки счетов в деталях имеют собственную дату. Число операций в объединённом ряду относится к рублёвым счетам.'};
}
module.exports={readSupplement,combineBankReports,validateBankReport};
