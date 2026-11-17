const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {buildLiveBudget}=require('../server-budget/transform');
const {publish,validateCandidate}=require('../server-budget/publish');
const {readBudget}=require('../src/budget'),{readCashPlan}=require('../src/cash-plan');
function fake(){
 const master={sheets:[]},payroll={sheets:[]};
 function cell(book,title,r,c,value){let s=book.sheets.find(x=>x.properties.title===title);if(!s){s={properties:{title,sheetId:book.sheets.length+1},data:[{startRow:0,startColumn:0,rowData:[]}]};book.sheets.push(s);}const rows=s.data[0].rowData;while(rows.length<r)rows.push({values:[]});while(rows[r-1].values.length<c)rows[r-1].values.push({});rows[r-1].values[c-1]={effectiveValue:value===null?{}:typeof value==='number'?{numberValue:value}:{stringValue:value}};}
 const m=(t,r,c,v)=>cell(master,t,r,c,v),p=(t,r,c,v)=>cell(payroll,t,r,c,v);
 m('План',6,1,'ID свода');m('План',6,3,'Вид');m('План',6,15,'Верхний блок');p('Стоимость ФОТ',6,2,'Человек');p('Разбор ФОТ',6,2,'Человек');p('Проект налогов',6,2,'Человек');
 const rows=[['income','Поступления','Продажи',100,'',''],['salary','Расходы','Команда',60,'ФОТ','ФОТ по формам'],['ndfl','Расходы','НДФЛ',2,'ФОТ','НДФЛ'],['insurance','Расходы','Взносы',3,'ФОТ','Страховые взносы'],['injury','Расходы','Травматизм',1,'ФОТ','Травматизм'],['tax','Расходы','Налог',10,'Налоги','Налоги'],['service','Расходы','Лицензия',20,'Сервисы','ИТ'],['ads','Расходы','Реклама',4,'Маркетинг','Реклама']];
 rows.forEach(([id,type,name,amount,block,sub],i)=>{for(const [c,v] of [[1,id],[3,type],[6,name],[7,amount],[15,block],[16,sub]])m('План',7+i,c,v);});
 ['ФОТ','Налоги','Сервисы','Маркетинг'].forEach((name,i)=>{m('Четыре блока',7+i,1,name);m('Четыре блока',7+i,2,[66,10,20,4][i]);});m('Четыре блока',11,2,100);m('Четыре блока',13,2,0);m('Свод',16,2,100);m('Свод',16,3,100);
 const labels={8:'Известный net актуальной команды',12:'Пул продаж: 3% поступлений',13:'Выплата за июль–сентябрь',14:'Старые строки завершивших работу в октябре',15:'Старые строки завершивших работу в ноябре',16:'Прежний лимит почасовой работы',19:'Контроль разложения',51:'Контроль распределения'};
 for(const [r,label] of Object.entries(labels)){m('Разбор ФОТ 16.11',+r,1,label);m('Разбор ФОТ 16.11',+r,2,+r===8?60:0);}
 m('Проект налогов',19,3,1);m('Проект налогов',43,3,2.9);m('Проект налогов',44,3,.01);
 for(const [c,v] of [[1,'Отдел'],[2,'Fictional Person'],[3,60],[4,1],[9,'2026-11']])p('Стоимость ФОТ',7,c,v);
 return {master,payroll,previous:{schemaVersion:1,months:{}},m,p};
}
function candidate(f=fake()){return {schemaVersion:1,sourceHash:'a'.repeat(64),checkedAt:new Date().toISOString(),...buildLiveBudget(f.master,f.payroll,f.previous,'2026-11')};}
test('synthetic live plan accepts new rows and null unknowns, rejects duplicates and stale structure',()=>{
 const f=fake();f.m('План',18,1,'new');f.m('План',18,3,'Расходы');f.m('План',18,6,'Unknown service');f.m('План',18,15,'Сервисы');f.m('План',18,7,null);
 let c=candidate(f);assert.equal(c.budget.months['2026-11'].expense.amount,100);assert.match(JSON.stringify(c.budget),/Unknown service/);assert.match(JSON.stringify(c.budget),/"unknown":true/);
 f.m('План',18,1,'salary');assert.throws(()=>candidate(f),/DUPLICATE_SOURCE_ID/);
 const shifted=fake();shifted.m('Разбор ФОТ 16.11',8,1,'Moved row');assert.throws(()=>candidate(shifted),/SOURCE_SCHEMA_CHANGED/);
});
test('unreconciled payroll does not reuse stale people or invent balancing expenses',()=>{
 const f=fake();f.p('Стоимость ФОТ',7,3,59);const c=candidate(f);assert.match(c.warnings.join(','),/DETAIL_NOT_RECONCILED/);const known=c.budget.months['2026-11'].expense.children[0].children[0];assert.equal(known.amount,60);assert.equal(known.children,undefined);assert.equal(c.budget.months['2026-11'].expense.amount,100);
});
test('publication switches both readers together and failures retain last valid generation',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'budget-publish-')),state=path.join(dir,'state'),priv=path.join(dir,'private');fs.mkdirSync(state);fs.mkdirSync(priv);
 const put=(name,obj)=>fs.writeFileSync(path.join(state,name),JSON.stringify(obj));
 try{
  const c=candidate();put('candidate.json',c);put('status.json',{state:'ok',checkedAt:c.checkedAt,lastSuccessAt:c.checkedAt,sourceHash:c.sourceHash});
  assert.equal(publish(state,priv).changed,true);assert.equal(readBudget(priv,'2026-11','owner').expense.amount,100);assert.equal(readCashPlan(priv,'2026-11').expense.total,100);
  assert.doesNotMatch(JSON.stringify(readBudget(priv,'2026-11','viewer')),/Fictional Person/);
  const pointer=fs.readFileSync(path.join(priv,'budget-sync/current.json'),'utf8');assert.equal(publish(state,priv).changed,false);
  put('status.json',{state:'error',checkedAt:c.checkedAt,errorCode:'GOOGLE_ACCESS_DENIED'});publish(state,priv);assert.equal(fs.readFileSync(path.join(priv,'budget-sync/current.json'),'utf8'),pointer);assert.equal(readBudget(priv,'2026-11','owner').sync.state,'error');
  c.budget.months['2026-11'].expense.amount=99;put('candidate.json',c);put('status.json',{state:'ok',checkedAt:c.checkedAt,sourceHash:c.sourceHash});assert.throws(()=>publish(state,priv),/sum/);assert.equal(fs.readFileSync(path.join(priv,'budget-sync/current.json'),'utf8'),pointer);
  assert.throws(()=>validateCandidate({...candidate(),checkedAt:'2020-01-01'}),/metadata/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
