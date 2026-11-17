'use strict';
// This deliberately remains a limited cohort view, not a company debt ledger.
const SOURCE='1K6kSsEHBbDT_uIomyoeR1HuDsmUrWj9tiV03owSA524';
const CONFIG=[
 {id:681627499,title:'УЦ 48 (декабрь 26)',cost:17,paid:18,notes:[5,15,19,22],header:4},
 {id:522331846,title:' Тренерский курс ( онлайн ноябрь 26)',cost:19,paid:20,notes:[21,22],header:3},
 {id:387647696,title:'УЦ 47 (сентябрь 26)',cost:17,paid:18,notes:[5,15,19,22],header:4},
 {id:938698366,title:'УЦ 46(июль 26)',cost:18,paid:19,notes:[6,16,20,23],header:4},
 {id:101589737,title:'УЦ 2.0 П8 онлайн ( октябрь 26)',cost:15,paid:16,notes:[14,17,20],header:4},
 {id:1292485150,title:'УЦ 45(май 26)',cost:16,paid:18,notes:[5,14,19,22],header:4}
];
const HEADERS={681627499:['переводник','Особые отметки','Для фин отдела','Особые условия по ВР'],522331846:['Для фин отдела','Особые отметки'],387647696:['переводник','Особые отметки','Для фин отдела','Особые условия по ВР'],938698366:['переводник','Особые отметки','Для фин отдела','Особые условия по ВР'],101589737:['Особые отметки','Для фин отдела','Особые условия по ВР'],1292485150:['переводник','Особые отметки','Для фин отдела','Особые условия по ВР']};
for(const c of CONFIG)c.noteHeaders=HEADERS[c.id];
const fail=()=>{throw Error('RECEIVABLES_STRUCTURE_CHANGED');};
function value(c){const v=c?.effectiveValue;if(!v)return null;if(v.errorValue)throw Error('RECEIVABLES_CELL_ERROR');return v.numberValue??v.stringValue??v.boolValue??null;}
function money(v){if(v===null||v===''||typeof v==='boolean')return null;const n=typeof v==='number'?v:Number(String(v).replace(/[\s\u00a0]/g,'').replace(',','.'));if(!Number.isFinite(n))return null;const c=Math.round(n*100);if(!Number.isSafeInteger(c)||Math.abs(n*100-c)>Math.max(1e-6,Math.abs(n*100)*Number.EPSILON*2))return null;return c;}
function date(v){if(typeof v==='number'&&v>40000&&v<70000)return new Date(Date.UTC(1899,11,30)+Math.round(v)*86400000).toISOString().slice(0,10);if(typeof v==='string'&&/^\d{2}\.\d{2}\.20\d{2}$/.test(v.trim()))return v.trim().split('.').reverse().join('-');return null;}
function col(n){return String.fromCharCode(64+n);}
function transform(book,checkedAt){
 if(book?.spreadsheetId!==SOURCE||!Array.isArray(book.sheets)||!Number.isFinite(Date.parse(checkedAt)))fail();
 const cohorts=[],expected=[],issues=[],identities=new Map();let duplicateGroups=0;
 for(const cfg of CONFIG){
  const s=book.sheets.find(s=>s.properties?.sheetId===cfg.id);if(!s||s.properties.gridProperties?.rowCount>2000||s.data?.length!==1)fail();
  const grid=s.data[0];if((grid.startRow||0)!==0||(grid.startColumn||0)!==0||!Array.isArray(grid.rowData))fail();
  const rows=grid.rowData.map(r=>r.values||[]),header=rows[cfg.header-1]||[];
  if(!/стоимость/i.test(String(value(header[cfg.cost-1])))||!/оплачено/i.test(String(value(header[cfg.paid-1]))))fail();
  for(let n=0;n<cfg.notes.length;n++)if(String(value(header[cfg.notes[n]-1])).trim().toLowerCase()!==cfg.noteHeaders[n].toLowerCase())fail();
  let section='active_new',amount=0,records=0,excluded=0;let updatedAt=null;
  for(const c of rows[0]||[]){const d=date(value(c));if(d&&(!updatedAt||d>updatedAt))updatedAt=d;}
  for(let i=5;i<rows.length;i++){
   const row=rows[i],v=n=>value(row[n-1]),a=String(v(1)||'').trim(),upper=a.toUpperCase();
   if(/^(ТАРИФ|ТОЛЬКО|НОВЫХ ПОКУПО)/.test(upper))section='active_new';
   else if(/ПЕРЕВ|ПЕРЕНОС/.test(upper)&&(/ПОТОК/.test(upper)||upper==='ПЕРЕВОД ИИ'))section='transfer';
   else if(/^ВЫБЫЛ/.test(upper))section='exited_or_refund';else if(upper==='В РАБОТЕ')section='in_work';
   const formula=row[cfg.cost-1]?.userEnteredValue?.formulaValue||'';
   if(/\bSUM\s*\(/i.test(formula)||/^=?[A-Z]+\d+\+[A-Z]+\d+$/.test(formula))continue;
   const cost=money(v(cfg.cost)),paid=money(v(cfg.paid));if(cost===null&&paid===null)continue;
   const b=String(v(2)||'').trim();if(typeof v(2)!=='string'||!/[А-Яа-яA-Za-z]/.test(b))continue;
   const status=String(v(3)||'').toLowerCase().trim(),notes=cfg.notes.map(n=>String(v(n)||'')),joined=notes.join(' ').toLowerCase();
   const key=(a.includes('@')?a:b).toLowerCase().replace(/\s+/g,' ');identities.set(key,(identities.get(key)||0)+1);
   const flagged=section!=='active_new'||['переведен','переведён','прибыл','в работе'].includes(status)||/возврат/.test(status)||/перевод|перенос|зачтен|зачтён|зачтена|первый модуль/.test(joined)||cost===null||paid===null||cost<paid||[...cfg.notes,cfg.cost,cfg.paid].some(n=>row[n-1]?.note);
   if(flagged){excluded++;continue;}
   records++;amount+=Math.max(0,cost-paid);if(!Number.isSafeInteger(amount))fail();
   // Only a literal November promise in a 2026 cohort becomes a dated note.
   if(/26/.test(s.properties.title))for(const n of cfg.notes){
    const text=String(v(n)||'');const re=/к\s+(\d{1,2})\s+ноябр[яь]\s*[-—–:]?\s*(\d+(?:[.,]\d+)?)\s*т\.?\s*р\.?/gi;
    for(const m of text.matchAll(re)){const day=Number(m[1]),sum=money(Number(m[2].replace(',','.'))*1000);if(day<1||day>30||sum===null||sum<=0)continue;
     expected.push({date:'2026-11-'+String(day).padStart(2,'0'),amount:sum/100,status:'Рабочая заметка; договор и банк не сверены',sourceCell:col(n)+(i+1),sourceSheet:s.properties.title,yearInferred:true});}
   }
  }
  cohorts.push({name:s.properties.title.trim(),records,nominalOutstanding:amount/100,updatedAt,sourceSheet:cfg.id,excludedRecords:excluded});
  const at=ref=>{const m=/^([A-Z])(\d+)$/.exec(ref);return rows[Number(m[2])-1]?.[m[1].charCodeAt(0)-65]?.userEnteredValue?.formulaValue||'';};
  if(cfg.id===522331846&&/SUM\(S8:S40\)/i.test(at('S42')))issues.push('Тренерский онлайн: итог S42 пропускает строки 6–7. Агрегат рассчитан по строкам, а не по этому итогу.');
  if(cfg.id===387647696&&/Q155\+Q59/.test(at('Q179')))issues.push('УЦ47: Q179 ссылается на Q155. Проверка подытога требует исправления владельцем источника.');
 }
 duplicateGroups=[...identities.values()].filter(n=>n>1).length;if(duplicateGroups)issues.push(`Межлистовые/внутрилистовые совпадения идентификаторов: ${duplicateGroups} групп. Общий остаток компании не суммируется.`);
 return {asOfExport:checkedAt.slice(0,10),checkedAt,lastExplicitUpdate:cohorts.map(c=>c.updatedAt).filter(Boolean).sort().at(-1)||null,sourceUrl:'https://docs.google.com/spreadsheets/d/'+SOURCE+'/edit',scope:'Ограниченная выборка новых покупок: 6 проверенных листов. Переносы, возвраты, неопределённые строки и строки с финансовыми примечаниями исключены. Общий итог компании не определён.',fullReceivables:null,overdue:null,cohorts,expected,issues,notes:['Оплачено — накопительно, без дат платежей: поступления ноября по этому полю не определяются.','Даты занятий не являются сроками взносов. Остаток не считается просрочкой.','Время успешного чтения сервера не означает, что сотрудники обновили исходные значения.','Ожидаемые платежи извлечены из явных заметок; договоры и банк не сверены. Это не утверждённый платёжный календарь.']};
}
module.exports={transform,CONFIG,SOURCE};
