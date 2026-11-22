import { test } from 'node:test'
import assert from 'node:assert/strict'
import { distanceLabel, fishingDistanceOrigin, fishingMapPoint, placeDistanceLabel } from '../src/domain/place-distance'
import { distanceMeters } from '../src/_mobile-core/coordinates'
test('distance uses the current fix, preserves zero and never invents a denied location', () => {
  const origin = { longitude:120, latitude:30 }
  assert.equal(placeDistanceLabel(null, origin), '')
  assert.equal(placeDistanceLabel(origin, origin), '10米内')
  assert.equal(placeDistanceLabel(origin, {longitude:NaN, latitude:30}), '')
  assert.ok(Math.abs(distanceMeters([120,30],[120,30.01])! - 1112) < 1)
  assert.equal(placeDistanceLabel(origin, {longitude:120, latitude:30.01}), '1.1公里')
})

test('spot cards express all supported distances in kilometres', () => {
  assert.equal(distanceLabel(0, 'km'), '0 km')
  assert.equal(distanceLabel(125, 'km'), '0.125 km')
  assert.equal(distanceLabel(1940, 'km'), '1.9 km')
  assert.equal(distanceLabel(17200, 'km'), '17 km')
  assert.equal(distanceLabel(NaN, 'km'), '')
  assert.equal(distanceLabel(-1, 'km'), '')
})

test('nearby spots require a usable domestic coordinate and a reliable origin', () => {
  assert.deepEqual(fishingMapPoint(114.18, 30.50), [114.18, 30.50])
  assert.deepEqual(fishingMapPoint(87.62, 43.82), [87.62, 43.82])
  assert.equal(fishingMapPoint(null, 30.50), undefined)
  assert.equal(fishingMapPoint(30.50, 114.18), undefined)
  assert.equal(fishingMapPoint(0, 0), undefined)
  assert.equal(fishingDistanceOrigin({ longitude: -122.4, latitude: 37.8, accuracyM: 20 }), undefined)
  assert.equal(fishingDistanceOrigin({ longitude: 114.18, latitude: 30.50, accuracyM: 50_000 }), undefined)
  assert.deepEqual(fishingDistanceOrigin({ longitude: 114.18, latitude: 30.50, accuracyM: 1500 }), [114.18, 30.50])
})
