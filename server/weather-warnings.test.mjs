import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWeatherWarnings } from './weather-warnings.mjs';
const feed = items => `<rss><channel><title>Met Office warnings for UK</title>${items}</channel></rss>`;
const item = link => `<item><title>Amber warning of wind affecting Grampian</title><description>Valid today &amp; tomorrow</description><link>${link}</link></item>`;
test('parses single regional warning and decodes text', () => {
  const [warning] = parseWeatherWarnings(feed(item('https://www.metoffice.gov.uk/weather/warnings')));
  assert.equal(warning.level, 'amber');
  assert.equal(warning.region, 'Grampian');
  assert.equal(warning.description, 'Valid today & tomorrow');
  assert.equal(warning.lat, 57.2);
});
test('empty feed is distinct from malformed or unexpected data', () => {
  assert.deepEqual(parseWeatherWarnings(feed('')), []);
  assert.throws(() => parseWeatherWarnings('<html>Unavailable</html>'));
  assert.throws(() => parseWeatherWarnings('<rss>'));
});
test('rejects links outside the official HTTPS website', () => {
  assert.deepEqual(parseWeatherWarnings(feed(item('javascript:alert(1)'))), []);
  assert.deepEqual(parseWeatherWarnings(feed(item('https://example.com/'))), []);
});

test('Atom issued link must stay on the Met Office API before credentials are sent', async () => {
  const {issuedUrl} = await import('./weather-warnings.mjs');
  assert.equal(issuedUrl('<feed><link rel="related" href="https://data.hub.api.metoffice.gov.uk/nswws/v1.1/objects/issued/abc/"/></feed>'), 'https://data.hub.api.metoffice.gov.uk/nswws/v1.1/objects/issued/abc/');
  assert.throws(()=>issuedUrl('<feed><link rel="related" href="https://example.com/nswws/v1.1/objects/issued/abc/"/></feed>'));
});

test('polygon warnings retain boundaries and upcoming warnings, excluding expired/cancelled', async () => {
  const {normalizeWarningPolygons} = await import('./weather-warnings.mjs');
  const feature = {type:'Feature',properties:{warningId:'test',warningStatus:'ISSUED',warningLevel:'AMBER',weatherType:['WIND'],validFromDate:'2026-10-25T00:00:00Z',validToDate:'2026-10-26T00:00:00Z'},geometry:{type:'MultiPolygon',coordinates:[[[[-4,56],[-3,56],[-3,57],[-4,56]]]]}};
  const data=normalizeWarningPolygons({type:'FeatureCollection',features:[feature,{...feature,properties:{...feature.properties,warningStatus:'CANCELLED'}}]},Date.parse('2026-10-24T00:00:00Z'));
  assert.equal(data.length,1);assert.deepEqual(data[0].geometry,feature.geometry);assert.equal(data[0].level,'amber');
  assert.equal(normalizeWarningPolygons({type:'FeatureCollection',features:[feature]},Date.parse('2026-10-27T00:00:00Z')).length,0);
});
