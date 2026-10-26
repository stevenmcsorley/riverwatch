import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Copy, Search, Star, X } from 'lucide-react';
import { filterWeather, floodFeedState, readingAge, stationId, warningBounds, warningPeriod } from './ui-model.mjs';

const stamp = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : 'Not supplied';
export function ObservationAge({reading,now=Date.now()}) {
  const minutes=readingAge(reading,now);
  return <span className={`observation-age ${minutes===null?'missing':minutes>60?'delayed':'fresh'}`} title={reading?.dateTime?`Observation: ${stamp(reading.dateTime)}`:'No usable observation supplied'}>{minutes===null?'No reading':minutes<1?'Observed just now':minutes<60?`Observed ${Math.floor(minutes)} min ago`:`Observed ${Math.floor(minutes/60)}h ${Math.floor(minutes%60)}m ago`}</span>;
}

export function StationSearch({query,onQuery,results,favourites,onSelect,onViewAll,now}) {
  const [open,setOpen]=useState(false),[index,setIndex]=useState(0),id=useId();
  const input=useRef(null),shown=query.trim()?results.slice(0,8):favourites.slice(0,8);
  useEffect(()=>setIndex(0),[query]);
  useEffect(()=>{
    const key=event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();input.current?.focus();setOpen(true)}};
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[]);
  const choose=station=>{onSelect(station);onQuery('');setOpen(false)};
  return <div className="station-search" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false)}}>
    <div className="searchbox"><Search size={17}/><input ref={input} aria-label="Search rivers, stations or places" role="combobox" aria-expanded={open} aria-controls={id} aria-autocomplete="list" aria-activedescendant={open&&shown[index]?`${id}-${index}`:undefined} value={query} onFocus={()=>setOpen(true)} onChange={event=>{onQuery(event.target.value);setOpen(true)}} placeholder="Find a river or gauge…" onKeyDown={event=>{
      if(event.key==='ArrowDown'){event.preventDefault();setOpen(true);setIndex(i=>Math.max(0,Math.min(i+1,shown.length-1)))}
      if(event.key==='ArrowUp'){event.preventDefault();setIndex(i=>Math.max(0,i-1))}
      if(event.key==='Enter'&&open&&shown.length){event.preventDefault();choose(shown[Math.max(0,index)]||shown[0])}
      if(event.key==='Escape'){event.preventDefault();setOpen(false)}
    }}/>{query?<button type="button" aria-label="Clear station search" onClick={()=>{onQuery('');input.current?.focus()}}><X size={13}/></button>:<kbd>Ctrl K</kbd>}</div>
    {open&&<div className="search-results"><div className="search-results-heading">{query.trim()?`${results.length} matching gauges`:'Favourite gauges'}</div><div role="listbox" id={id} aria-label="Matching gauges">
      {shown.map((station,i)=><button type="button" role="option" aria-selected={i===index} id={`${id}-${i}`} key={stationId(station)} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(station)}><strong>{station.label}</strong><span>{station.riverName||station.catchmentName||'River gauge'} · {station.town||station.country||'England'} · {station.provider||'Environment Agency'}</span><ObservationAge reading={station.reading} now={now}/></button>)}
    </div>{!shown.length&&<p>{query.trim()?'No matching gauges. Try a river, place or station ID.':'Search by station, river or place. Star a gauge to keep it here.'}</p>}{query.trim()&&results.length>8&&<button className="search-view-all" onMouseDown={event=>event.preventDefault()} onClick={()=>{setOpen(false);onViewAll()}}>View all {results.length} results <ChevronRight size={13}/></button>}</div>}
  </div>;
}

