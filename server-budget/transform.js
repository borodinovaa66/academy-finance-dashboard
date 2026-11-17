'use strict';
const crypto=require('node:crypto');
const {validateBudgetSnapshot}=require('../src/budget');
const MASTER='https://docs.google.com/spreadsheets/d/1gdj4Iass8LR8jqwQ_2woOKwV0Z3yB1hGQh2uTm84zAo/edit';
const PAYROLL='https://docs.google.com/spreadsheets/d/1lipAo1xEMo1mvieSdX-XiWADV1skrx4MB-9FTinlzJU/edit';
const cents=n=>{if(typeof n!=='number'||!Number.isFinite(n)||n<0||Math.abs(n*100-Math.round(n*100))>.0001)throw Error('INVALID_AMOUNT');return Math.round(n*100);};
const rub=n=>Math.round(n)/100;
const sum=nodes=>rub(nodes.reduce((s,n)=>s+(n.amount===null?0:cents(n.amount)),0));
const norm=s=>String(s||'').toLowerCase().replaceAll('ё','е').replace('анастаися','анастасия').replaceAll(/[^а-яa-z\s]/g,' ').trim().split(/\s+/).sort().join(' ');
const id=(prefix,s)=>prefix+'-'+crypto.createHash('sha256').update(String(s)).digest('hex').slice(0,14);
function source(url,label,cell){return {url,label,...(cell?{cell}:{})};}
function grid(book,title){
 const sheet=book?.sheets?.find(s=>s.properties?.title===title);if(!sheet)throw Error('SOURCE_SHEET_MISSING');
 const cells=new Map(),rows=new Set();
 for(const d of sheet.data||[])for(let i=0;i<(d.rowData||[]).length;i++)for(let j=0;j<(d.rowData[i].values||[]).length;j++){
  const c=d.rowData[i].values[j],v=c.effectiveValue||c.userEnteredValue||{};
  if(v.errorValue)throw Error('SHEET_ERROR');
  const r=(d.startRow||0)+i+1,col=(d.startColumn||0)+j+1;
  cells.set(r+','+col,{value:v.numberValue??v.stringValue??null,note:c.note||'',formula:c.userEnteredValue?.formulaValue||''});rows.add(r);
 }
 return {rows:[...rows].sort((a,b)=>a-b),get:(r,c)=>cells.get(r+','+c)?.value??null,note:(r,c)=>cells.get(r+','+c)?.note||'',sheetId:sheet.properties.sheetId};
}
function number(g,r,c){const x=g.get(r,c);cents(x);return x;}
function find(node,key){if(node?.id===key)return node;for(const c of node?.children||[]){const f=find(c,key);if(f)return f;}return null;}
function leaf(key,name,amount,extra={}){if(amount!==null)cents(amount);return {id:key,name:String(name),amount,status:'plan',...extra,...(amount===null?{unknown:true,status:'unknown'}:{})};}
function group(key,name,children,extra={}){return {id:key,name,amount:sum(children),children,...extra};}
function exactGroup(key,name,amount,children,warnings,extra={}){
 if(cents(amount)===cents(sum(children)))return group(key,name,children,extra);
 warnings.push('DETAIL_NOT_RECONCILED');
 return leaf(key,name,amount,{...extra,detail:'Сумма взята из общего бюджета. Персональная разбивка в другом источнике пока не сходится с ней; неподтверждённые строки не показаны повторно.'});
}
function buildLiveBudget(master,payroll,previous,month,at=new Date().toISOString()){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('INVALID_MONTH');
 const plan=grid(master,'План'),four=grid(master,'Четыре блока'),audit=grid(master,'Разбор ФОТ 16.11'),tax=grid(master,'Проект налогов'),svod=grid(master,'Свод');
 const cost=grid(payroll,'Стоимость ФОТ'),terms=grid(payroll,'Разбор ФОТ'),personTax=grid(payroll,'Проект налогов');
 if(!/ID/.test(plan.get(6,1)||'')||plan.get(6,3)!=='Вид'||!/Верхний блок/.test(plan.get(6,15)||'')||cost.get(6,2)!=='Человек')throw Error('SOURCE_SCHEMA_CHANGED');
 const expectedAudit={8:'Известный net актуальной команды',12:'Пул продаж: 3% поступлений',13:'Выплата за июль–сентябрь',14:'Старые строки завершивших работу в октябре',15:'Старые строки завершивших работу в ноябре',16:'Прежний лимит почасовой работы',19:'Контроль разложения',51:'Контроль распределения'};
 for(const [r,label] of Object.entries(expectedAudit))if(audit.get(Number(r),1)!==label)throw Error('SOURCE_SCHEMA_CHANGED');
 if(number(four,13,2)!==0||number(audit,19,2)!==0||number(audit,51,2)!==0)throw Error('SOURCE_CONTROL_FAILED');
 const warnings=[],sourceAudit=source(MASTER+'#gid='+audit.sheetId,'Разбор ФОТ'),sourceTax=source(MASTER+'#gid='+tax.sheetId,'Проект налогов');
 const records=[],seen=new Set(),excluded=[];
 for(const r of plan.rows){
  if(r<=6||!['Расходы','Поступления'].includes(plan.get(r,3)))continue;
  const key=plan.get(r,1),amount=plan.get(r,7);
  if(!key){if(typeof amount==='number'&&amount!==0)excluded.push(r);continue;}
  if(seen.has(key))throw Error('DUPLICATE_SOURCE_ID');seen.add(key);
  if(amount!==null)cents(amount);
  records.push({r,key,amount,name:plan.get(r,6),type:plan.get(r,3),block:plan.get(r,15),category:plan.get(r,16)||'Без подблока',cfo:plan.get(r,2),code:plan.get(r,5),status:plan.get(r,17),note:plan.get(r,18)||'',originalSource:plan.get(r,13)});
 }
 const incomes=records.filter(r=>r.type==='Поступления'),expenses=records.filter(r=>r.type==='Расходы');
 const incomeTotal=sum(incomes),expenseTotal=sum(expenses);
 if(cents(incomeTotal)!==cents(number(svod,16,2))||cents(expenseTotal)!==cents(number(svod,16,3))||cents(expenseTotal)!==cents(number(four,11,2)))throw Error('SOURCE_TOTAL_MISMATCH');
 const blockNames=['ФОТ','Налоги','Сервисы','Маркетинг'];
 for(let i=0;i<blockNames.length;i++)if(four.get(7+i,1)!==blockNames[i]||cents(sum(expenses.filter(r=>r.block===blockNames[i])))!==cents(number(four,7+i,2)))throw Error('BLOCK_TOTAL_MISMATCH');
 if(expenses.some(r=>!blockNames.includes(r.block)))throw Error('UNMAPPED_EXPENSE_BLOCK');
 const planLeaf=r=>leaf('plan-'+r.key,r.name||'Назначение не заполнено',r.amount,{code:r.code,cfo:r.cfo,detail:r.note,source:source(MASTER+'#gid='+plan.sheetId+'&range=A'+r.r+':R'+r.r,'План бюджета','Строка '+r.r),status:r.status==='Проектный резерв'?'estimate':'plan'});
 const incomeSource=source(MASTER+'#gid='+plan.sheetId,'План поступлений');
 const income=group('income','План поступлений',[
  group('income-sales','Продажи и остальные поступления',incomes.filter(r=>!/дебитор/i.test(r.name||'')).map(planLeaf),{source:incomeSource,detail:'Цель поступлений. Не признанная выручка и не график банковских зачислений.'}),
  group('income-debt','Сбор дебиторской задолженности',incomes.filter(r=>/дебитор/i.test(r.name||'')).map(planLeaf),{source:incomeSource,detail:'План сбора задолженности, а не полный остаток долга.'})
 ],{source:incomeSource});
 const termRows=new Map(),taxRows=new Map();
 for(const r of terms.rows)if(r>6&&typeof terms.get(r,3)==='number'&&terms.get(r,2))termRows.set(norm(String(terms.get(r,2)).split('\n')[0]),r);
 for(const r of personTax.rows)if(r>26&&typeof personTax.get(r,4)==='number'&&personTax.get(r,2))taxRows.set(norm(personTax.get(r,2)),r);
 const people=[],personNames=new Set(),departments=new Map();
 for(const r of cost.rows){
  if(r<=6||cost.get(r,9)!==month||!cost.get(r,2))continue;
  const name=String(cost.get(r,2)),dept=String(cost.get(r,1)||'Отдел не указан'),net=cost.get(r,3),key=norm(name);
  if(personNames.has(key))throw Error('DUPLICATE_PAYROLL_PERSON');personNames.add(key);
  const nodeId=id('person',key),basis=source(PAYROLL+'#gid='+cost.sheetId+'&range=A'+r+':N'+r,'Стоимость ФОТ','Строка '+r);
  if(typeof net!=='number'){warnings.push('UNKNOWN_PAYROLL_AMOUNT');people.push({key,name,dept,node:leaf(nodeId,name,null,{source:basis}),tax:null});continue;}
  cents(net);let pieces;
  const tr=termRows.get(key),pr=taxRows.get(key),monthlyFixed=tr?terms.get(tr,3):null,monthlyKpi=tr?terms.get(tr,4):null,factor=pr?personTax.get(pr,5):null;
  if(typeof monthlyFixed==='number'&&typeof monthlyKpi==='number'&&typeof factor==='number'&&factor>=0&&factor<=1&&Math.round((monthlyFixed+monthlyKpi)*factor*100)===cents(net)){
   pieces=[leaf(nodeId+'-fixed','Фикс · проект',rub(Math.round(monthlyFixed*factor*100)),{source:basis,status:'estimate'})];
   if(monthlyKpi!==0)pieces.push(leaf(nodeId+'-kpi','KPI · проект',rub(cents(net)-cents(pieces[0].amount)),{source:basis,status:'estimate'}));
  }else pieces=[leaf(nodeId+'-net','Проект на руки по источнику',net,{source:basis,status:'estimate'})];
  const n=group(nodeId,name,pieces,{source:basis,status:'estimate',detail:String(cost.get(r,8)||'Условия и налоги требуют подтверждения.')});
  people.push({key,name,dept,node:n,tax:typeof cost.get(r,4)==='number'?cost.get(r,4):null});
 }
 if(!people.length)throw Error('PAYROLL_SOURCE_EMPTY');
 for(const p of people){if(!departments.has(p.dept))departments.set(p.dept,[]);departments.get(p.dept).push(p.node);}
 const knownLive=group('pay-known','Известные вознаграждения текущей команды',[...departments].map(([name,children])=>group(id('pay-dept',name),name,children,{personalDetail:true,source:sourceAudit})),{status:'estimate',source:sourceAudit,detail:'Живые персональные суммы из закрытой таблицы. Неизвестные суммы не заменены нулями.'});
 const known=exactGroup('pay-known',knownLive.name,number(audit,8,2),knownLive.children,warnings,{status:'estimate',source:sourceAudit,detail:knownLive.detail});
 const oldOffboarding={october:[],november:[]};
 for(const r of terms.rows){
  if(r<53||r>58||!terms.get(r,1)||typeof terms.get(r,6)!=='number')continue;
  const date=String(terms.get(r,2)||''),name=String(terms.get(r,1));
  let bucket=/\.10\.20/.test(date)?'october':/\.11\.20/.test(date)?'november':null;
  if(!bucket){const prior=find(previous?.months?.[month]?.expense,'pending-november');if(prior?.children?.some(c=>norm(c.name).includes(norm(name))||norm(name).includes(norm(c.name.split('·')[0]))))bucket='november';}
  if(bucket)oldOffboarding[bucket].push(leaf(id('old-'+bucket,name),name,terms.get(r,6),{status:'reserve',source:source(PAYROLL+'#gid='+terms.sheetId+'&range=A'+r+':H'+r,'Прежняя строка, не сумма долга')}));
 }
 const pending=group('pay-pending','Условные и переходящие суммы',[
  leaf('pending-sales-pool','Бонусный пул продаж',number(audit,12,2),{source:sourceAudit,status:'reserve',detail:String(audit.get(12,4)||'Пересечение с KPI требует проверки.')}),
  leaf('pending-supervision','Курирование отгрузок прошлых периодов',number(audit,13,2),{source:sourceAudit,status:'prior_period',priorPeriod:true,detail:String(audit.get(13,4)||'Остаток и срок оплаты не подтверждены.')}),
  exactGroup('pending-october','Старые строки завершивших работу в октябре',number(audit,14,2),oldOffboarding.october,warnings,{source:sourceAudit,status:'prior_period',priorPeriod:true,personalDetail:true,detail:'Старые лимиты не являются остатком долга.'}),
  exactGroup('pending-november','Ноябрьские окончательные расчёты · лимит',number(audit,15,2),oldOffboarding.november,warnings,{source:sourceAudit,status:'reserve',personalDetail:true,detail:'Лимит, а не подтверждённое начисление.'}),
  leaf('pending-hourly','Почасовая работа · лимит',number(audit,16,2),{source:sourceAudit,status:'reserve',detail:String(audit.get(16,4)||'Ставка, часы и акты не подтверждены.')})
 ],{source:sourceAudit,status:'reserve',detail:'Это условные суммы, не подтверждённый долг. Полная оценка налогов по ним отсутствует.'});
 const taxPlan=expenses.filter(r=>r.block==='ФОТ'&&r.category!=='ФОТ по формам');
 const ndflRows=taxPlan.filter(r=>/НДФЛ/i.test(r.category)),injuryRows=taxPlan.filter(r=>/травмат/i.test(r.category)),employerRows=taxPlan.filter(r=>/взнос/i.test(r.category));
 if(ndflRows.length!==1||injuryRows.length!==1||employerRows.length!==1||taxPlan.length!==3)throw Error('PAYROLL_TAX_SCHEMA_CHANGED');
 function reserveTax(key,name,target,calculated,children){
  if(cents(calculated)>cents(target))throw Error('TAX_RESERVE_BELOW_CALCULATION');
  const calculation=children.length?exactGroup(key+'-calculation','Расчёт по известной базе',calculated,children,warnings,{source:sourceTax,status:'estimate',personalDetail:key==='tax-ndfl'}):leaf(key+'-calculation','Расчёт из источника',calculated,{source:sourceTax,status:'estimate'});
  return group(key,name,[calculation,leaf(key+'-rounding','Запас над расчётом',rub(cents(target)-cents(calculated)),{source:sourceTax,status:'reserve'})],{source:sourceTax,status:'estimate',detail:'Сценарий источника, не итоговая налоговая ведомость.'});
 }
 const ndfl=reserveTax('tax-ndfl','НДФЛ · резерв',ndflRows[0].amount,number(tax,19,3),people.filter(p=>p.tax!==null&&p.tax>0).map(p=>leaf(id('ndfl-person',p.key),p.name,p.tax,{status:'estimate',source:sourceTax})));
 const employer=reserveTax('tax-employer','Страховые взносы · резерв',employerRows[0].amount,number(tax,43,3),[]);
 const injury=reserveTax('tax-injury','Травматизм · резерв',injuryRows[0].amount,number(tax,44,3),[]);
 // Aggregate insurance estimates have an exact live source cell, no invented personal allocation.
 employer.children[0]=leaf('tax-employer-calculation','Расчёт из источника',number(tax,43,3),{status:'estimate',source:sourceTax,detail:String(tax.get(43,4)||'Применимость тарифа не подтверждена.')});
 injury.children[0]=leaf('tax-injury-calculation','Расчёт из источника',number(tax,44,3),{status:'estimate',source:sourceTax,detail:String(tax.get(44,4)||'Применимость тарифа не подтверждена.')});
 const salaryTaxes=group('pay-taxes','Зарплатные налоги и взносы',[ndfl,employer,injury],{status:'estimate',source:sourceTax});
 let payrollNode=group('payroll','ФОТ',[known,pending,salaryTaxes],{source:sourceAudit,detail:'Зарплатные налоги внутри ФОТ. Детализация читается из Google; условные суммы не являются начислениями.'});
 const authoritativePayroll=sum(expenses.filter(r=>r.block==='ФОТ'));
 if(cents(payrollNode.amount)!==cents(authoritativePayroll)){
  warnings.push('PAYROLL_AGGREGATES_NOT_RECONCILED');
  payrollNode=group('payroll','ФОТ',expenses.filter(r=>r.block==='ФОТ').map(planLeaf),{source:sourceAudit,detail:'Итог общего плана обновлён. Персональная и резервная разбивка пока не увязана с ним: показаны исходные агрегаты без двойного счёта.'});
 }
 function otherBlock(name,key){
  const groups=new Map();for(const row of expenses.filter(r=>r.block===name)){if(!groups.has(row.category))groups.set(row.category,[]);groups.get(row.category).push(planLeaf(row));}
  return group(key,name,[...groups].map(([label,children])=>group(id(key+'-category',label),label,children,{personalDetail:label==='Требует проверки состава команды'})),{source:source(MASTER+'#gid='+plan.sheetId,'План бюджета')});
 }
 const expense=group('expense','Проект расходов и резервов',[payrollNode,otherBlock('Налоги','general-taxes'),otherBlock('Сервисы','services'),otherBlock('Маркетинг','marketing')]);
 if(cents(expense.amount)!==cents(expenseTotal))throw Error('HIERARCHY_TOTAL_MISMATCH');
 const priorPeriodReserve=number(audit,13,2)+number(audit,14,2),namedConditionalCompensation=pending.amount;
 // Fallback still marks the prior-period subset in its aggregate source rows so scenario sums never drift.
 if(warnings.includes('PAYROLL_AGGREGATES_NOT_RECONCILED')){
  const taxIDs=new Set(taxPlan.map(r=>'plan-'+r.key));
  const salary=payrollNode.children.filter(n=>!taxIDs.has(n.id));
  payrollNode.children=payrollNode.children.filter(n=>!salary.includes(n));
  const salaryTotal=sum(salary);if(cents(salaryTotal)<cents(priorPeriodReserve))throw Error('PRIOR_RESERVE_EXCEEDS_PAYROLL');
  payrollNode.children.unshift(group('pay-aggregate-unallocated','Вознаграждения по общему плану',[
   leaf('pay-aggregate-current','Агрегаты без прошлого периода',rub(cents(salaryTotal)-cents(priorPeriodReserve)),{source:sourceAudit,status:'estimate'}),
   leaf('pay-aggregate-prior','Переходящие резервы прошлых периодов',priorPeriodReserve,{source:sourceAudit,status:'prior_period',priorPeriod:true})
  ],{source:sourceAudit,detail:'Персональное распределение требует увязки.'}));
 }
 const notes=[
  'Это проект, не окончательное утверждение, не факт оплаты и не расчёт прибыли.',
  'Переходящие резервы прошлых периодов уже входят в общий итог; их задолженность и даты оплаты не установлены.',
  'Налоговые ставки, годовые базы и часть договорных условий остаются расчётными допущениями.',
  'Неизвестные суммы и отсутствующие строки не считаются подтверждёнными нулями.',
  'Сайт автоматически читает источники два раза в сутки: в 09:00 и 16:00 по Москве. При ошибке сохраняется последняя проверенная версия.'
 ];
 if(excluded.length)notes.push('В исходном плане есть строки с суммой без активного ID. Как и формулы Google-свода, сайт не прибавляет их к итогу.');
 if(warnings.some(w=>/NOT_RECONCILED/.test(w)))notes.push('Часть глубокой детализации пока не увязана с агрегатами. В таких ветках показаны суммы общего плана, а не расходящиеся персональные строки.');
 const report={asOf:at.slice(0,10),fetchedAt:at,status:'draft',version:'Проект бюджета · автоматическая сверка Google',income,expense,priorPeriodReserve,withoutPriorPeriods:rub(cents(expense.amount)-cents(priorPeriodReserve)),namedConditionalCompensation,notes,gaps:[{name:'Неопределённые начисления и условия',amount:null,detail:'Часы, бонусы, окончательные расчёты и полный состав налогов требуют увязки в источнике.'}],sources:[sourceAudit,sourceTax,source(MASTER+'#gid='+plan.sheetId,'План бюджета')],warnings:[...new Set(warnings)]};
 const budget={schemaVersion:1,months:{...previous?.months,[month]:report}};validateBudgetSnapshot(budget);
 const oldCash=previous?.cashPlan?.months?.[month]||{};
 const cashRows=incomes.map(r=>({name:r.name,amount:r.amount,kind:/дебитор/i.test(r.name||'')?'receivables':'new_sales'}));
 if(cashRows.some(r=>r.amount===null))throw Error('UNKNOWN_INCOME_TOTAL');
 const cashPlan={schemaVersion:1,months:{...previous?.cashPlan?.months,[month]:{...oldCash,asOf:report.asOf,status:'draft',version:report.version,sourceUrl:MASTER+'#gid='+four.sheetId,income:{kind:'cash_receipts_target',total:income.amount,rows:cashRows,note:'Цель поступлений, не календарь денег и не признанная выручка.'},expense:{total:expense.amount,blocks:expense.children.map(n=>({name:n.name,amount:n.amount})),priorPeriodReserve,note:'Проект с условными резервами; не подтверждённые выплаты и не прибыль.'},sources:oldCash.sources||[]}}};
 return {budget,cashPlan,warnings:report.warnings,excludedRows:excluded.length};
}
module.exports={buildLiveBudget,grid};
