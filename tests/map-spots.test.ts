import test from 'node:test'
import assert from 'node:assert/strict'
import { sameMapBounds, mapSpotsHint } from '../src/domain/map-spots'
import type { MapSpot } from '../src/domain/map-spots'
import { groupMapSpots, groupExpansionZoom } from '../src/domain/map-clusters'
test('map viewport comparison tolerates numerical jitter but not a new waterbody', () => {
  const box = { west: 120, east: 121, south: 31, north: 32 }
  assert.equal(sameMapBounds(box, { ...box }), true)
  assert.equal(sameMapBounds(box, { ...box, west: 120.00000001 }), true)
  assert.equal(sameMapBounds(box, { ...box, west: 120.01 }), false)
  assert.equal(sameMapBounds(null, box), false)
})
test('map result guidance distinguishes empty, oversized and capped views', () => {
  const data = { items: [], truncated: false, zoom_in: false }
  assert.match(mapSpotsHint(data), /没有可见钓位/)
  assert.match(mapSpotsHint({ ...data, truncated: true }), /100/)
  assert.match(mapSpotsHint({ ...data, zoom_in: true }), /放大地图/)
  assert.doesNotMatch(mapSpotsHint(data), /允许垂钓|安全/)
})

const point = (id: string, longitude: number, latitude = 31): MapSpot => ({
  id,
  longitude,
  latitude,
  name: id,
  city: '',
  water_type: '',
  precision: 'area',
  own: false,
  crs: 'GCJ-02'
})
test('dense authorized pins group once, stay stable across result ordering, and split on zoom', () => {
  const spots = [point('a', 120), point('b', 120.0001), point('c', 120.001)]
  const project = (spot: MapSpot) => ({ x: (spot.longitude - 120) * 100000, y: 100 })
  const groups = groupMapSpots(spots, project)
  assert.deepEqual(
    groups.map((g) => g.spots.map((s) => s.id)),
    [['a', 'b'], ['c']]
  )
  assert.deepEqual(groupMapSpots([...spots].reverse(), project), groups)
  assert.deepEqual(groupMapSpots([...spots, spots[0]!], project), groups)
  assert.equal(groupMapSpots(spots, (s) => ({ x: project(s).x * 8, y: 100 })).length, 3)
  assert.equal(groupExpansionZoom(groups[0]!, 14), 15)
  assert.equal(groupExpansionZoom(groups[0]!, 19.5), 20)
  assert.equal(groupExpansionZoom(groups[0]!, 20), null)
  assert.equal(groupExpansionZoom(groups[1]!, 14), null)
  assert.deepEqual(
    spots.map((s) => s.longitude),
    [120, 120.0001, 120.001]
  )
})
test('co-located area pins offer a choice instead of an endless zoom or fabricated precision', () => {
  const spots = [point('a', 120), point('b', 120)]
  const [group] = groupMapSpots(spots, () => ({ x: 10, y: 10 }))
  assert.equal(groupExpansionZoom(group!, 12), null)
  assert.equal(group!.anchor, spots[0])
  assert.deepEqual(group!.spots, spots)
  assert.deepEqual(
    groupMapSpots(spots, () => ({ x: NaN, y: 0 })),
    []
  )
  assert.deepEqual(
    groupMapSpots([], () => {
      throw Error('must not project absent data')
    }),
    []
  )
})
