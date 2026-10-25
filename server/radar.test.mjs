import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createRadarFeed, normalizeRadar } from './radar.mjs';
import { RadarPlayback } from '../src/radar-playback.mjs';

const frames = Array.from({length:13},(_,i)=>({path:`/v2/radar/frame${i}`,time:1000+i*600}));
const payload = {host:'https://tilecache.rainviewer.com',radar:{past:frames}};

test('default crossfade timers retain the browser global receiver on play, cancellation and destroy',async()=>{
  const source=(await readFile(new URL('../src/radar-playback.mjs',import.meta.url),'utf8')).replace('export class RadarPlayback','class RadarPlayback');
  const context=vm.createContext({});
  const result=vm.runInContext(`
    'use strict';
    let scheduled=0, cancelled=0;
    globalThis.setTimeout=function(){if(this!==globalThis)throw new TypeError('Illegal invocation');return ++scheduled};
    globalThis.clearTimeout=function(){if(this!==globalThis)throw new TypeError('Illegal invocation');cancelled++};
    ${source}
    const handlers=[];
    const player=new RadarPlayback((_url,events)=>{handlers.push(events);return {add(){},setOpacity(){},remove(){}}},()=>{});
    const frames=[{path:'/v2/radar/a'},{path:'/v2/radar/b'},{path:'/v2/radar/c'}];
    const update=index=>player.update({frames,index,playing:true,opacity:.72,host:'https://tilecache.rainviewer.com'});
    update(0);handlers[0].load();handlers[1].load();update(1);
    handlers[2].load();update(2);player.destroy();
    ({scheduled,cancelled});
  `,context);
  assert.equal(result.scheduled,2);assert.equal(result.cancelled,2);
});
test('radar manifest accepts hashed paths, validates host and rejects empty feeds',()=>{
  assert.equal(normalizeRadar(payload).frames.length,13);
  assert.throws(()=>normalizeRadar({...payload,host:'https://example.com'}));
  assert.throws(()=>normalizeRadar({...payload,radar:{past:[]}}));
});
test('radar requests share the independent cache and errors are retryable',async()=>{
  let calls=0;
  const feed=createRadarFeed(async()=>{calls++;return {ok:true,json:async()=>payload}});
  await Promise.all([feed(),feed()]);await feed();assert.equal(calls,1);
  let fail=true;const retry=createRadarFeed(async()=>({ok:!fail,json:async()=>payload}));
  await assert.rejects(retry());fail=false;assert.equal((await retry()).frames.length,13);
});

function setup() {
  const created=[], states=[], timers=new Map();let timerId=0;
  const player=new RadarPlayback((url,events)=>{
    const layer={url,events,opacity:0,removed:false,add(){},setOpacity(n){this.opacity=n},remove(){this.removed=true}};
    created.push(layer);return layer;
  },state=>states.push(state),{setTimer:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId},clearTimer:id=>timers.delete(id)});
  const update=(index,playing=false,opacity=.72)=>player.update({frames,index,playing,opacity,host:payload.host});
  const finishFade=()=>{for(const [id,{fn}] of [...timers]){timers.delete(id);fn()}};
  return {player,created,states,update,timers,finishFade};
}
test('paused startup downloads only the latest grid, not thirteen invisible frames',()=>{
  const {player,created,update}=setup();update(12);
  assert.equal(created.length,1);assert(created[0].url.includes('frame12'));
  assert.equal(created[0].opacity,.72);created[0].events.load();
  assert.equal(player.displayed,frames[12].path);assert.equal(created.length,1);
});
test('playback retains the outgoing image until the crossfade finishes',()=>{
  const {player,created,states,update,timers,finishFade}=setup();update(12,true);
  assert.equal(created.length,1);created[0].events.load();assert.equal(created.length,2);
  assert(created[1].url.includes('frame0'));assert.equal(created[1].opacity,0);
  update(0,true);assert.equal(player.displayed,frames[12].path);assert.equal(created[0].removed,false);
  created[1].events.load();assert.equal(player.displayed,frames[0].path);
  assert.equal(created[0].removed,false);assert.equal(player.layers.size,3);
  assert.equal(created[0].opacity,0);assert.equal(created[1].opacity,.72);
  assert.equal([...timers.values()][0].ms,450);
  finishFade();assert.equal(created[0].removed,true);assert.equal(player.layers.size,2);
  assert.equal(states.at(-1).status,'ready');
});
test('opacity changes reuse preload, scrubbing remains bounded and late events are detached',()=>{
  const {player,created,update}=setup();update(12,true);created[0].events.load();update(12,true,.5);
  assert.equal(created.length,2);assert.equal(created[0].opacity,.5);
  for(let i=1;i<10;i++){update(i,true);assert(player.layers.size<=2)}
  player.destroy();assert.equal(player.layers.size,0);assert(created.every(l=>l.removed));
});
test('failed replacement tiles cannot relabel an old image as the new frame',()=>{
  const {player,created,states,update}=setup();update(12);created[0].events.load();update(0);
  created[1].events.tileerror();created[1].events.load();
  assert.equal(player.displayed,frames[12].path);assert.equal(states.at(-1).status,'error');
  assert.equal(states.at(-1).path,frames[12].path);
});

test('rapid frame changes cancel old fades, keep at most one outgoing grid and clean up timers',()=>{
  const {player,created,update,timers,finishFade}=setup();
  update(12,true);created[0].events.load();created[1].events.load();update(0,true);
  assert.equal(player.fading,frames[12].path);
  const next=created.find(l=>l.url.includes('frame1/'));next.events.load();update(1,true);
  assert.equal(player.fading,frames[0].path);assert.equal(created[0].removed,true);
  assert.equal(player.layers.size,3);assert.equal(timers.size,1);
  finishFade();assert.equal(player.layers.size,2);
  const following=created.find(l=>l.url.includes('frame2/'));following.events.load();update(2,true);
  assert.equal(timers.size,1);player.destroy();assert.equal(timers.size,0);
  assert(created.every(l=>l.removed));
});

test('scrubbing back during a crossfade reuses the outgoing frame',()=>{
  const {player,created,update,finishFade}=setup();update(12);created[0].events.load();
  update(0);created[1].events.load();update(12);
  assert.equal(created.length,2);assert.equal(player.displayed,frames[12].path);
  assert.equal(created[0].removed,false);assert.equal(player.fading,frames[0].path);
  finishFade();assert.equal(created[1].removed,true);assert.equal(player.layers.size,1);
});
