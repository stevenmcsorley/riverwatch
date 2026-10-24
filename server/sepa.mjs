export function sepaUrl(request, options = {}) {
  return `https://timeseries.sepa.org.uk/KiWIS/KiWIS?${new URLSearchParams({ service: 'kisters', type: 'queryServices', datasource: '0', format: 'json', request, ...options })}`;
}

export function readings(series) {
  return (series?.data || []).filter(([time, value]) => Number.isFinite(Date.parse(time)) && value !== null && value !== '' && Number.isFinite(Number(value)))
    .map(([dateTime, value]) => ({ dateTime, value: Number(value) })).sort((a, b) => Date.parse(a.dateTime) - Date.parse(b.dateTime));
}

export function normalizeStations(metadata, values) {
  if (!Array.isArray(metadata?.[0]) || !Array.isArray(values)) throw new Error('Unexpected SEPA response');
  const latest = new Map(values.map(series => [String(series.ts_id), readings(series).at(-1) || null]));
  return metadata.slice(1).map(row => Object.fromEntries(metadata[0].map((key, i) => [key, row[i]])))
    .filter(row => row.station_latitude && row.station_longitude && Number.isFinite(Number(row.station_latitude)) && Number.isFinite(Number(row.station_longitude)))
    .map(row => ({
      stationReference: `sepa-${row.station_no}`, label: row.station_name, riverName: '', town: 'Scotland', catchmentName: '',
      country: 'Scotland', provider: 'SEPA', lat: Number(row.station_latitude), long: Number(row.station_longitude), stageScale: null,
      levelMeasure: { '@id': `sepa-${row.ts_id}`, tsId: String(row.ts_id), parameter: 'level', qualifier: 'Stage', unitName: row.ts_unitsymbol || 'm' },
      reading: latest.get(String(row.ts_id)) || null,
    }));
}

export async function fetchSepaStations(json) {
  const [metadata, values] = await Promise.all([
    json(sepaUrl('getTimeseriesList', { ts_path: '1/*/SG/15m.Cmd', returnfields: 'ts_id,station_no,station_name,station_latitude,station_longitude,ts_unitsymbol' })),
    json(sepaUrl('getTimeseriesValues', { ts_path: '1/*/SG/15m.Cmd', returnfields: 'Timestamp,Value' })),
  ]);
  return normalizeStations(metadata, values);
}

export async function fetchSepaHistory(json, tsId) {
  const today = new Date().toISOString().slice(0, 10);
  const values = await json(sepaUrl('getTimeseriesValues', { ts_id: tsId, from: `${today}T00:00:00Z`, returnfields: 'Timestamp,Value' }));
  if (!Array.isArray(values)) throw new Error('Unexpected SEPA history response');
  return readings(values.find(series => String(series.ts_id) === tsId));
}
