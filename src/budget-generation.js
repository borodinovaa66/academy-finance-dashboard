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
function syncStatus(privateDir){
 const file=path.join(privateDir,'budget-sync-status.json');
 if(!fs.existsSync(file))return {state:'not_configured'};
 const s=JSON.parse(fs.readFileSync(file,'utf8'));
 return {state:s.state,checkedAt:s.checkedAt,lastSuccessAt:s.lastSuccessAt,publishedAt:s.publishedAt,sourceHash:s.sourceHash,errorCode:s.errorCode,intervalSeconds:120};
}
module.exports={generationFile,syncStatus};
