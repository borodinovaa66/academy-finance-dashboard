'use strict';
const fs=require('node:fs'),path=require('node:path');
// The publisher switches a validated pair atomically; legacy files remain the
// fallback until the first successful server-side publication.
function generationFile(privateDir,name){
 if(!['budget-explorer.json','cash-plan.json'].includes(name))throw Error('Invalid snapshot name');
 const pointer=path.join(privateDir,'budget-sync/current.json');
 if(!fs.existsSync(pointer))return path.join(privateDir,name);
 const p=JSON.parse(fs.readFileSync(pointer,'utf8'));
 if(!/^[0-9]{13}-[a-f0-9]{16}$/.test(p.generation||''))throw Error('Invalid budget generation');
 const dir=path.join(privateDir,'budget-sync/generations',p.generation),file=path.join(dir,name);
 if(fs.lstatSync(dir).isSymbolicLink()||fs.lstatSync(file).isSymbolicLink())throw Error('Unsafe snapshot path');
 return file;
}
function budgetSchedule(now=new Date()){
 // Moscow is UTC+3; both configured times are daily, including weekends.
 const day=new Date(now.getTime()+3*3600000).toISOString().slice(0,10);
 const morning=Date.parse(day+'T09:00:00+03:00'),afternoon=Date.parse(day+'T16:00:00+03:00'),n=now.getTime();
 const lastScheduledAt=n>=afternoon?afternoon:n>=morning?morning:afternoon-86400000;
 const nextCheckAt=n<morning?morning:n<afternoon?afternoon:morning+86400000;
 return {lastScheduledAt:new Date(lastScheduledAt).toISOString(),nextCheckAt:new Date(nextCheckAt).toISOString(),timeZone:'Europe/Moscow',times:['09:00','16:00']};
}
const syncNote='Сайт автоматически читает источники два раза в сутки: в 09:00 и 16:00 по Москве. При ошибке сохраняется последняя проверенная версия.';
function syncStatus(privateDir,now=new Date()){
 const file=path.join(privateDir,'budget-sync-status.json');
 if(!fs.existsSync(file))return {state:'not_configured'};
 const s=JSON.parse(fs.readFileSync(file,'utf8'));
 const schedule=budgetSchedule(now),lastSuccess=Date.parse(s.lastSuccessAt);
 const stale=!Number.isFinite(lastSuccess)||(lastSuccess<Date.parse(schedule.lastScheduledAt)&&now.getTime()>Date.parse(schedule.lastScheduledAt)+10*60000);
 return {state:s.state,checkedAt:s.checkedAt,lastSuccessAt:s.lastSuccessAt,publishedAt:s.publishedAt,sourceHash:s.sourceHash,errorCode:s.errorCode,intervalSeconds:null,...schedule,stale};
}
module.exports={generationFile,syncStatus,budgetSchedule,syncNote};
