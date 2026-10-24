import test from 'node:test';
import assert from 'node:assert/strict';
import {createCache} from './cache.mjs';

test('concurrent requests share one fetch and expiry forces a fresh read', async()=>{
  let time=0,calls=0;
  const cache=createCache({now:()=>time});
  const load=async()=>++calls;
  assert.deepEqual(await Promise.all([cache.get('level',60,load),cache.get('level',60,load)]),[1,1]);
  time=59;assert.equal(await cache.get('level',60,load),1);
  time=60;assert.equal(await cache.get('level',60,load),2);
});
test('failed requests are retried and never cached as successful data',async()=>{
  const cache=createCache();
  await assert.rejects(cache.get('feed',1000,async()=>{throw new Error('offline')}));
  assert.equal(await cache.get('feed',1000,async()=>42),42);
});
test('least recently used data is evicted to bound memory',async()=>{
  const cache=createCache({maxEntries:2});
  await cache.get('a',1000,async()=>1);await cache.get('b',1000,async()=>2);
  assert.equal(cache.peek('a'),1);
  await cache.get('c',1000,async()=>3);
  assert.equal(cache.peek('b'),undefined);assert.equal(cache.peek('a'),1);
});

test('geometry and gauge caches discard expired entries and cap their size',async()=>{
  const {BoundedMap}=await import('./cache.mjs');const cache=new BoundedMap(2);
  cache.set('a',{expires:Date.now()+10000});cache.set('b',{expires:Date.now()+10000});
  cache.get('a');cache.set('c',{expires:Date.now()+10000});assert.equal(cache.has('b'),false);
  cache.set('expired',{expires:0});assert.equal(cache.get('expired'),undefined);assert.equal(cache.has('expired'),false);
});
