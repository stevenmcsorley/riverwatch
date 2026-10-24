import { XMLParser, XMLValidator } from 'fast-xml-parser';

const regions = {
  'Orkney & Shetland': [59.3, -2.2], 'Highlands & Eilean Siar': [57.5, -4.8],
  Grampian: [57.2, -2.8], Strathclyde: [55.9, -4.8], 'Central, Tayside & Fife': [56.4, -3.6],
  'Dumfries, Galloway, Lothian & Borders': [55.5, -3.3], 'SW Scotland, Lothian Borders': [55.5, -3.3],
  'Northern Ireland': [54.7, -6.7], Wales: [52.3, -3.7], 'North West England': [54.1, -2.8],
  'North East England': [55, -1.9], 'Yorkshire & Humber': [53.9, -1.2], 'West Midlands': [52.5, -2.2],
  'East Midlands': [52.9, -0.9], 'East of England': [52.2, 0.6], 'South West England': [50.8, -3.7],
  'London & South East England': [51.3, -0.2],
};

export function parseWeatherWarnings(xml) {
  if (XMLValidator.validate(xml) !== true) throw new Error('Invalid weather warning XML');
  const channel = new XMLParser({ processEntities: true }).parse(xml)?.rss?.channel;
  if (!channel || !String(channel.title).includes('Met Office')) throw new Error('Unexpected weather warning feed');
  const items = channel.item ? (Array.isArray(channel.item) ? channel.item : [channel.item]) : [];
  return items.map(item => {
    const title = String(item.title || '');
    const region = title.split(' affecting ')[1];
    const coordinates = regions[region];
    const link = String(item.link || '');
    let url;
    try { url = new URL(link); } catch { return null; }
    if (url.protocol !== 'https:' || !['www.metoffice.gov.uk', 'weather.metoffice.gov.uk'].includes(url.hostname)) return null;
    if (!coordinates) throw new Error(`Unknown Met Office region: ${region}`);
    return { id: String(item.guid || link) + region, title, region, description: String(item.description || ''),
      level: /^(Red|Amber|Yellow)\b/i.exec(title)?.[1].toLowerCase() || 'yellow',
      lat: coordinates[0], long: coordinates[1], link };
  }).filter(Boolean);
}

export async function fetchWeatherWarnings() {
  if (process.env.MET_OFFICE_API_KEY) return fetchWarningPolygons(process.env.MET_OFFICE_API_KEY);
  const response = await fetch('https://weather.metoffice.gov.uk/public/data/PWSCache/WarningsRSS/Region/UK', { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Weather warnings HTTP ${response.status}`);
  return parseWeatherWarnings(await response.text());
}

const apiBase = 'https://data.hub.api.metoffice.gov.uk/nswws/v1.1';
export function issuedUrl(xml) {
  if (XMLValidator.validate(xml) !== true) throw new Error('Invalid Met Office Atom feed');
  const feed = new XMLParser({ ignoreAttributes: false }).parse(xml)?.feed;
  const links = Array.isArray(feed?.link) ? feed.link : [feed?.link];
  const href = links.find(link => link?.['@_rel'] === 'related')?.['@_href'];
  const url = new URL(href, `${apiBase}/objects/feed`);
  if (url.origin !== new URL(apiBase).origin || !/^\/nswws\/v1\.1\/objects\/issued\/[\w-]+\/?$/.test(url.pathname) || url.search || url.username || url.password) throw new Error('Unexpected Met Office issued URL');
  return url.href;
}

export function normalizeWarningPolygons(collection, now = Date.now()) {
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) throw new Error('Unexpected Met Office polygons');
  return collection.features.filter(feature => {
    const p = feature.properties;
    return p?.warningStatus === 'ISSUED' && Date.parse(p.validToDate) > now;
  }).map(feature => {
    const p = feature.properties;
    const level = String(p.warningLevel).toLowerCase();
    if (!['yellow', 'amber', 'red'].includes(level) || !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type) || !Array.isArray(feature.geometry.coordinates)) throw new Error('Invalid Met Office warning area');
    return {
      id: String(p.warningId), level, geometry: feature.geometry,
      title: `${level[0].toUpperCase() + level.slice(1)} warning of ${(p.weatherType || []).join(' and ').toLowerCase()}`,
      description: p.warningHeadline || '', details: p.warningFurtherDetails || '',
      validFrom: p.validFromDate, validTo: p.validToDate, revision: p.modifiedDate || p.warningVersion,
      region: (p.affectedAreas || []).map(area => area.regionName).join(', '),
      link: `https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings#?id=${encodeURIComponent(p.warningId)}`,
    };
  });
}

async function fetchWarningPolygons(key) {
  const request = async url => {
    const response = await fetch(url, { headers: { apikey: key }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Met Office warnings HTTP ${response.status}`);
    return response;
  };
  const feed = await request(`${apiBase}/objects/feed`);
  const response = await request(issuedUrl(await feed.text()));
  return normalizeWarningPolygons(await response.json());
}
