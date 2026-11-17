const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {budgetSchedule,syncStatus}=require('../src/budget-generation');
test('daily Moscow schedule crosses morning, afternoon, weekend and month boundary',()=>{
 for(const [now,previous,next] of [
  ['2026-11-17T05:59:00Z','2026-11-16T13:00:00.000Z','2026-11-17T06:00:00.000Z'],
  ['2026-11-17T06:00:00Z','2026-11-17T06:00:00.000Z','2026-11-17T13:00:00.000Z'],
  ['2026-11-17T12:59:00Z','2026-11-17T06:00:00.000Z','2026-11-17T13:00:00.000Z'],
  ['2026-11-17T13:00:00Z','2026-11-17T13:00:00.000Z','2026-11-18T06:00:00.000Z'],
  ['2026-11-21T14:00:00Z','2026-11-21T13:00:00.000Z','2026-11-22T06:00:00.000Z'],
  ['2026-12-01T00:00:00Z','2026-11-30T13:00:00.000Z','2026-12-01T06:00:00.000Z']
 ]){const s=budgetSchedule(new Date(now));assert.equal(s.lastScheduledAt,previous);assert.equal(s.nextCheckAt,next);}
});
test('normal gap between scheduled checks is healthy; missed run is stale after grace',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'budget-schedule-'));
 try{fs.writeFileSync(path.join(dir,'budget-sync-status.json'),JSON.stringify({state:'ok',lastSuccessAt:'2026-11-17T06:01:00Z'}));
  assert.equal(syncStatus(dir,new Date('2026-11-17T12:59:00Z')).stale,false);
  assert.equal(syncStatus(dir,new Date('2026-11-17T13:05:00Z')).stale,false);
  assert.equal(syncStatus(dir,new Date('2026-11-17T13:11:00Z')).stale,true);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
