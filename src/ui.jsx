import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, GeoJSON, MapContainer, TileLayer, Tooltip, WMSTileLayer, ZoomControl, useMap } from 'react-leaflet';
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bell, ChevronRight, Clock3, CloudRain, Database, Droplets, Gauge, Layers2, Map as MapIcon, Maximize2, Radio, Search, Settings2, Waves, X } from 'lucide-react';
const stationId = (s) => String(s.stationReference || s.notation || s['@id']?.split('/').pop() || '');
const measureId = (m) => m?.['@id'] || '';
const compactNum = (n) => new Intl.NumberFormat('en-GB').format(n || 0);
const ago = (d) => {
  if (!d) return '—';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60000));
  return mins < 1 ? 'Just now' : mins < 60 ? `${mins} min ago` : `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
};
const fmtTime = (d) => d ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(d)) : '—';
function isInsideRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function isInsideFloodArea(point, polygons) {
  return polygons.some(rings => rings.length && isInsideRing(point, rings[0]) && !rings.slice(1).some(ring => isInsideRing(point, ring)));
}

function clipRiverLine(coordinates, center, radiusKm, polygons = []) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
  const kmPerLon = 111.32 * Math.cos(center[1] * Math.PI / 180), kmPerLat = 111.32;
  const xy = coordinate => [(coordinate[0] - center[0]) * kmPerLon, (coordinate[1] - center[1]) * kmPerLat];
  const pointAt = (a, b, t) => a.map((value, index) => value + (b[index] - value) * t);
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const allowed = point => {
    const [x, y] = xy(point);
    return x * x + y * y <= radiusKm * radiusKm || isInsideFloodArea(point, polygons);
  };
  const fragments = [];
  for (let index = 0; index < coordinates.length - 1; index++) {
    const a = coordinates[index], b = coordinates[index + 1], [x, y] = xy(a), [bx, by] = xy(b), dx = bx - x, dy = by - y;
    const quadratic = dx * dx + dy * dy;
    if (!quadratic) continue;
    const parameters = [0, 1], linear = 2 * (x * dx + y * dy), constant = x * x + y * y - radiusKm * radiusKm;
    const discriminant = linear * linear - 4 * quadratic * constant;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      for (const t of [(-linear - root) / (2 * quadratic), (-linear + root) / (2 * quadratic)]) if (t > 0 && t < 1) parameters.push(t);
    }
    const p = [a[0], a[1]], r = [b[0] - a[0], b[1] - a[1]];
    for (const rings of polygons) for (const ring of rings) for (let edge = 0; edge < ring.length - 1; edge++) {
      const c = ring[edge], d = ring[edge + 1], q = [c[0] - p[0], c[1] - p[1]], s = [d[0] - c[0], d[1] - c[1]], denominator = cross(r, s);
      if (Math.abs(denominator) < 1e-12) continue;
      const t = cross(q, s) / denominator, u = cross(q, r) / denominator;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) parameters.push(t);
    }
    parameters.sort((left, right) => left - right);
    const unique = parameters.filter((value, i) => !i || value - parameters[i - 1] > 1e-9);
    for (let part = 0; part < unique.length - 1; part++) {
      const start = unique[part], end = unique[part + 1];
      if (end - start < 1e-9 || !allowed(pointAt(a, b, (start + end) / 2))) continue;
      const segmentStart = pointAt(a, b, start), segmentEnd = pointAt(a, b, end), previous = fragments.at(-1);
      if (previous && Math.abs(previous.at(-1)[0] - segmentStart[0]) < 1e-7 && Math.abs(previous.at(-1)[1] - segmentStart[1]) < 1e-7) previous.push(segmentEnd);
      else fragments.push([segmentStart, segmentEnd]);
    }
  }
  return fragments.filter(fragment => fragment.length > 1);
}

function clipRiverFeatures(collection, center, floodArea, radiusKm = 32) {
  if (!collection?.features || !center) return null;
  const polygons = (floodArea?.features || []).flatMap(feature => feature.geometry?.type === 'Polygon'
    ? [feature.geometry.coordinates]
    : feature.geometry?.type === 'MultiPolygon' ? feature.geometry.coordinates : []);
  const features = [];
  for (const feature of collection.features) {
    const geometry = feature.geometry;
    if (geometry?.type !== 'LineString' && geometry?.type !== 'MultiLineString') continue;
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
    const fragments = lines.flatMap(line => clipRiverLine(line, center, radiusKm, polygons));
    if (!fragments.length) continue;
    const clippedGeometry = fragments.length === 1
      ? { type: 'LineString', coordinates: fragments[0] }
      : { type: 'MultiLineString', coordinates: fragments };
    features.push({ ...feature, geometry: clippedGeometry });
  }
  return { type: 'FeatureCollection', features };
}

function FocusStation({ station }) {
  const map = useMap();
  useEffect(() => { if (station?.lat && station?.long) map.flyTo([station.lat, station.long], station.zoom || Math.max(map.getZoom(), 7), { duration: 1.1 }); }, [station, map]);
  return null;
}

function ResizeMap({ expanded }) {
  const map = useMap();
  useEffect(() => {
    const frame = requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    return () => cancelAnimationFrame(frame);
  }, [expanded, map]);
  return null;
}

function HistoryChart({ points, threshold, unit, rainfall }) {
  const width = 840, height = 172, pad = { l: 44, r: 16, t: 14, b: 25 };
  const valid = points.filter(p => Number.isFinite(p.value));
  if (!valid.length) return <div className="chart-empty"><Activity size={18} /> Waiting for gauge history…</div>;
  const minRaw = Math.min(...valid.map(p => p.value));
  const maxRaw = Math.max(...valid.map(p => p.value));
  const span = Math.max(maxRaw - minRaw, 0.2), min = minRaw - span * .17, max = maxRaw + span * .12;
  const x = (i) => pad.l + i * (width - pad.l - pad.r) / Math.max(valid.length - 1, 1);
  const y = (v) => pad.t + (max - v) * (height - pad.t - pad.b) / (max - min);
  const startMs = new Date(valid[0].dateTime).getTime(), endMs = new Date(valid.at(-1).dateTime).getTime();
  const rainRows = (rainfall?.observations || []).filter(p => Number.isFinite(p.value) && new Date(p.dateTime).getTime() >= startMs && new Date(p.dateTime).getTime() <= endMs);
  const rainPeriod = Number(rainfall?.periodSeconds);
  const rainRates = rainRows.map(p => ({ ...p, rate: rainPeriod > 0 ? p.value * 3600 / rainPeriod : p.value }));
  const rainMax = Math.max(1, ...rainRates.map(p => p.rate));
  const rainBarWidth = Math.max(2, Math.min(11, (width - pad.l - pad.r) / Math.max(rainRates.length, 1) * .62));
  const rainX = p => pad.l + (new Date(p.dateTime).getTime() - startMs) / Math.max(endMs - startMs, 1) * (width - pad.l - pad.r);
  const rainY = p => height - pad.b - p.rate / rainMax * (height - pad.t - pad.b) * .26;
  const path = valid.map((p, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(p.value)}`).join(' ');
  const area = `${path} L ${x(valid.length - 1)} ${height - pad.b} L ${x(0)} ${height - pad.b} Z`;
  const ticks = [0, .25, .5, .75, 1];
  return <svg className="history-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`River level history in ${unit || 'metres'}`}>
    <defs><linearGradient id="waterArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#45a9ff" stopOpacity=".36"/><stop offset="1" stopColor="#1683e1" stopOpacity=".025"/></linearGradient><filter id="lineGlow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    {ticks.map(t => <g key={t}><line x1={pad.l} x2={width-pad.r} y1={pad.t + t*(height-pad.t-pad.b)} y2={pad.t + t*(height-pad.t-pad.b)} className="chart-grid"/><text x={pad.l-9} y={pad.t + t*(height-pad.t-pad.b)+4} textAnchor="end" className="chart-label">{(max-t*(max-min)).toFixed(1)}</text></g>)}
    {Number.isFinite(threshold) && threshold < max && threshold > min && <g><line x1={pad.l} x2={width-pad.r} y1={y(threshold)} y2={y(threshold)} className="threshold-line"/><text x={pad.l+8} y={y(threshold)-6} className="threshold-label">Typical range high · {threshold.toFixed(2)} m</text></g>}
    {Number.isFinite(threshold) && threshold >= max && <text x={width-pad.r} y={pad.t+9} textAnchor="end" className="threshold-label">Typical range high · {threshold.toFixed(2)} m · above scale</text>}
    <path d={area} fill="url(#waterArea)"/>
    {rainRates.map((p,i)=><rect key={`rain-${i}`} x={rainX(p)-rainBarWidth/2} y={rainY(p)} width={rainBarWidth} height={Math.max(0,height-pad.b-rainY(p))} rx="1.5" className="rainfall-bar"><title>{`${p.rate.toFixed(1)} mm/h at ${fmtTime(p.dateTime)} · ${rainfall.station}, ${rainfall.distanceKm} km away`}</title></rect>)}
    {rainRates.length>0&&<g className="rainfall-axis"><text x={width-pad.r+8} y={pad.t+5} textAnchor="end">mm/h</text><text x={width-pad.r+8} y={height-pad.b+3} textAnchor="end">0</text><text x={width-pad.r+8} y={height-pad.b-(height-pad.t-pad.b)*.26+3} textAnchor="end">{rainMax.toFixed(0)}</text></g>}
    <path d={path} className="level-line" filter="url(#lineGlow)"/>
    {valid.length > 0 && <circle cx={x(valid.length-1)} cy={y(valid.at(-1).value)} r="4.5" className="chart-live-dot"/>}
    <text x={pad.l} y={height-5} className="chart-label">{fmtTime(valid[0].dateTime)}</text><text x={width-pad.r} y={height-5} textAnchor="end" className="chart-label">{fmtTime(valid.at(-1).dateTime)}</text>
  </svg>;
}

