import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanPreferences,readPreferences,savePreferences,defaults,PREFERENCES_KEY,linkedStation,stationLink,gaugeStatus,floodFeedState,findStations,warningPeriod,filterWeather,warningBounds} from '../src/ui-model.mjs';
const now=Date.parse('2026-10-26T12:00:00Z');
const reading={value:0,dateTime:'2026-10-26T11:45:00Z'};

test('missing ranges, invalid observations and stale readings never receive a healthy status',()=>{
 assert.equal(gaugeStatus({reading,threshold:null,now}).label,'Range unavailable');
 assert.equal(gaugeStatus({reading:null,threshold:1,now}).label,'Reading unavailable');
 assert.equal(gaugeStatus({reading:{...reading,dateTime:'2026-10-26T09:00:00Z'},threshold:1,now}).label,'Reading delayed');
 assert.equal(gaugeStatus({reading:{...reading,dateTime:'not-a-date'},threshold:1,now}).tone,'unknown');
 assert.equal(gaugeStatus({reading,threshold:1,now}).label,'Within typical range');
 assert.equal(gaugeStatus({reading:{...reading,value:2},threshold:1,now}).tone,'elevated');
 assert.equal(gaugeStatus({reading:null,warning:{severity:'Flood Warning',severityLevel:2},now}).tone,'critical');
});
test('an unavailable flood feed cannot be described as no warnings',()=>{
 assert.equal(floodFeedState('ok',0).title,'No active flood warnings');
 assert.equal(floodFeedState('unavailable',0).title,'Flood alert feed unavailable');
 assert.match(floodFeedState('unavailable',2).message,/last received/);
 assert.equal(floodFeedState('loading',0).title,'Loading flood alerts');
 assert.equal(floodFeedState('ok',2),null);
});
test('preferences round-trip with stable zero opacity and favourites, rejecting unsafe values',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 assert(savePreferences(storage,{...defaults,layer:'dark',selectedId:'sepa-9683',favourites:['sepa-9683','sepa-9683'],radarOpacity:0}));
 const restored=readPreferences(storage);assert.equal(restored.layer,'dark');assert.equal(restored.radarOpacity,0);assert.deepEqual(restored.favourites,['sepa-9683']);
 const cleaned=cleanPreferences({layer:'bad',radar:'true',riverOpacity:20,selectedId:'../../secret',favourites:['../../secret',4,'2641']});
 assert.equal(cleaned.layer,'satellite');assert.equal(cleaned.riverOpacity,1);assert.equal(cleaned.selectedId,'');assert.deepEqual(cleaned.favourites,['2641']);
 storage.setItem(PREFERENCES_KEY,'bad-json');assert.equal(readPreferences(storage).layer,'satellite');
 assert.equal(savePreferences({setItem(){throw Error('blocked')}},defaults),false);
 assert.equal(readPreferences({getItem(){throw Error('blocked')}}).layer,'satellite');
});
test('gauge links preserve unrelated query fields and validate IDs',()=>{
 const url=stationLink('https://riverwatch.halfagiraf.com/?other=keep#old','sepa-9683');
 assert.equal(linkedStation(url),'sepa-9683');assert.equal(new URL(url).searchParams.get('other'),'keep');assert.equal(new URL(url).hash,'');
 assert.equal(linkedStation('https://example.com/?station=../../private'),null);
 assert.throws(()=>stationLink('https://example.com/','../secret'));
});
test('station search matches all words and includes Scotland and station IDs',()=>{
 const stations=[{stationReference:'sepa-9683',label:'Galashiels',town:'Scotland',riverName:'Gala Water'},{stationReference:'2641',label:'Test Bridge',town:'York',riverName:'Ouse'}];
 assert.equal(findStations(stations,'gala scotland')[0],stations[0]);assert.equal(findStations(stations,'9683')[0],stations[0]);
 assert.equal(findStations(stations,'Gala York').length,0);assert.equal(findStations(stations,'').length,2);
});
test('weather filters handle validity boundaries, expiration and unknown RSS timing',()=>{
 const warnings=[{id:'active',level:'yellow',validFrom:'2026-10-26T12:00:00Z',validTo:'2026-10-26T13:00:00Z'},{id:'upcoming',level:'amber',validFrom:'2026-10-26T13:00:00Z',validTo:'2026-10-26T14:00:00Z'},{id:'expired',level:'red',validFrom:'2026-10-26T10:00:00Z',validTo:'2026-10-26T12:00:00Z'},{id:'rss',level:'yellow'}];
 assert.equal(warningPeriod(warnings[0],now),'active');assert.equal(warningPeriod(warnings[2],now),'expired');assert.equal(warningPeriod(warnings[3],now),'unknown');
 assert.deepEqual(filterWeather(warnings,'active',now).map(w=>w.id),['active']);assert.deepEqual(filterWeather(warnings,'upcoming',now).map(w=>w.id),['upcoming']);
 assert.equal(filterWeather(warnings,'all',now).length,3);
});
test('warning map bounds cover multipolygons and ignore invalid coordinates',()=>{
 assert.deepEqual(warningBounds({geometry:{type:'MultiPolygon',coordinates:[[[[-4,56],[-2,58],[-3,57]]],[[[-5,55],[-4,54],[999,1000]]]]}}),[[54,-5],[58,-2]]);
 assert.equal(warningBounds({}),null);assert.equal(warningBounds({geometry:{type:'Polygon',coordinates:[]}}),null);
});
