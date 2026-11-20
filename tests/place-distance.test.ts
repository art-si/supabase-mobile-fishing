import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placeDistanceLabel } from '../src/domain/place-distance'
import { distanceMeters } from '../src/_mobile-core/coordinates'
test('distance uses the current fix, preserves zero and never invents a denied location', () => {
  const origin = { longitude:120, latitude:30 }
  assert.equal(placeDistanceLabel(null, origin), '')
  assert.equal(placeDistanceLabel(origin, origin), '10米内')
  assert.equal(placeDistanceLabel(origin, {longitude:NaN, latitude:30}), '')
  assert.ok(Math.abs(distanceMeters([120,30],[120,30.01])! - 1112) < 1)
  assert.equal(placeDistanceLabel(origin, {longitude:120, latitude:30.01}), '1.1公里')
})
