import test from 'node:test'
import assert from 'node:assert/strict'
import { validSelection } from '../src/domain/map'
test('map draft handoff accepts only fresh finite GCJ-02 coordinates', () => {
  const place = {
    longitude: 120.12,
    latitude: 31.12,
    name: '河',
    crs: 'GCJ-02',
    created_at: 1000000
  }
  assert.equal(validSelection(place, 1000001), true)
  for (const invalid of [
    null,
    {},
    { ...place, crs: 'WGS84' },
    { ...place, latitude: Infinity },
    { ...place, longitude: '120' },
    { ...place, name: '' },
    { ...place, created_at: 2000000 },
    { ...place, created_at: NaN }
  ])
    assert.equal(validSelection(invalid, 1000001), false)
  assert.equal(validSelection(place, 1600000), false)
})
