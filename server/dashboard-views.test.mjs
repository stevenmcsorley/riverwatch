import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {defaults} from '../src/ui-model.mjs';

test('rendered alert, preference and favourite views distinguish real data states',async t=>{
 const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
 t.after(()=>server.close());
 const {FloodAlerts,WeatherAlerts,PreferencesView,StationList}=await server.ssrLoadModule('/src/DashboardViews.jsx');
 const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
 const unavailable=render(FloodAlerts,{warnings:[],status:'unavailable',onSelect(){}});
 assert.match(unavailable,/Flood alert feed unavailable/);assert.doesNotMatch(unavailable,/No active flood warnings/);
 const empty=render(FloodAlerts,{warnings:[],status:'ok',onSelect(){}});assert.match(empty,/No active flood warnings/);
 const retained=render(FloodAlerts,{warnings:[{'@id':'id',description:'Old warning',severityLevel:2}],status:'unavailable',onSelect(){}});
 assert.match(retained,/last received alerts/);assert.match(retained,/Old warning/);
 const weather=render(WeatherAlerts,{warnings:[],status:'unavailable',filter:'all',onFilter(){},onSelect(){},now:Date.now()});
 assert.match(weather,/Weather warning feed unavailable/);assert.doesNotMatch(weather,/No weather warnings in the latest feed/);
 const prefs=render(PreferencesView,{values:{...defaults,layer:'dark'},onChange(){},onReset(){},storageAvailable:false});
 assert.match(prefs,/Browser storage is unavailable/);assert.match(prefs,/<option value="dark" selected="">/);
 const favourites=render(StationList,{stations:[],measurements:{},favourites:[],onToggleFavourite(){},onSelect(){},query:'',onlyFavourites:true});
 assert.match(favourites,/No favourite gauges yet/);
});
