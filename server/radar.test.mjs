import test from 'node:test';
import assert from 'node:assert/strict';
import { createRadarFeed, normalizeRadar } from './radar.mjs';
import { RadarPlayback } from '../src/radar-playback.mjs';

const frames = Array.from({length:13},(_,i)=>({path:`/v2/radar/frame${i}`,time:1000+i*600}));
const payload = {host:'https://tilecache.rainviewer.com',radar:{past:frames}};
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
  const created=[], states=[];
  const player=new RadarPlayback((url,events)=>{
    const layer={url,events,opacity:0,removed:false,add(){},setOpacity(n){this.opacity=n},remove(){this.removed=true}};
    created.push(layer);return layer;
  },state=>states.push(state));
  const update=(index,playing=false,opacity=.72)=>player.update({frames,index,playing,opacity,host:payload.host});
  return {player,created,states,update};
}
test('paused startup downloads only the latest grid, not thirteen invisible frames',()=>{
  const {player,created,update}=setup();update(12);
  assert.equal(created.length,1);assert(created[0].url.includes('frame12'));
  assert.equal(created[0].opacity,.72);created[0].events.load();
  assert.equal(player.displayed,frames[12].path);assert.equal(created.length,1);
});
test('playback preloads one frame and retains the visible image until its replacement loads',()=>{
  const {player,created,states,update}=setup();update(12,true);
  assert.equal(created.length,1);created[0].events.load();assert.equal(created.length,2);
  assert(created[1].url.includes('frame0'));assert.equal(created[1].opacity,0);
  update(0,true);assert.equal(player.displayed,frames[12].path);assert.equal(created[0].removed,false);
  created[1].events.load();assert.equal(player.displayed,frames[0].path);
  assert.equal(created[0].removed,true);assert.equal(player.layers.size,2);
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