export function StationList({stations,measurements,favourites,onToggleFavourite,onSelect,query,onlyFavourites=false,loading=false,now,missingCount=0}) {
  const [page,setPage]=useState(0),size=75;
  useEffect(()=>setPage(0),[query,onlyFavourites]);
  const last=Math.max(0,Math.ceil(stations.length/size)-1),current=Math.min(page,last),rows=stations.slice(current*size,(current+1)*size);
  return <section className="list-panel panel station-browser"><div className="panel-heading"><div><span className="eyebrow">{onlyFavourites?'YOUR RIVERS':'MONITORING NETWORK'}</span><h2>{onlyFavourites?'Favourite gauges':'River gauges'}</h2><p className="subtle">{stations.length} {query?'matching ':''}{stations.length===1?'gauge':'gauges'} · Select a row to open it on the map.</p></div></div>
    {missingCount>0&&<p className="feed-notice">{missingCount} saved {missingCount===1?'gauge is':'gauges are'} not in the current feed. Your favourites have been kept.</p>}
    {!rows.length?<div className="empty-state"><Star size={24}/><h3>{loading?'Loading gauges…':query?'No matching gauges':onlyFavourites?'No favourite gauges yet':'No gauges available'}</h3><p>{onlyFavourites?'Star a gauge on the map or in Stations to find it quickly next time.':'Try another station name, river or place.'}</p></div>:<div className="station-results-list"><div className="station-results-labels"><span>STATION / RIVER</span><span>LOCATION</span><span>LEVEL</span><span>OBSERVATION</span><span className="sr-only">Favourite</span></div>{rows.map(station=>{
      const id=stationId(station),reading=measurements[id],saved=favourites.includes(id);
      return <div className="station-result-row" key={id}><button className="station-open" onClick={()=>onSelect(station)}><span><b>{station.label}</b><small>{station.riverName||station.catchmentName||id}</small></span><span>{station.town||station.country||'England'}<small>{station.provider||'Environment Agency'}</small></span><strong>{reading?`${reading.value.toFixed(2)} ${station.levelMeasure?.unitName||'m'}`:'—'}</strong><ObservationAge reading={reading} now={now}/></button><button className={`favourite-button ${saved?'saved':''}`} aria-label={`${saved?'Remove':'Add'} ${station.label} ${saved?'from':'to'} favourites`} aria-pressed={saved} onClick={()=>onToggleFavourite(id)}><Star size={17} fill={saved?'currentColor':'none'}/></button></div>;
    })}</div>}
    {stations.length>size&&<nav className="station-pagination" aria-label="Station result pages"><span>{current*size+1}–{Math.min((current+1)*size,stations.length)} of {stations.length}</span><button disabled={!current} onClick={()=>setPage(current-1)} aria-label="Previous station page"><ChevronLeft size={16}/> Previous</button><button disabled={current>=last} onClick={()=>setPage(current+1)} aria-label="Next station page">Next <ChevronRight size={16}/></button></nav>}
  </section>;
}

export function PreferencesView({values,onChange,onReset,storageAvailable}) {
  return <section className="list-panel panel preferences-page"><div className="panel-heading"><div><span className="eyebrow">MAKE IT YOURS</span><h2>Preferences</h2><p>Display settings, your selected gauge and favourites are saved on this browser.</p></div></div><p role="status" className={storageAvailable?'subtle':'feed-notice'}>{storageAvailable?'Changes save automatically.':'Browser storage is unavailable. Settings work for this visit but will not persist.'}</p>
    <fieldset><legend>Map appearance</legend><label className="preference-select">Basemap<select value={values.layer} onChange={event=>onChange('layer',event.target.value)}><option value="satellite">Satellite</option><option value="dark">Dark</option><option value="terrain">Terrain</option></select></label>{[['radar','Rainfall radar'],['satellite','Satellite clouds'],['showGaugeMarkers','Gauge markers'],['showWeatherWarnings','Weather warning areas']].map(([key,label])=><label className="preference-toggle" key={key}><span>{label}</span><input type="checkbox" checked={values[key]} onChange={event=>onChange(key,event.target.checked)}/></label>)}</fieldset>
    <fieldset><legend>Layer opacity</legend>{[['radarOpacity','Radar opacity'],['satelliteOpacity','Cloud opacity'],['riverOpacity','River network opacity']].map(([key,label])=><label className="preference-range" key={key}><span>{label}</span><b>{Math.round(values[key]*100)}%</b><input aria-label={label} type="range" min="0" max="100" step="1" value={Math.round(values[key]*100)} onChange={event=>onChange(key,Number(event.target.value)/100)}/></label>)}</fieldset>
    <p className="subtle">Preferences stay on this device. A shared gauge link opens the same station for someone else without changing their saved layers or favourites.</p><button className="outline-button" onClick={onReset}>Reset display settings</button><p className="subtle">Resetting display settings keeps your selected gauge and favourites.</p>
  </section>;
}

