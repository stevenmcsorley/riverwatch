import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStations, readings, fetchSepaHistory } from './sepa.mjs';

test('SEPA metadata joins readings by series ID, including zero levels', () => {
  const stations = normalizeStations([
    ['ts_id', 'station_no', 'station_name', 'station_latitude', 'station_longitude', 'ts_unitsymbol'],
    ['123', '42', 'Scottish gauge', '56', '-4', 'm'],
    ['456', '43', 'No reading', '57', '-3', 'm'],
  ], [{ ts_id: '123', data: [['2026-10-24T00:00:00Z', 0]] }]);
  assert.equal(stations[0].stationReference, 'sepa-42');
  assert.equal(stations[0].reading.value, 0);
  assert.equal(stations[0].levelMeasure.tsId, '123');
  assert.equal(stations[1].reading, null);
});

test('invalid observations are excluded and history is chronological', () => {
  assert.deepEqual(readings({ data: [['bad', 2], ['2026-10-24T02:00:00Z', 1], ['2026-10-24T01:00:00Z', 0], ['2026-10-24T03:00:00Z', null]] }).map(r => r.value), [0, 1]);
});

test('history requests today and selects the requested series', async () => {
  const result = await fetchSepaHistory(async url => {
    const params = new URL(url).searchParams;
    assert.equal(params.get('from'), `${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    assert.equal(params.get('ts_id'), '123');
    return [{ ts_id: '123', data: [['2026-10-24T00:00:00Z', 1]] }];
  }, '123');
  assert.equal(result[0].value, 1);
});
