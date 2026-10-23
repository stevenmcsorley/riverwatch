import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 3001);
const EA = 'https://environment.data.gov.uk/flood-monitoring';
const REFRESH_MS = 5 * 60 * 1000;
let snapshot = null;
let pendingRefresh = null;
let rainfallStations = [];
const riverCache = new Map();
const alertShapeCache = new Map();
const gaugeDetailCache = new Map();

async function json(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`${response.status} from ${new URL(url).host}`);
  return response.json();
}
const idFor = s => String(s.stationReference || s.notation || s['@id']?.split('/').pop() || '');
const measureFor = m => m?.['@id'] || '';
function nearestStation(w, stations) {
  if (!Number.isFinite(Number(w.lat)) || !Number.isFinite(Number(w.long))) return null;
  const rad = d => d * Math.PI / 180;
  let best = null, bestKm = Infinity;
  for (const s of stations) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.long)) continue;
    const dLat = rad(s.lat - w.lat), dLon = rad(s.long - w.long);
    const a = Math.sin(dLat/2)**2 + Math.cos(rad(w.lat))*Math.cos(rad(s.lat))*Math.sin(dLon/2)**2;
    const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    if (km < bestKm) { bestKm = km; best = s; }
  }
  return best && { id: idFor(best), distanceKm: Math.round(bestKm * 10) / 10 };
}

async function refreshFeeds() {
  if (pendingRefresh) return pendingRefresh;
  pendingRefresh = (async () => {
    let floodWarningsAvailable = true;
    const [stationData, readingData, floodData, radarData, rainfallStationData, rainfallReadingData] = await Promise.all([
      json(`${EA}/id/stations?parameter=level&_limit=2500`),
      json(`${EA}/data/readings?latest&parameter=level&_limit=2500`),
      json(`${EA}/id/floods`).catch(() => { floodWarningsAvailable = false; return { items: [] }; }),
      json('https://api.rainviewer.com/public/weather-maps.json').catch(() => null),
      json(`${EA}/id/stations?parameter=rainfall&_limit=1500`).catch(() => null),
      json(`${EA}/data/readings?latest&parameter=rainfall&_limit=1500`).catch(() => null),
    ]);
    const readingsByMeasure = new Map((readingData.items || []).map(r => [r.measure, r]));
    const stationRows = (stationData.items || []).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.long)).map(s => {
      const measures = (s.measures || []).filter(m => m.parameter === 'level');
      const m = measures.find(x => /stage/i.test(x.qualifier || '')) || measures[0];
      const r = readingsByMeasure.get(measureFor(m));
      return {
        stationReference: idFor(s), notation: s.notation, label: s.label, riverName: s.riverName || '',
        town: s.town || '', catchmentName: s.catchmentName || '', lat: s.lat, long: s.long,
        stageScale: s.stageScale || null,
        levelMeasure: m ? { '@id': measureFor(m), parameter: m.parameter, qualifier: m.qualifier || '', unitName: m.unitName || 'm' } : null,
        reading: r && Number.isFinite(Number(r.value)) ? { value: Number(r.value), dateTime: r.dateTime } : null,
      };
    }).filter(s => s.levelMeasure);
    const uniqueStations = new Map();
    for (const s of stationRows) if (!uniqueStations.has(s.stationReference) || (!uniqueStations.get(s.stationReference).reading && s.reading)) uniqueStations.set(s.stationReference, s);
    const stations = [...uniqueStations.values()];
    const rainReadingsByMeasure = new Map((rainfallReadingData?.items || []).map(r => [r.measure, r]));
    rainfallStations = (rainfallStationData?.items || []).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.long)).flatMap(s => {
      const m = (s.measures || []).find(x => x.parameter === 'rainfall');
      if (!m) return [];
      const reading = rainReadingsByMeasure.get(measureFor(m));
      return [{ stationReference: idFor(s), label: s.label || s.riverName || 'Rainfall gauge', lat: s.lat, long: s.long,
        measure: measureFor(m), unitName: m.unitName || 'mm', periodSeconds: Number(m.period) || null,
        reading: reading && Number.isFinite(Number(reading.value)) ? { value: Number(reading.value), dateTime: reading.dateTime } : null }];
    });
    const activeWarnings = (floodData.items || []).filter(w => Number(w.severityLevel) <= 3);
    const decorated = await Promise.all(activeWarnings.map(async w => {
      let area = w.floodArea || {};
      const notation = area.notation || w.floodAreaID;
      if ((!Number.isFinite(Number(area.lat)) || !Number.isFinite(Number(area.long))) && notation) {
        try { area = (await json(`${EA}/id/floodAreas/${encodeURIComponent(notation)}`)).items || area; } catch {}
      }
      const row = { ...w, floodArea: { notation, county: area.county || w.floodArea?.county || '', riverOrSea: area.riverOrSea || '', lat: Number(area.lat), long: Number(area.long) }, lat: Number(area.lat), long: Number(area.long) };
      const nearest = nearestStation(row, stations);
      row.nearestStationId = nearest?.id || null;
      row.nearestStationDistanceKm = nearest?.distanceKm ?? null;
      return row;
    }));
    decorated.sort((a,b) => Number(a.severityLevel)-Number(b.severityLevel) || new Date(b.timeRaised || 0)-new Date(a.timeRaised || 0));
    snapshot = {
      type: 'snapshot', generatedAt: new Date().toISOString(), stations,
      warnings: decorated, radarFrames: radarData?.radar?.past || [],
      providers: { environmentAgency: 'ok', floodWarnings: floodWarningsAvailable ? 'ok' : 'unavailable', radar: radarData ? 'ok' : 'unavailable', rainfall: rainfallStationData && rainfallReadingData ? 'ok' : 'unavailable' },
    };
    broadcast(snapshot);
    return snapshot;
  })().catch(error => {
    broadcast({ type: 'feed_error', message: `Live feed update failed: ${error.message}`, generatedAt: new Date().toISOString() });
    throw error;
  }).finally(() => { pendingRefresh = null; });
  return pendingRefresh;
}

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: true, maxPayload: 1024 * 1024 });
function broadcast(data) {
  const encoded = JSON.stringify(data);
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(encoded);
}
wss.on('connection', async ws => {
  ws.send(JSON.stringify({ type: 'connection', status: 'connected' }));
  if (snapshot) ws.send(JSON.stringify(snapshot));
  else try { const value = await (pendingRefresh || refreshFeeds()); if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); } catch {}
  ws.on('message', async raw => {
    let message; try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type === 'refresh') {
      try { await refreshFeeds(); } catch {}
    }
  });
});