function App() {
  const [stations, setStations] = useState([]), [warnings, setWarnings] = useState([]), [selectedId, setSelectedId] = useState('2641'), [mapFocus, setMapFocus] = useState(null), [riverShape, setRiverShape] = useState(null), [alertPolygon, setAlertPolygon] = useState(null), [rainfall, setRainfall] = useState(null);
  const [providers, setProviders] = useState({ floodWarnings: 'loading', radar: 'loading', rainfall: 'loading' });
  const [measurements, setMeasurements] = useState({}), [history, setHistory] = useState([]), [rainFrames, setRainFrames] = useState([]), [rainIndex, setRainIndex] = useState(-1);
  const [threshold, setThreshold] = useState(null), [query, setQuery] = useState(''), [layer, setLayer] = useState('satellite'), [radar, setRadar] = useState(true), [satellite, setSatellite] = useState(false), [radarOpacity, setRadarOpacity] = useState(0.72), [satelliteOpacity, setSatelliteOpacity] = useState(0.72), [riverOpacity, setRiverOpacity] = useState(0.4), [showGaugeMarkers, setShowGaugeMarkers] = useState(false);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [lastUpdate, setLastUpdate] = useState(null), [activeNav, setActiveNav] = useState('Map'), [playing, setPlaying] = useState(false), [cycleAlerts, setCycleAlerts] = useState(false), [fullMap, setFullMap] = useState(false), [showLayers, setShowLayers] = useState(false), [clock, setClock] = useState(new Date()), [socketStatus, setSocketStatus] = useState('connecting'), [focusedWarningId, setFocusedWarningId] = useState(null);
  const [showAlertMessage, setShowAlertMessage] = useState(false);
  const socketRef = useRef(null), initialFocusRef = useRef(false), focusedWarningIdRef = useRef(null), manualFocusRef = useRef(false), warningsRef = useRef([]);

  const selected = stations.find(s => stationId(s) === selectedId) || stations.find(s => stationId(s) === '2641') || stations[0];
  const selectedMeasure = selected?.levelMeasure;
  const currentReading = selected ? measurements[stationId(selected)] : null;
  const focusedWarning = warnings.find(w => (w.floodAreaID || w['@id']) === focusedWarningId) || null;
  const warningsForStation = useMemo(() => {
    if (!selected) return [];
    return warnings.filter(w => w.nearestStationId === stationId(selected) && Number(w.nearestStationDistanceKm) <= 3).slice(0, 1);
  }, [selected, warnings]);
  const localRiverShape = useMemo(() => {
    const alertCenter = focusedWarning && focusedWarning.lat != null && focusedWarning.long != null
      ? [Number(focusedWarning.long), Number(focusedWarning.lat)] : null;
    const gaugeCenter = selected?.lat != null && selected?.long != null
      ? [Number(selected.long), Number(selected.lat)] : null;
    const center = alertCenter?.every(Number.isFinite) ? alertCenter : gaugeCenter?.every(Number.isFinite) ? gaugeCenter : null;
    return clipRiverFeatures(riverShape, center, focusedWarning ? alertPolygon : null);
  }, [riverShape, alertPolygon, focusedWarning?.lat, focusedWarning?.long, selected?.lat, selected?.long]);
  const chartPoints = history;
  const delta = useMemo(() => {
    if (chartPoints.length < 2) return null;
    const recent = chartPoints.at(-1), prior = chartPoints[Math.max(0, chartPoints.length - Math.min(chartPoints.length, 5))];
    const hours = Math.max((new Date(recent.dateTime) - new Date(prior.dateTime)) / 3600000, .25);
    return (recent.value - prior.value) / hours;
  }, [chartPoints]);
  const levelState = (focusedWarning || warningsForStation[0]) ? (Number((focusedWarning || warningsForStation[0]).severityLevel) <= 2 ? 'critical' : 'elevated') : (threshold != null && currentReading && currentReading.value > threshold ? 'elevated' : 'healthy');

  const acceptSnapshot = useCallback(data => {
    const rows = data.stations || [];
    setStations(rows);
    const nextMeasurements = {};
    rows.forEach(s => { if (s.reading && Number.isFinite(Number(s.reading.value))) nextMeasurements[stationId(s)] = { value: Number(s.reading.value), dateTime: s.reading.dateTime, measure: measureId(s.levelMeasure) }; });
    setMeasurements(nextMeasurements);
    const nextWarnings = data.providers?.floodWarnings === 'unavailable' ? warningsRef.current : (data.warnings || []);
    if (data.providers?.floodWarnings !== 'unavailable') { warningsRef.current = nextWarnings; setWarnings(nextWarnings); }
    setProviders({ ...(data.providers || {}), floodWarnings: data.providers?.floodWarnings || (Array.isArray(data.warnings) ? 'ok' : 'unavailable'), radar: data.providers?.radar || 'unavailable' });
    const frames = data.radarFrames || [];
    setRainFrames(frames);
    setRainIndex(i => i < 0 ? frames.length - 1 : Math.min(i, frames.length - 1));
    setLastUpdate(new Date(data.generatedAt || Date.now()));
    setError(''); setLoading(false);
    // The API response is ordered by severity, but only levels 1–3 are active
    // flood warnings shown on the map. Focus the first of those rather than a
    // broader, lower-priority item (or an informational level 4 notice).
    const primary = nextWarnings.find(w => Number(w.severityLevel) <= 3) || nextWarnings[0];
    const currentId = focusedWarningIdRef.current;
    const currentWarning = nextWarnings.find(w => (w.floodAreaID || w['@id']) === currentId);
    const firstSnapshot = !initialFocusRef.current;
    const shouldFocusPrimary = primary && (
      !initialFocusRef.current ||
      (!manualFocusRef.current && (!currentWarning || Number(primary.severityLevel) < Number(currentWarning.severityLevel))) ||
      (currentId && !currentWarning)
    );
    initialFocusRef.current = true;
    if (shouldFocusPrimary) {
      const id = primary.floodAreaID || primary['@id'];
      focusedWarningIdRef.current = id;
      setFocusedWarningId(id);
      if (primary.nearestStationId) setSelectedId(primary.nearestStationId);
      const focusStation = rows.find(s => stationId(s) === String(primary.nearestStationId));
      const hasAlertLocation = Number.isFinite(Number(primary.lat)) && Number.isFinite(Number(primary.long));
      const focusPoint = hasAlertLocation
        ? { lat: Number(primary.lat), long: Number(primary.long) }
        : focusStation ? { lat: Number(focusStation.lat), long: Number(focusStation.long) } : { lat: 54.35, long: -3.3 };
      setMapFocus({ ...focusPoint, zoom: hasAlertLocation || focusStation ? 9.2 : 6, warningId: id });
    } else if (firstSnapshot && rows.length) {
      const homeStation = rows.find(s => stationId(s) === '2641') || rows[0];
      setSelectedId(stationId(homeStation));
      setMapFocus({ ...homeStation, zoom: 9.2 });
    } else if (currentId && !currentWarning && !primary) {
      focusedWarningIdRef.current = null; manualFocusRef.current = false;
      const homeStation = rows.find(s => stationId(s) === '2641') || rows[0];
      setFocusedWarningId(null);
      if (homeStation) { setSelectedId(stationId(homeStation)); setMapFocus({ ...homeStation, zoom: 9.2 }); }
    }
  }, []);

  const requestRefresh = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: 'refresh' }));
  }, []);

  useEffect(() => {
    let stopped = false, retry = 0, retryTimer;
    const connect = () => {
      if (stopped) return;
      setSocketStatus('connecting');
      const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${scheme}//${window.location.host}/ws`);
      socketRef.current = socket;
      socket.onopen = () => { retry = 0; setSocketStatus('connected'); };
      socket.onmessage = event => {
        let message; try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'connection') { setSocketStatus(message.status); return; }
        if (message.type === 'feed_error') { setError(message.message); setLoading(false); return; }
        if (message.type === 'snapshot') acceptSnapshot(message);
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        socketRef.current = null;
        if (!stopped) { setSocketStatus('reconnecting'); const wait = Math.min(30000, 1000 * (2 ** retry++)); retryTimer = setTimeout(connect, wait); }
      };
    };
    connect();
    const tick = setInterval(() => setClock(new Date()), 1000);
    return () => { stopped = true; clearTimeout(retryTimer); clearInterval(tick); socketRef.current?.close(); socketRef.current = null; };
  }, [acceptSnapshot]);

  useEffect(() => {
    if (!selectedMeasure) return;
    const controller = new AbortController();
    const loadDetail = async () => {
      try {
        const response = await fetch(`/api/station/${encodeURIComponent(stationId(selected))}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Local data server returned ${response.status}`);
        const result = await response.json();
        setHistory(result.history || []); setRainfall(result.rainfall || null);
        setThreshold(result.typicalRangeHigh !== null && result.typicalRangeHigh !== undefined && Number.isFinite(Number(result.typicalRangeHigh)) ? Number(result.typicalRangeHigh) : null);
      } catch (e) { if (e.name !== 'AbortError') { setHistory([]); setThreshold(null); setRainfall(null); } }
    };
    loadDetail(); return () => controller.abort();
  }, [selectedMeasure?.['@id'], selected?.stationReference]);

  useEffect(() => {
    if (!selected?.riverName) { setRiverShape(null); return; }
    const controller = new AbortController();
    setRiverShape(null);
    fetch(`/api/river?name=${encodeURIComponent(selected.riverName)}`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(`River geometry request returned ${r.status}`); return r.json(); })
      .then(data => { if (!controller.signal.aborted) setRiverShape(data); })
      .catch(error => { if (error.name !== 'AbortError') setRiverShape(null); });
    return () => controller.abort();
  }, [selected?.riverName]);

  useEffect(() => {
    if (!focusedWarningId) { setAlertPolygon(null); return; }
    const controller = new AbortController();
    setAlertPolygon(null);
    fetch(`/api/alert/${encodeURIComponent(String(focusedWarningId).split('/').at(-1))}`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(`Flood-area boundary returned ${r.status}`); return r.json(); })
      .then(shape => { if (!controller.signal.aborted && shape?.type === 'FeatureCollection') setAlertPolygon(shape); })
      .catch(error => { if (error.name !== 'AbortError') setAlertPolygon(null); });
    return () => controller.abort();
  }, [focusedWarningId]);

  useEffect(() => { setShowAlertMessage(false); }, [focusedWarningId, selectedId]);
  useEffect(() => {
    if (!showAlertMessage) return;
    const onKeyDown = event => { if (event.key === 'Escape') setShowAlertMessage(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showAlertMessage]);

  useEffect(() => {
    if (!playing || rainFrames.length < 2) return;
    const timer = setInterval(() => setRainIndex(i => (i + 1) % rainFrames.length), 750);
    return () => clearInterval(timer);
  }, [playing, rainFrames.length]);

  const visibleStations = useMemo(() => {
    let list = stations;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(s => `${s.label} ${s.riverName} ${s.town} ${s.catchmentName} ${stationId(s)}`.toLowerCase().includes(q));
    }
    return list.slice(0, query ? 220 : 700);
  }, [stations, query]);
  const selectStation = (s) => { manualFocusRef.current = true; focusedWarningIdRef.current = null; setSelectedId(stationId(s)); setMapFocus(s); setFocusedWarningId(null); setActiveNav('Map'); };
  const focusWarning = (w) => {
    const id = w.floodAreaID || w['@id'];
    manualFocusRef.current = true; focusedWarningIdRef.current = id;
    setFocusedWarningId(id); setActiveNav('Map');
    if (w.nearestStationId) setSelectedId(w.nearestStationId);
    if (Number.isFinite(Number(w.lat)) && Number.isFinite(Number(w.long))) setMapFocus({ lat: Number(w.lat), long: Number(w.long), zoom: 9.2, warningId: id });
    else { const nearest = stations.find(s => stationId(s) === w.nearestStationId); if (nearest) setMapFocus({ ...nearest, zoom: 9.2 }); }
  };
  const frame = rainFrames[Math.max(0, Math.min(rainIndex, rainFrames.length - 1))];
  const filteredFloods = warnings.filter(w => Number(w.severityLevel) <= 3);
  useEffect(() => {
    if (!cycleAlerts) return;
    const timer = setInterval(() => {
      const alerts = warningsRef.current.filter(w => Number(w.severityLevel) <= 3);
      if (!alerts.length) { setCycleAlerts(false); return; }
      const current = alerts.findIndex(w => (w.floodAreaID || w['@id']) === focusedWarningIdRef.current);
      focusWarning(alerts[(current + 1) % alerts.length]);
    }, 6500);
    return () => clearInterval(timer);
  }, [cycleAlerts]);
  const rainfallLatest = rainfall?.observations?.at(-1);
  const rainfallRate = rainfallLatest && Number(rainfall.periodSeconds) > 0 ? rainfallLatest.value * 3600 / Number(rainfall.periodSeconds) : null;
  const riseLabel = delta == null ? 'Gathering data' : delta >= .1 ? 'Rising quickly' : delta >= .015 ? 'Rising' : delta <= -.1 ? 'Falling quickly' : delta <= -.015 ? 'Falling' : 'Steady';
  const rapidRise = delta != null && delta >= .1;
  const activeRiverColor = rapidRise ? '#ff626e' : '#65d8ff';
  const activeRiverGlow = rapidRise ? '#ff485d' : '#188fe5';
  const activeWarning = focusedWarning || warningsForStation[0];
  const activeWarningMessage = activeWarning?.message || '';
  const alertPreview = activeWarningMessage.length > 170 ? `${activeWarningMessage.slice(0, 170).replace(/\s+\S*$/, '')}…` : activeWarningMessage;
  const warningSeverityCounts = [1, 2, 3].map(level => filteredFloods.filter(w => Number(w.severityLevel) === level).length);
  const gaugeFreshnessCounts = [0, 1, 2].map(bucket => stations.reduce((count, station) => {
    const stamp = measurements[stationId(station)]?.dateTime;
    if (!stamp) return count;
    const age = (Date.now() - new Date(stamp).getTime()) / 3600000;
    return count + (bucket === 0 ? age <= 1 : bucket === 1 ? age > 1 && age <= 6 : age > 6 ? 1 : 0);
  }, 0));
  const statusCopy = activeWarning ? `${activeWarning.severity}${focusedWarning ? ' in focus' : ' nearby'}` : levelState === 'elevated' ? 'Above typical range' : 'Within typical range';
  const useMain = activeNav === 'Stations' ? 'Stations' : activeNav === 'Alerts' ? 'Alerts' : activeNav === 'History' ? 'History' : 'Map';

  return <div className={`app-shell ${fullMap ? 'map-expanded' : ''}`}>
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Waves size={27} strokeWidth={2.3}/></div><span>RiverWatch</span></div>
      <div className="top-divider"/><div className={`live-chip ${socketStatus}`}><i/>{error ? 'Data delayed' : socketStatus === 'connected' ? 'Live data' : socketStatus === 'connecting' ? 'Loading data' : 'Restoring data'}</div>
      <div className="top-context">UK river levels <span>·</span> catchments <span>·</span> weather</div>
      <label className="searchbox"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search rivers, stations or places…"/><kbd>⌘ K</kbd></label>
      <div className="clock-block"><span>{clock.toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short'})}</span><strong>{clock.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</strong></div>
      <div className="weather-chip" title={rainfall ? `Environment Agency rainfall gauge ${rainfall.station}, ${rainfall.distanceKm} km from ${selected?.label}; last observation ${rainfallLatest?.dateTime || 'unknown'}` : 'No nearby Environment Agency rainfall gauge data available for the selected station'}><CloudRain size={18}/><div><b>{rainfallRate==null?'—':`${rainfallRate.toFixed(1)} mm/h`}</b><span>{rainfall?`Rain · ${rainfall.distanceKm} km`:'Rain unavailable'}</span></div></div>
      <button className="icon-button top-menu" title="Settings"><Settings2 size={18}/></button>
    </header>
    <aside className="sidebar">
      <div className="nav-group">MONITOR</div>
      {[['Overview',Gauge],['Map',MapIcon],['Stations',Database],['Alerts',Bell],['History',Activity]].map(([name,Icon])=><button key={name} className={`nav-item ${activeNav===name?'selected':''}`} onClick={()=>setActiveNav(name)}><Icon size={18}/><span>{name}</span>{name==='Alerts'&&providers.floodWarnings==='ok'&&filteredFloods.length>0&&<b className="nav-count">{filteredFloods.length}</b>}</button>)}
      <div className="sidebar-bottom"><div className="mini-health"><span className={`health-dot ${levelState}`}/><div><b>{statusCopy}</b><small>{compactNum(stations.length)} gauges online</small></div></div><button className="nav-item"><Settings2 size={18}/><span>Preferences</span></button><div className="data-credit">DATA FROM<br/><b>Environment Agency</b><br/>RainViewer · EUMETSAT</div></div>
    </aside>
    <main className="workspace">
      <div className={`view-heading ${useMain === 'Map' ? 'map-heading' : ''}`}><div><div className="eyebrow">RIVER INTELLIGENCE <span>/</span> LIVE MONITORING</div><h1>{useMain === 'Map' ? 'UK overview' : useMain}</h1></div><div className="heading-actions"><span className="updated"><span className="live-pulse"/>Updated {ago(lastUpdate)}</span><button className="outline-button" onClick={requestRefresh}><Activity size={15}/> Refresh</button></div></div>
      {error && <div className="error-banner"><AlertTriangle size={16}/><span>{error}</span><button onClick={requestRefresh}>Retry</button></div>}
      {useMain === 'Alerts' ? <AlertsView warnings={filteredFloods} available={providers.floodWarnings==='ok'} onSelect={focusWarning}/> : useMain === 'Stations' ? <StationView stations={visibleStations} measurements={measurements} onSelect={selectStation}/> : useMain === 'History' ? <section className="history-page panel"><div className="panel-heading"><div><span className="eyebrow">GAUGE HISTORY</span><h2>{selected?.label || 'Select a station'}</h2></div><span className="subtle">Today · Environment Agency</span></div><HistoryChart points={history} threshold={threshold} unit={selected?.levelMeasure?.unitName}/></section> : <>
        <section className={`map-and-detail ${fullMap ? 'map-only' : ''}`}>
          <div className="map-card">
            <MapContainer center={[54.35,-3.3]} zoom={6} minZoom={5} maxZoom={15} zoomControl={false} scrollWheelZoom className={`uk-map map-base-${layer}`}>
              <TileLayer className={`base-${layer}`} attribution={layer==='satellite' ? 'Tiles &copy; Esri — Sources: Esri, Maxar, Earthstar Geographics' : layer==='terrain' ? '&copy; OpenStreetMap contributors &middot; SRTM | Map style &copy; OpenTopoMap' : 'Basemap &copy; Esri, HERE, Garmin, USGS, NGA, EPA, NPS'} url={layer==='satellite' ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' : layer==='terrain' ? 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png' : 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'} />
              {layer==='dark'&&<TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}" attribution="Labels &copy; Esri"/>}
              {layer==='satellite'&&<TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" attribution="Labels &copy; Esri" opacity={.8}/>}
              <WMSTileLayer className="river-network-overlay" url="https://gis.geodata.soton.ac.uk/geoserver/open_rivers/wms" layers="open_rivers:ORN" styles="line" format="image/png" transparent version="1.1.1" opacity={riverOpacity} attribution='River network: OpenRiversNetwork, University of Southampton / River Restoration Centre / Cranfield University; contains OS data &copy; Crown copyright and database rights 2023, OGL v3.0'/>
              {alertPolygon?.features?.length>0&&<GeoJSON key={`alert-area-${focusedWarningId}`} data={alertPolygon} style={{color:levelState==='critical'?'#ff5c63':'#ffc05e',weight:2.5,opacity:.98,fillColor:levelState==='critical'?'#ee4b57':'#ffb63b',fillOpacity:.13,dashArray:'7 5'}}/>}
              {localRiverShape?.features?.length>0&&<GeoJSON key={`river-glow-${focusedWarningId||stationId(selected||{})}`} data={localRiverShape} style={{color:activeRiverGlow,weight:10,opacity:.24,lineCap:'round'}}/>}
              {localRiverShape?.features?.length>0&&<GeoJSON key={`river-active-${focusedWarningId||stationId(selected||{})}`} data={localRiverShape} style={{color:activeRiverColor,weight:3,opacity:.98,dashArray:'8 8',lineCap:'round',className:`river-current ${rapidRise?'rapid-rise':''}`}}/>}
              {radar && rainFrames.map((radarFrame, index) => <TileLayer
                key={radarFrame.path}
                className="radar-frame-layer"
                url={`https://tilecache.rainviewer.com${radarFrame.path}/512/{z}/{x}/{y}/2/1_0.png`}
                maxNativeZoom={7}
                maxZoom={15}
                opacity={index === Math.max(0, Math.min(rainIndex, rainFrames.length - 1)) ? radarOpacity : 0}
                attribution='Weather radar by <a href="https://www.rainviewer.com/">RainViewer</a>'
              />)}
              {satellite && <WMSTileLayer url="https://view.eumetsat.int/geoserver/wms" layers="mtg_fd:rgb_geocolour" format="image/png" transparent version="1.3.0" opacity={satelliteOpacity} attribution='Satellite imagery &copy; <a href="https://www.eumetsat.int/">EUMETSAT</a>'/>}
              <FocusStation station={mapFocus}/><ResizeMap expanded={fullMap}/><ZoomControl position="topright"/>
              {visibleStations.filter(s=>showGaugeMarkers||stationId(s)===stationId(selected||{})).map(s=>{const id=stationId(s), isSelected=id===stationId(selected||{}); return <CircleMarker key={id} center={[s.lat,s.long]} radius={isSelected?8:2.4} pathOptions={{color:isSelected?'#e7f6ff':'#55baff',weight:isSelected?2:1,fillColor:isSelected?'#32a8ff':'#268bd4',fillOpacity:isSelected?1:.5,opacity:.78}} eventHandlers={{click:()=>selectStation(s)}}/>})}
              {filteredFloods.filter(w=>Number.isFinite(w.lat)&&Number.isFinite(w.long)).flatMap(w=>{const id=w.floodAreaID||w['@id'];const primary=id===(warnings[0]?.floodAreaID||warnings[0]?.['@id']);const active=id===focusedWarningId;const prominent=primary||active;const tint=Number(w.severityLevel)<=2?'#ff515b':Number(w.severityLevel)===3?'#ffb442':'#ffc76a';return [<CircleMarker key={`warning-halo-${id}`} center={[w.lat,w.long]} radius={prominent?23:15} interactive={false} pathOptions={{color:tint,weight:0,fillColor:tint,fillOpacity:prominent ? 0.2 : 0.12,className:prominent?'alert-marker-halo-primary':'alert-marker-halo'}}/>,<CircleMarker key={`warning-${id}`} center={[w.lat,w.long]} radius={prominent?6.5:4.5} pathOptions={{color:'#ffe6d1',weight:1,fillColor:tint,fillOpacity:prominent ? 0.82 : 0.68,opacity:.95,className:prominent?'alert-marker-core-primary':'alert-marker-core'}} eventHandlers={{click:()=>focusWarning(w)}}><Tooltip direction="top">{w.severity} area: {w.description}</Tooltip></CircleMarker>]})}
            </MapContainer>
            <div className="map-topline"><div className="map-mode"><button className={layer==='dark'?'active':''} onClick={()=>setLayer('dark')}><Waves size={14}/> Rivers</button><button className={layer==='terrain'?'active':''} onClick={()=>setLayer('terrain')}>Terrain</button><button className={layer==='satellite'?'active':''} onClick={()=>setLayer('satellite')}>Satellite</button><button className={`radar-mode ${radar?'active':''}`} onClick={()=>setRadar(!radar)} disabled={providers.radar!=='ok'} title="Toggle rainfall radar"><CloudRain size={13}/> Rain</button></div><div className="map-top-actions"><button className="map-search-hint" onClick={()=>document.querySelector('.searchbox input')?.focus()}><Search size={14}/> Find a gauge</button><button className={`alert-cycle-toggle ${cycleAlerts?'active':''}`} role="switch" aria-checked={cycleAlerts} aria-label="Cycle through active alerts" title={filteredFloods.length ? 'Smoothly cycle through active flood alerts' : 'No active flood alerts'} disabled={!filteredFloods.length} onClick={()=>{const next=!cycleAlerts;setCycleAlerts(next);if(next&&!focusedWarningIdRef.current&&filteredFloods[0])focusWarning(filteredFloods[0]);}}><span className="cycle-switch"><i/></span><span className="cycle-label">Alerts</span></button></div></div>
            <div className="map-layers-control"><button className={showLayers?'on':''} onClick={()=>setShowLayers(!showLayers)}><Layers2 size={16}/><span>Layers</span></button>{showLayers&&<div className="layer-popover"><div className="popover-title">MAP DETAIL</div><label className="layer-toggle"><span><MapIcon size={15}/> Show gauge markers <small>Up to 700 station markers</small></span><input type="checkbox" checked={showGaugeMarkers} onChange={e=>setShowGaugeMarkers(e.target.checked)}/></label><OpacityControl label="River network" value={riverOpacity} onChange={setRiverOpacity}/><div className="popover-title weather-title">WEATHER OVERLAYS</div><label className="layer-toggle"><span><CloudRain size={15}/> Rainfall radar <small>{providers.radar==='ok'?'RainViewer · native zoom 7':'Radar feed unavailable'}</small></span><input type="checkbox" disabled={providers.radar!=='ok'} checked={radar} onChange={e=>setRadar(e.target.checked)}/></label><OpacityControl label="Radar opacity" value={radarOpacity} onChange={setRadarOpacity} disabled={providers.radar!=='ok'}/><label className="layer-toggle"><span><Radio size={15}/> Satellite clouds <small>Meteosat · near-real-time</small></span><input type="checkbox" checked={satellite} onChange={e=>setSatellite(e.target.checked)}/></label><OpacityControl label="Satellite opacity" value={satelliteOpacity} onChange={setSatelliteOpacity}/><div className="popover-credit">Radar shows reflectivity, not calibrated rainfall amounts. Satellite imagery via EUMETSAT.</div></div>}</div>
            <div className="map-legend">{showGaugeMarkers&&<span><i className="legend-blue"/> River gauges</span>}{rapidRise&&<span><i className="legend-rapid"/> Rising quickly</span>}<span><i className="legend-alert"/> Alert area point</span><span><i className="legend-ring"/> Selected station</span></div>
            {radar&&rainFrames.length>0&&<div className="radar-timeline"><button onClick={()=>setPlaying(!playing)} aria-label={playing?'Pause radar':'Play radar'}>{playing?'Ⅱ':'▶'}</button><span>RADAR</span><input type="range" min="0" max={Math.max(0,rainFrames.length-1)} value={Math.max(0,rainIndex)} onChange={e=>{setPlaying(false);setRainIndex(Number(e.target.value))}}/><small>{frame?new Date(frame.time*1000).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'—'}</small></div>}
            <button className="expand-map" title={fullMap?'Restore dashboard':'Expand map'} onClick={()=>setFullMap(!fullMap)}>{fullMap?<X size={16}/>:<Maximize2 size={16}/>}</button>
            <div className="map-foot">{showGaugeMarkers?`${visibleStations.length} GAUGES SHOWN`:"GAUGE LAYER OFF"} <span>·</span> {compactNum(stations.length)} ONLINE</div>
          </div>
          {!fullMap&&<aside className="detail-panel panel">
            <div className="detail-header"><div><div className={`alert-kicker ${levelState}`}><span className="status-spark"/>{focusedWarning?'OFFICIAL FLOOD ALERT':warningsForStation.length?'NEARBY OFFICIAL ALERT':'LIVE GAUGE STATUS'}</div><h2>{focusedWarning?.floodArea?.riverOrSea || selected?.riverName || 'Select a river'}</h2><div className="station-name">{focusedWarning?.description || selected?.label || 'No station selected'} <span>·</span> {selected?.town || focusedWarning?.floodArea?.county || selected?.catchmentName || 'UK'}</div></div><div className="alert-status-stack">{focusedWarning&&<span className={`severity-pill ${levelState}`}>{focusedWarning.severity?.toUpperCase()}</span>}<span className={`trend-chip ${delta>=.015?'up':delta<=-.015?'down':''}`} title="Trend calculated from recent readings at the selected gauge; it does not change the official flood warning status.">{delta>=.015?<ArrowUpRight size={15}/>:delta<=-.015?<ArrowDownRight size={15}/>:<Activity size={14}/>} Gauge · {riseLabel}</span></div></div>
            <div className="river-art">
              {selected?.lat&&selected?.long&&<MapContainer key={`detail-map-${stationId(selected)}`} center={[selected.lat,selected.long]} zoom={12} minZoom={10} maxZoom={15} zoomControl={false} attributionControl={false} dragging={false} scrollWheelZoom={false} doubleClickZoom={false} touchZoom={false} keyboard={false} className="detail-mini-map">
                <TileLayer className="base-satellite" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"/>
                {riverShape?.features?.length>0&&<GeoJSON data={riverShape} style={{color:'#55d9ff',weight:3,opacity:.95}}/>}
                <CircleMarker center={[selected.lat,selected.long]} radius={7} pathOptions={{color:'#eaf8ff',weight:2,fillColor:'#32a8ff',fillOpacity:1}}/>
              </MapContainer>}
              <div className="art-data"><span>LIVE WATER LEVEL · {selected?.label || 'GAUGE'}</span><strong>{currentReading?`${currentReading.value.toFixed(2)} m`:'—'}</strong><small>{selected?.levelMeasure?.unitName || 'Water level'} <i/> {ago(currentReading?.dateTime)}</small></div>
              <div className="art-coordinate">{selected?.lat?.toFixed(3)}°N&nbsp; {Math.abs(selected?.long||0).toFixed(3)}°W</div>
            </div>
            <div className="metric-row"><Metric label="CURRENT LEVEL" value={currentReading?`${currentReading.value.toFixed(2)} m`:'—'} icon={<Waves size={20}/>} color="blue"/><Metric label="RATE OF CHANGE" value={delta==null?'—':`${delta>0?'+':''}${delta.toFixed(2)} m/h`} icon={delta==null?<Activity size={19}/>:delta>=0?<ArrowUpRight size={20}/>:<ArrowDownRight size={20}/>} color={delta>0?'red':'blue'}/><Metric label="TREND" value={riseLabel} icon={<Activity size={19}/>} color={delta>=.1?'red':delta>0?'amber':'blue'}/></div>
            <div className="threshold-row"><div><span>Last reading</span><b><Clock3 size={15}/>{currentReading?new Date(currentReading.dateTime).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'Waiting for reading'}</b><small>{ago(currentReading?.dateTime)}</small></div><div className="threshold-side"><span>Typical range high</span><b>{threshold!=null?`${threshold.toFixed(2)} m`:'Not published'}</b>{threshold!=null&&currentReading&&<small>{(threshold-currentReading.value).toFixed(2)} m {threshold>=currentReading.value?'below':'above'} typical high</small>}</div></div>
            <div className={`insight-box ${levelState}`}><span className="insight-icon">{levelState==='healthy'?<Droplets size={17}/>:<AlertTriangle size={17}/>}</span><div className="insight-copy"><p>{activeWarning?alertPreview || 'The Environment Agency has issued an active flood alert for this area.':levelState==='elevated'?'This gauge is above its published typical range. Check official local flood warnings for current risk information.':`No matching official flood warning found for ${selected?.label || 'this gauge'}. River levels can change; readings are reported at the station’s published interval.`}</p>{activeWarningMessage.length>170&&<button className="alert-message-toggle" onClick={()=>setShowAlertMessage(true)}>Read full alert</button>}</div></div>
          </aside>}
        </section>
        {!fullMap&&<section className="bottom-grid">
          <div className="chart-panel panel"><div className="panel-heading"><div><div className="chart-title"><span className="eyebrow">LIVE HYDROGRAPH</span><i/> <span className="small-context">{selected?.riverName || 'River level'} · {selected?.label || 'Gauge'}</span></div><h3>River level <small>{selected?.levelMeasure?.unitName ? `(${selected.levelMeasure.unitName})` : '(m)'}</small></h3></div><div className="chart-key"><span><i className="key-line"/>River level</span>{rainfall&&<span title={`Nearby gauge: ${rainfall.station}, ${rainfall.distanceKm} km away`}><i className="key-rain"/>Rainfall mm/h</span>}{threshold!=null&&<span><i className="key-dash"/>Typical range high</span>}<button title="History view" onClick={()=>setActiveNav('History')}><Maximize2 size={14}/></button></div></div><div className="chart-wrap"><HistoryChart points={history} threshold={threshold} unit={selected?.levelMeasure?.unitName} rainfall={rainfall}/></div><div className="chart-bottom-labels"><span>Today · Environment Agency readings{rainfall?` · Rain gauge ${rainfall.distanceKm} km away`:' · Rain gauge unavailable nearby'}</span><span>{history.length} level · {rainfall?.observations?.length || 0} rain</span></div></div>
          <div className="summary-stack"><SummaryCard icon={<AlertTriangle size={17}/>} label="Active flood warnings" value={providers.floodWarnings==='ok'?compactNum(filteredFloods.length):'—'} tone="red" note={providers.floodWarnings==='ok'?`${warningSeverityCounts[0]} severe · ${warningSeverityCounts[1]} flood warnings · ${warningSeverityCounts[2]} flood alerts`:'Alert feed unavailable'} graphic={<MiniBars values={warningSeverityCounts} tone="red" label="Current warnings by severity"/>} onClick={()=>setActiveNav('Alerts')}/><SummaryCard icon={<Database size={17}/>} label="Monitored gauges" value={compactNum(stations.length)} tone="blue" note="Recent readings · <1h / 1–6h / >6h" graphic={<MiniBars values={gaugeFreshnessCounts} tone="blue" label="Gauge reading freshness: less than one hour, one to six hours, over six hours"/>} onClick={()=>setActiveNav('Stations')}/><SummaryCard icon={<Waves size={18}/>} label="Selected river level" value={currentReading?`${currentReading.value.toFixed(2)} m`:'—'} tone="amber" note={selected?.label || 'Awaiting readings'} graphic={<MiniTrend values={history.map(p=>p.value)} tone="amber" label="Selected gauge level history"/>} onClick={()=>selected&&selectStation(selected)}/></div>
        </section>}
      </>}
      <footer className="app-footer"><span>RiverWatch <b>·</b> Data from the Environment Agency real-time flood-monitoring API</span><span>For information only · Follow official flood guidance <a href="https://www.gov.uk/check-flooding" target="_blank" rel="noreferrer">Check for flooding ↗</a></span></footer>
    </main>
    {showAlertMessage&&<div className="alert-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setShowAlertMessage(false)}}><section className="alert-modal" role="dialog" aria-modal="true" aria-labelledby="alert-modal-title"><header><div><span className="eyebrow">ENVIRONMENT AGENCY · OFFICIAL MESSAGE</span><h2 id="alert-modal-title">{focusedWarning?.description || focusedWarning?.floodArea?.riverOrSea || 'Flood alert'}</h2></div><button className="icon-button" aria-label="Close full flood alert" onClick={()=>setShowAlertMessage(false)}><X size={18}/></button></header><p>{activeWarningMessage}</p><footer><span>{focusedWarning?.severity || 'Official flood information'}</span><a href="https://www.gov.uk/check-flooding" target="_blank" rel="noreferrer">Check official guidance ↗</a></footer></section></div>}
    {loading&&<div className="loading-cover"><div className="loading-mark"><Waves size={28}/></div><b>Reading the rivers</b><span>Connecting to live UK gauge data…</span><div className="loading-track"><i/></div></div>}
  </div>;
}

function Metric({label,value,icon,color}){return <div className="metric-card"><div className={`metric-icon ${color}`}>{icon}</div><div><span>{label}</span><b>{value}</b></div></div>}
function OpacityControl({label,value,onChange,disabled=false}){return <label className={`opacity-control ${disabled?'disabled':''}`}><span>{label}</span><b>{Math.round(value*100)}%</b><input type="range" min="0" max="100" step="5" value={Math.round(value*100)} disabled={disabled} onChange={e=>onChange(Number(e.target.value)/100)}/></label>}
function SummaryCard({icon,label,value,tone,note,graphic,onClick}){return <button className="summary-card panel" onClick={onClick}><span className={`summary-icon ${tone}`}>{icon}</span><span className="summary-copy"><small>{label}</small><b>{value}</b><em>{note}</em></span>{graphic}<ChevronRight size={16} className="summary-arrow"/></button>}
function MiniBars({values,tone,label}){if(!values?.length)return null;const max=Math.max(1,...values);return <svg className={`summary-graphic ${tone}`} viewBox="0 0 74 30" role="img" aria-label={label}>{values.map((v,i)=>{const h=Math.max(2,24*v/max);return <rect key={i} x={i*23+5} y={27-h} width="12" height={h} rx="2"/>})}</svg>}
function MiniTrend({values,tone,label}){const rows=values.filter(Number.isFinite).slice(-24);if(rows.length<2)return null;const lo=Math.min(...rows),hi=Math.max(...rows),span=Math.max(hi-lo,.01);const path=rows.map((v,i)=>`${i?'L':'M'} ${i*72/Math.max(rows.length-1,1)+1} ${26-(v-lo)/span*22}`).join(' ');return <svg className={`summary-graphic trend ${tone}`} viewBox="0 0 74 30" role="img" aria-label={label}><path d={path}/></svg>}
function StationView({stations,measurements,onSelect}) {return <section className="list-panel panel"><div className="panel-heading"><div><span className="eyebrow">LIVE MONITORING NETWORK</span><h2>River gauges</h2></div><span className="subtle">Select a station to inspect its live readings</span></div><div className="station-table"><div className="table-head"><span>STATION</span><span>RIVER / CATCHMENT</span><span>LOCATION</span><span>LEVEL</span><span>LAST READING</span></div>{stations.slice(0,180).map(s=>{const r=measurements[stationId(s)];return <button className="station-row" key={stationId(s)} onClick={()=>onSelect(s)}><span><i className="table-live"/><b>{s.label}</b><small>{stationId(s)}</small></span><span>{s.riverName||s.catchmentName||'—'}</span><span>{s.town||'—'}</span><strong>{r?`${r.value.toFixed(2)} m`:'—'}</strong><span className="subtle">{ago(r?.dateTime)}</span></button>})}</div></section>}
function AlertsView({warnings,onSelect}) {return <section className="list-panel panel"><div className="panel-heading"><div><span className="eyebrow">OFFICIAL ALERTS</span><h2>Flood warnings &amp; alerts</h2></div><span className="subtle">Environment Agency · updated by the source</span></div>{!warnings.length?<div className="empty-state"><div><Waves size={24}/></div><h3>No active flood warnings</h3><p>The Environment Agency currently reports no flood alerts or warnings. Gauge readings continue to update independently.</p></div>:<div className="alerts-grid">{warnings.map((w,i)=><article className="warning-card" key={w['@id']||i} role="button" tabIndex={0} onClick={()=>onSelect(w)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(w)}}}><div className="warning-top"><span className={`severity-pill ${w.severityLevel<=2?'critical':'elevated'}`}>{w.severity||'Flood alert'}</span><span>{ago(w.timeMessageChanged||w.timeRaised)}</span></div><h3>{w.description||w.floodArea?.riverOrSea||'Flood alert area'}</h3><p>{w.floodArea?.county||w.eaAreaName||''}</p><div className="warning-message">{w.message||'Follow the Environment Agency for local guidance.'}</div><a href="https://www.gov.uk/check-flooding" target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}>Open official flood guidance <ChevronRight size={15}/></a></article>)}</div>}</section>}

export default App;