export function FloodAlerts({warnings,status,onSelect,updatedAt}) {
  const state=floodFeedState(status,warnings.length);
  return <section className="list-panel panel"><div className="panel-heading"><div><span className="eyebrow">ENVIRONMENT AGENCY</span><h2>Flood warnings &amp; alerts</h2><p>England alert feed. <a href="https://beta.sepa.scot/flooding/" target="_blank" rel="noreferrer">Check SEPA for Scottish alerts ↗</a></p></div><span className="subtle">{updatedAt?`Last received ${stamp(updatedAt)}`:'Awaiting alert data'}</span></div>
    {state&&<div className={status==='ok'?'empty-state':'feed-notice'} role="status"><AlertTriangle size={20}/><h3>{state.title}</h3><p>{state.message}</p><a href="https://check-for-flooding.service.gov.uk/" target="_blank" rel="noreferrer">Check official flood guidance ↗</a></div>}
    {warnings.length>0&&<div className="alerts-grid">{warnings.map((warning,i)=><article className="warning-card" key={warning['@id']||i}><div className="warning-top"><span className={`severity-pill ${Number(warning.severityLevel)<=2?'critical':'elevated'}`}>{warning.severity||'Flood alert'}</span>{status!=='ok'&&<span className="subtle">Last received</span>}</div><h3>{warning.description||warning.floodArea?.riverOrSea||'Flood alert area'}</h3><p>{warning.floodArea?.county||warning.eaAreaName||''}</p><div className="warning-message">{warning.message||'Check the official source for details.'}</div><div className="warning-card-actions"><button className="outline-button" onClick={()=>onSelect(warning)}>Show on map</button><a href="https://check-for-flooding.service.gov.uk/" target="_blank" rel="noreferrer">Official guidance ↗</a></div></article>)}</div>}
  </section>;
}

export function WeatherAlerts({warnings,status,filter,onFilter,onSelect,now}) {
  const visible=filterWeather(warnings,filter,now);
  return <section className="list-panel panel"><div className="panel-heading"><div><span className="eyebrow">MET OFFICE</span><h2>Weather warnings</h2><p>Current and upcoming warnings across the UK, including Scotland.</p></div><a href="https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings" target="_blank" rel="noreferrer">Official warnings ↗</a></div><div className="warning-filters" aria-label="Weather warning period">{[['all','All warnings'],['active','In force'],['upcoming','Upcoming']].map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>onFilter(value)}>{label}</button>)}</div>
    {status!=='ok'?<div className="feed-notice" role="status"><h3>{status==='loading'?'Loading weather warnings…':'Weather warning feed unavailable'}</h3><p>{status==='loading'?'Connecting to the Met Office.':'Coverage cannot be confirmed. Check the official source for current warnings.'}</p></div>:!visible.length?<div className="empty-state"><h3>{filter==='all'?'No weather warnings in the latest feed':`No ${filter==='active'?'in-force':'upcoming'} warnings`}</h3><p>{filter==='all'?'The latest Met Office response contains no current or upcoming warnings.':'Try All warnings to see the other periods.'}</p></div>:<div className="alerts-grid">{visible.map(warning=>{
      const period=warningPeriod(warning,now),hasArea=warningBounds(warning)||(Number.isFinite(warning.lat)&&Number.isFinite(warning.long));
      return <article className={`warning-card weather-card ${warning.level}`} key={warning.id}><div className="warning-top"><span className={`severity-pill weather-${warning.level}`}>{warning.level} warning</span><span className="warning-period">{period==='active'?'In force':period==='upcoming'?'Upcoming':'Check validity'}</span></div><h3>{warning.title}</h3><p>{warning.region}</p><p className="warning-validity">From {stamp(warning.validFrom)}<br/>Until {stamp(warning.validTo)}</p><p>{warning.description}</p>{warning.details&&<details><summary>Full warning details</summary><p>{warning.details}</p></details>}<div className="warning-card-actions"><button className="outline-button" disabled={!hasArea} onClick={()=>onSelect(warning)}>{hasArea?'Show area on map':'Area unavailable'}</button><a href={warning.link} target="_blank" rel="noreferrer">Met Office ↗</a></div></article>;
    })}</div>}
  </section>;
}

export function ShareGauge({url,label,onClose}) {
  const dialog=useRef(null),field=useRef(null),[message,setMessage]=useState('Anyone with this link can open the same gauge.');
  useEffect(()=>{const element=dialog.current;element.showModal();return()=>element.close()},[]);
  return <dialog className="share-dialog" ref={dialog} aria-labelledby="share-gauge-title" onCancel={event=>{event.preventDefault();onClose()}} onClick={event=>{if(event.target===event.currentTarget)onClose()}}><div><header><h2 id="share-gauge-title">Share {label}</h2><button className="icon-button" aria-label="Close share link" onClick={onClose}><X size={18}/></button></header><label>Gauge link<input ref={field} value={url} readOnly onFocus={event=>event.target.select()}/></label><button className="outline-button" onClick={async()=>{try{await navigator.clipboard.writeText(url);setMessage('Link copied.')}catch{field.current?.focus();field.current?.select();setMessage('Select the link and press Ctrl+C, or use your device’s Copy action.')}}}><Copy size={15}/> Copy link</button><p role="status">{message}</p></div></dialog>;
}