async function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  res.end(body);
}

const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/health') return sendJson(res, { status: 'ok', websocket: '/ws', updatedAt: snapshot?.generatedAt || null });
  if (url.pathname.startsWith('/api/station/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/station/'.length));
    if (!/^[\w-]{1,32}$/.test(id)) return sendJson(res, { error: 'Invalid station id' }, 400);
    if (!snapshot) return sendJson(res, { error: 'Live readings are not available yet' }, 503);
    const station = snapshot.stations.find(s => idFor(s) === id);
    if (!station) return sendJson(res, { error: 'Station not found' }, 404);
    const cached = gaugeDetailCache.get(id);
    if (cached && cached.expires > Date.now()) return sendJson(res, cached.data);
    try {
      const [history, scale] = await Promise.all([
        json(`${station.levelMeasure['@id']}/readings?today&_sorted`),
        station.stageScale ? json(station.stageScale) : Promise.resolve(null),
      ]);
      const items = (history.items || []).filter(r => Number.isFinite(Number(r.value))).map(r => ({ dateTime: r.dateTime, value: Number(r.value) })).sort((a,b) => new Date(a.dateTime)-new Date(b.dateTime)).slice(-96);
      const typicalRangeHigh = Number(scale?.items?.typicalRangeHigh);
      const rad = d => d * Math.PI / 180;
      let nearestRain = null, nearestKm = Infinity;
      for (const rain of rainfallStations) {
        const dLat = rad(rain.lat - station.lat), dLon = rad(rain.long - station.long);
        const a = Math.sin(dLat/2)**2 + Math.cos(rad(station.lat))*Math.cos(rad(rain.lat))*Math.sin(dLon/2)**2;
        const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        if (km < nearestKm) { nearestKm = km; nearestRain = rain; }
      }
      let rainfall = null;
      if (nearestRain && nearestKm <= 30) {
        try {
          const rainHistory = await json(`${nearestRain.measure}/readings?today&_sorted`);
          const observations = (rainHistory.items || []).filter(r => Number.isFinite(Number(r.value)) && r.dateTime)
            .map(r => ({ dateTime: r.dateTime, value: Number(r.value) })).sort((a,b) => new Date(a.dateTime)-new Date(b.dateTime)).slice(-96);
          rainfall = { station: nearestRain.label, stationReference: nearestRain.stationReference, distanceKm: Math.round(nearestKm*10)/10,
            unitName: nearestRain.unitName, periodSeconds: nearestRain.periodSeconds, observations };
        } catch { /* Rainfall is an optional nearby feed; gauge history remains useful without it. */ }
      }
      const data = { stationId: id, history: items, typicalRangeHigh: Number.isFinite(typicalRangeHigh) ? typicalRangeHigh : null, rainfall };
      gaugeDetailCache.set(id, { data, expires: Date.now() + 5 * 60 * 1000 });
      return sendJson(res, data);
    } catch (error) { return sendJson(res, { error: `Could not read gauge history: ${error.message}` }, 502); }
  }
  if (url.pathname === '/api/river') {
    const name = (url.searchParams.get('name') || '').trim();
    if (!name || name.length > 80 || /[^\p{L}\p{N} .,'()\-/]/u.test(name)) return sendJson(res, { error: 'Invalid river name' }, 400);
    const key = name.toLocaleLowerCase('en-GB');
    const cached = riverCache.get(key);
    if (cached && cached.expires > Date.now()) return sendJson(res, cached.data);
    const safeName = name.replaceAll("'", "''");
    const params = new URLSearchParams({
      service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: 'open_rivers:ORN',
      count: '1200', outputFormat: 'application/json', srsName: 'EPSG:4326',
      CQL_FILTER: `name1 ILIKE '%${safeName}%' OR name2 ILIKE '%${safeName}%'`,
    });
    try {
      const data = await json(`https://gis.geodata.soton.ac.uk/geoserver/open_rivers/ows?${params}`);
      riverCache.set(key, { data, expires: Date.now() + 6 * 60 * 60 * 1000 });
      return sendJson(res, data);
    } catch (error) { return sendJson(res, { error: `River line data unavailable: ${error.message}` }, 502); }
  }
  if (url.pathname.startsWith('/api/alert/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/alert/'.length));
    if (!/^[\w-]{1,32}$/.test(id)) return sendJson(res, { error: 'Invalid flood-area id' }, 400);
    const cached = alertShapeCache.get(id);
    if (cached && cached.expires > Date.now()) return sendJson(res, cached.data);
    try {
      const data = await json(`${EA}/id/floodAreas/${encodeURIComponent(id)}/polygon`);
      alertShapeCache.set(id, { data, expires: Date.now() + 60 * 60 * 1000 });
      return sendJson(res, data);
    } catch (error) { return sendJson(res, { error: `Flood-area geometry unavailable: ${error.message}` }, 502); }
  }
  if (url.pathname.startsWith('/api/')) return sendJson(res, { error: 'Unknown API route' }, 404);
  const dist = path.join(root, 'dist');
  let file = path.join(dist, path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, ''));
  if (!file.startsWith(`${dist}${path.sep}`) && file !== path.join(dist, 'index.html')) return sendJson(res, { error: 'Invalid path' }, 400);
  try { if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html'); }
  catch { file = path.join(dist, 'index.html'); }
  try {
    const bytes = await readFile(file);
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'content-length': bytes.length }); res.end(bytes);
  } catch { res.writeHead(404); res.end('Build the app first with npm run build.'); }
});

server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
server.listen(port, '0.0.0.0', () => console.log(`RiverWatch data/WebSocket server listening on http://localhost:${port}`));
refreshFeeds().catch(() => {});
const poller = setInterval(() => refreshFeeds().catch(() => {}), REFRESH_MS);
poller.unref();
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { clearInterval(poller); wss.close(); server.close(() => process.exit(0)); });
