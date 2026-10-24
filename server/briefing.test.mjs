import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {BriefingService,buildFacts,validateSelection} from './briefing.mjs';
const initial=Date.parse('2026-10-24T12:00:00Z');
const snapshot=(now=initial,revision='1')=>({generatedAt:new Date(now).toISOString(),stations:[{stationReference:'s',label:'Test gauge',reading:{value:1,dateTime:new Date(now).toISOString()}}],warnings:[],weatherWarnings:[{id:'w',revision,title:'Amber warning of wind',region:'Scotland',level:'amber',validFrom:'2026-10-24T11:00:00Z',validTo:'2026-10-25T12:00:00Z'}],providers:{floodWarnings:'ok',weatherWarnings:'ok'}});
async function setup(request,now=()=>initial){const dir=await mkdtemp(path.join(os.tmpdir(),'riverwatch-briefing-'));const statePath=path.join(dir,'state.json');return new BriefingService({key:'test-only',statePath,request,now})}
const success=()=>({ok:true,json:async()=>({model:'test:free',choices:[{message:{content:'{"factIds":["weather-w","network"]}'}}]})});
test('rejects invented facts and omission of priority official warning',()=>{
 const {facts}=buildFacts(snapshot(),[],initial);
 assert.throws(()=>validateSelection('{"factIds":["invented"]}',facts));
 assert.throws(()=>validateSelection('{"factIds":["network"]}',facts));
 assert.deepEqual(validateSelection('{"factIds":["weather-w"]}',facts),['weather-w']);
});
test('only fresh successive observations produce a rising-level fact',()=>{
 const old=snapshot(initial-15*60000).stations;old[0].reading.value=.9;
 const {facts}=buildFacts(snapshot(),old,initial);
 assert(facts.some(f=>f.id==='rise-s'&&f.text.includes('0.10 m')));
 assert(!buildFacts(snapshot(),snapshot().stations,initial).facts.some(f=>f.id==='rise-s'));
});
test('shared calls, cooldown, restart persistence and changed-warning invalidation',async()=>{
 let now=initial,calls=0;
 const request=async(_url,options)=>{calls++;const body=JSON.parse(options.body);assert(body.model.endsWith(':free'));assert.equal(body.provider.max_price.prompt,0);assert.equal(body.provider.allow_fallbacks,false);return success()};
 const service=await setup(request,()=>now);
 await Promise.all([service.update(snapshot()),service.update(snapshot())]);assert.equal(calls,1);assert.equal(service.current().mode,'ai');
 now+=5*60000;await service.update(snapshot(now,'2'));assert.equal(calls,1);assert.equal(service.current().mode,'rules');
 const restarted=new BriefingService({key:'test',statePath:service.statePath,request,now:()=>now});await restarted.update(snapshot(now,'2'));assert.equal(calls,1);
 now+=30*60000;await restarted.update(snapshot(now,'2'));assert.equal(calls,2);assert.equal(restarted.current().mode,'ai');
 now+=16*60000;assert.equal(restarted.current().mode,'waiting');
});
test('daily cap is enforced and failures count against the allowance',async()=>{
 let calls=0;const service=await setup(async()=>{calls++;return {ok:false}});
 await service.ready;service.state={day:'2026-10-24',attempts:24,lastAttempt:initial-3600000};await service.save();await service.update(snapshot());assert.equal(calls,0);
 const failed=await setup(async()=>{calls++;return {ok:false}});await failed.update(snapshot());assert.equal(failed.state.attempts,1);assert.equal(failed.current().mode,'rules');await failed.update(snapshot());assert.equal(calls,1);
});
test('missing key, paid model and corrupt persisted state never trigger paid/provider calls',async()=>{
 assert.throws(()=>new BriefingService({key:'x',model:'paid-model',statePath:'/tmp/unused'}));
 let calls=0;const service=await setup(async()=>{calls++;return success()});await service.ready;await writeFile(service.statePath,'broken');
 const restarted=new BriefingService({key:'x',statePath:service.statePath,request:async()=>{calls++},now:()=>initial});await restarted.update(snapshot());assert.equal(calls,0);assert.equal(restarted.current().mode,'rules');
 const disabled=await setup(async()=>{calls++});disabled.key=null;await disabled.update(snapshot());assert.equal(calls,0);
});
