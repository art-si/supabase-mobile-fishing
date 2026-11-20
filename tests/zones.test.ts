import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validReportBoundary, validOfficialZoneBoundary } from '../src/domain/zone-geometry'
import { readFileSync } from 'node:fs'
import {
  validZoneCircle,
  circleBounds,
  safeSourceUrl,
  fishingPolicy,
  chinaDate
} from '../src/domain/zones'
test('community circles reject invalid radius, swapped/invalid coordinates and non-finite values', () => {
  const circle = { longitude: 120.5, latitude: 31.5, radius_m: 300 }
  assert.ok(validZoneCircle(circle))
  for (const bad of [
    { radius_m: 0 },
    { radius_m: 5001 },
    { radius_m: 1.5 },
    { longitude: NaN },
    { latitude: Infinity },
    { latitude: 120.5 },
    { longitude: 180 }
  ])
    assert.equal(validZoneCircle({ ...circle, ...bad }), false)
})
test('viewport extents enclose the GCJ-02 center without claiming legal geometry', () => {
  const circle = { longitude: 120.5, latitude: 31.5, radius_m: 5000 },
    bounds = circleBounds(circle)
  assert.ok(
    bounds.west < circle.longitude &&
      bounds.east > circle.longitude &&
      bounds.south < circle.latitude &&
      bounds.north > circle.latitude
  )
  assert.ok(bounds.east - bounds.west > bounds.north - bounds.south)
})
test('source links reject scripts, credentials, local schemes and unbounded input', () => {
  assert.ok(safeSourceUrl(fishingPolicy.url))
  for (const url of [
    'javascript:alert(1)',
    'http://example.com',
    'file:///etc/test',
    'https://user:pass@example.com',
    'https://example.com/ a',
    'https://example.com/' + 'a'.repeat(1000)
  ])
    assert.equal(safeSourceUrl(url), false)
  assert.match(fishingPolicy.scope, /不是全国/)
})
test('community date defaults are explicitly China calendar dates', () => {
  assert.equal(new Date(chinaDate(1)).getTime() - new Date(chinaDate()).getTime(), 86400000)
})
test('official water shorelines support islands and detail while member drawings keep their limit', () => {
  const ring: [number, number][] = Array.from({ length: 240 }, (_, i) => [
    120 + Math.cos((i * Math.PI) / 120) * 0.01,
    31 + Math.sin((i * Math.PI) / 120) * 0.01
  ])
  ring.push([...ring[0]!])
  const hole: [number, number][] = [
    [119.999, 30.999],
    [120.001, 30.999],
    [120.001, 31.001],
    [119.999, 31.001],
    [119.999, 30.999]
  ]
  const shape = { type: 'Polygon', coordinates: [ring, hole] }
  assert.equal(validOfficialZoneBoundary(shape), true)
  assert.equal(validReportBoundary(shape), false)
  const source = JSON.parse(
    readFileSync(new URL('../data/official-zones/verified.json', import.meta.url), 'utf8')
  )
  for (const row of source.records.filter((row: { published: boolean }) => row.published)) {
    assert.ok(validOfficialZoneBoundary(row.boundary), row.id)
    assert.equal(row.provenance.water_verified, true)
    assert.ok(row.provenance.water.features.length)
    assert.match(row.source_url, /\.gov\.cn\//)
  }
})
