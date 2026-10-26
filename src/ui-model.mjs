export const PREFERENCES_KEY = 'riverwatch.preferences.v1';
export const defaults = Object.freeze({ layer:'satellite',radar:true,satellite:false,showGaugeMarkers:false,showWeatherWarnings:false,radarOpacity:.72,satelliteOpacity:.72,riverOpacity:.4,selectedId:'',favourites:[] });
const stationPattern = /^[\w-]{1,32}$/;
export const stationId = s => String(s.stationReference || s.notation || s['@id']?.split('/').pop() || '');

export function cleanPreferences(value) {
  const p = { ...defaults, favourites:[] };
  if (!value || typeof value !== 'object') return p;
  if (['satellite','dark','terrain'].includes(value.layer)) p.layer=value.layer;
  for (const key of ['radar','satellite','showGaugeMarkers','showWeatherWarnings']) if (typeof value[key]==='boolean') p[key]=value[key];
  for (const key of ['radarOpacity','satelliteOpacity','riverOpacity']) if (typeof value[key]==='number'&&Number.isFinite(value[key])) p[key]=Math.max(0,Math.min(1,value[key]));
  if (typeof value.selectedId==='string'&&stationPattern.test(value.selectedId)) p.selectedId=value.selectedId;
  if (Array.isArray(value.favourites)) p.favourites=[...new Set(value.favourites.filter(id=>typeof id==='string'&&stationPattern.test(id)))].slice(0,200);
  return p;
}
export function readPreferences(storage) {
  try { return cleanPreferences(JSON.parse(storage.getItem(PREFERENCES_KEY))); } catch { return cleanPreferences(null); }
}
export function savePreferences(storage,value) {
  try { storage.setItem(PREFERENCES_KEY,JSON.stringify(cleanPreferences(value)));return true; } catch { return false; }
}
export function linkedStation(href) {
  try { const id=new URL(href).searchParams.get('station');return id&&stationPattern.test(id)?id:null; } catch { return null; }
}
export function stationLink(href,id) {
  if (!stationPattern.test(id)) throw new Error('Invalid station');
  const url=new URL(href);url.searchParams.set('station',id);url.hash='';return url.href;
}
export function readingAge(reading,now=Date.now()) {
  if (!reading||!Number.isFinite(reading.value)||!Number.isFinite(Date.parse(reading.dateTime))) return null;
  const age=(now-Date.parse(reading.dateTime))/60000;return age< -5?null:Math.max(0,age);
}
export function gaugeStatus({reading,threshold,warning,loading=false,now=Date.now()}) {
  const age=readingAge(reading,now),fresh=age!==null&&age<=60;
  if (loading) return {label:'Loading river data',tone:'unknown',fresh:false};
  if (warning) return {label:warning.severity||'Official flood alert',tone:Number(warning.severityLevel)<=2?'critical':'elevated',fresh};
  if (age===null) return {label:'Reading unavailable',tone:'unknown',fresh:false};
  if (!fresh) return {label:'Reading delayed',tone:'unknown',fresh:false};
  if (threshold===null||threshold===undefined||!Number.isFinite(threshold)) return {label:'Range unavailable',tone:'unknown',fresh:true};
  return {label:reading.value>threshold?'Above typical range':'Within typical range',tone:reading.value>threshold?'elevated':'healthy',fresh:true};
}
export function floodFeedState(status,count) {
  if (status==='loading') return {title:'Loading flood alerts',message:'Connecting to the Environment Agency alert feed.',tone:'unknown'};
  if (status!=='ok') return {title:'Flood alert feed unavailable',message:count?'Showing the last received alerts. Their current status cannot be confirmed. Check official guidance.':'Current flood alert coverage cannot be confirmed. Check official guidance.',tone:'unknown'};
  return count?null:{title:'No active flood warnings',message:'The latest Environment Agency feed contains no active alerts or warnings. Scottish alerts are not connected.',tone:'healthy'};
}
export function findStations(stations,query) {
  const terms=query.trim().toLocaleLowerCase('en-GB').split(/\s+/).filter(Boolean);
  if (!terms.length) return stations;
  return stations.filter(s=>{const text=`${s.label} ${s.riverName||''} ${s.town||''} ${s.catchmentName||''} ${s.country||''} ${stationId(s)}`.toLocaleLowerCase('en-GB');return terms.every(term=>text.includes(term));})
    .sort((a,b)=>Number(b.label?.toLowerCase().startsWith(terms[0]))-Number(a.label?.toLowerCase().startsWith(terms[0])));
}
export function warningPeriod(warning,now=Date.now()) {
  const from=Date.parse(warning.validFrom),to=Date.parse(warning.validTo);
  if (Number.isFinite(to)&&to<=now) return 'expired';
  if (Number.isFinite(from)&&from>now) return 'upcoming';
  return Number.isFinite(from)&&Number.isFinite(to)?'active':'unknown';
}
export function filterWeather(warnings,filter='all',now=Date.now()) {
  return warnings.filter(w=>{const period=warningPeriod(w,now);return period!=='expired'&&(filter==='all'||filter===period);})
    .sort((a,b)=>({red:0,amber:1,yellow:2}[a.level]??3)-({red:0,amber:1,yellow:2}[b.level]??3)||Date.parse(a.validFrom)-Date.parse(b.validFrom));
}
export function warningBounds(warning) {
  if (!['Polygon','MultiPolygon'].includes(warning.geometry?.type)) return null;
  const points=[];
  function visit(value) {
    if (!Array.isArray(value)) return;
    if (typeof value[0]==='number'&&typeof value[1]==='number') {if (Number.isFinite(value[0])&&Number.isFinite(value[1])&&Math.abs(value[0])<=180&&Math.abs(value[1])<=90) points.push(value);}
    else value.forEach(visit);
  }
  visit(warning.geometry.coordinates);
  if (!points.length) return null;
  return [[Math.min(...points.map(p=>p[1])),Math.min(...points.map(p=>p[0]))],[Math.max(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0]))]];
}
