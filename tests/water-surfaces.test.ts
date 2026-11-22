import assert from 'node:assert/strict'
import test from 'node:test'
import { indexWaterSurfaces, matchingWaterPlace, matchWater, waterTapRadiusM, type MapPoint } from '../src/domain/water-geometry'
import { matchTileWater } from '../supabase/functions/_shared/water-tiles'
import { waterPlace } from '../supabase/functions/_shared/water-places'
import { nearestWater, waterOutline } from '../src/domain/water-surfaces'
import { boundaryAnchor, boundaryPaths, validReportBoundary } from '../src/domain/zone-geometry'

test('a land tap south of North Taizi Lake snaps to a mapped point in the water', () => {
  const match = nearestWater([114.194, 30.508])!
  assert.equal(match.surface.name, '北太子湖')
  assert.ok(match.distance > 400 && match.distance < 550)
  assert.equal(nearestWater(match.point)?.distance, 0)
  assert.equal(nearestWater([116.4, 39.9]), undefined)
  assert.equal(validReportBoundary(waterOutline('北太子湖')), true)
})

test('water taps stay put and holes are excluded from the lake surface', () => {
  const water = boundaryAnchor(waterOutline('北太子湖')!)
  assert.deepEqual(nearestWater(water)?.point, water)
  const hole = boundaryPaths(waterOutline('汤湖'))[0]![1]!
  const islandPoint = boundaryAnchor({ type: 'Polygon', coordinates: [hole] })
  const match = nearestWater(islandPoint)!
  assert.equal(match.surface.name, '汤湖')
  assert.ok(match.distance > 0)
  assert.equal(nearestWater(match.point)?.distance, 0)
  assert.equal(validReportBoundary(waterOutline('汤湖')), false)
})

test('both banks beside the Fangdao shopping center snap to Phoenix Lake', () => {
  for (const shore of [[114.205836, 30.528699], [114.207338, 30.528514]] as [number, number][]) {
    const match = nearestWater(shore, 150)!
    assert.equal(match.surface.id, 'way/879986063')
    assert.ok(match.distance > 0 && match.distance < 50)
    assert.equal(nearestWater(match.point, 0)?.distance, 0)
  }
  const water: [number, number] = [114.20634, 30.528329]
  assert.deepEqual(nearestWater(water, 0)?.point, water)
  assert.equal(nearestWater([114.194, 30.508], 150), undefined)
})

test('a narrow indexed waterway can be selected from land', () => {
  const surfaces = indexWaterSurfaces([{
    id: 'test-narrow-water',
    name: '',
    coordinates: [[[
      [114, 30], [114.00002, 30], [114.00002, 30.00008], [114, 30.00008], [114, 30]
    ]]]
  }])
  const result = matchWater([114.00012, 30.00004], surfaces, 150)!
  assert.equal(result.surface.id, 'test-narrow-water')
  assert.ok(result.point[0] > 114 && result.point[0] < 114.00002)
  assert.equal(matchWater(result.point, surfaces, 0)?.distance, 0)
})

test('a regional map tap can reach the visible shore while a close-up tap stays local', () => {
  assert.ok(waterTapRadiusM(30.9, 13, 112) > 1700)
  assert.equal(waterTapRadiusM(30.9, 17, 112), 150)
  assert.equal(waterTapRadiusM(30.9, 4, 112), 60000)
})

const riverBank: MapPoint[][] = [[
  [114, 30], [114.01, 30], [114.01, 30.001], [114, 30.001], [114, 30]
]]
const riverTap: MapPoint = [114.004, 30.0004]
const riverSurface = indexWaterSurfaces([{ id: 'bank', name: '', coordinates: [riverBank] }])
const riverPath = {
  id: 'river-way', name: '通顺河', waterway: true, path: [[114, 30.0005], [114.01, 30.0005]] as MapPoint[]
}
test('river centerlines name the selected reach while a neighboring lake stays separate', () => {
  const neighbor = { id: 'lake', name: '竹林湖', waterway: false, path: [[114.004, 30.0011]] as MapPoint[] }
  const tile = { surfaces: riverSurface, paths: [neighbor, riverPath] }
  const result = matchTileWater(riverTap, [tile], 2000)!
  assert.equal(result.name, '通顺河')
  assert.deepEqual(result.point, riverTap)
  assert.equal(result.polygon, riverBank)
  assert.equal(matchTileWater(riverTap, [{ ...tile, paths: [neighbor] }], 2000)?.name, '')
})

test('a lake label can be a line or an anchor in another tile of the same feature', () => {
  const lake = { ...riverPath, id: 'lake-label', name: '密云水库', waterway: false }
  assert.equal(matchTileWater(riverTap, [{ surfaces: riverSurface, paths: [lake, riverPath] }], 100)?.name, '密云水库')
  const remoteLabel = { ...lake, id: 'bank', path: [[114.1, 30.002]] as MapPoint[] }
  const tiles = [{ surfaces: riverSurface, paths: [] }, { surfaces: [], paths: [remoteLabel] }]
  assert.equal(matchTileWater(riverTap, tiles, 100)?.name, '密云水库')
  assert.equal(matchTileWater(riverTap, [tiles[1]!], 20000), undefined)
})

test('a mapped stream with no area snaps to the actual line within the tap radius', () => {
  const tile = { surfaces: [], paths: [riverPath] }
  const result = matchTileWater(riverTap, [tile], 30)!
  assert.equal(result.name, '通顺河')
  assert.equal(result.line, riverPath.path)
  assert.deepEqual(result.point, [114.004, 30.0005])
  assert.equal(result.polygon, undefined)
  assert.equal(matchTileWater(riverTap, [tile], 5), undefined)
})

test('only names on the selected water qualify, including when AMap and OSM use different names', () => {
  const place = (name: string, location: MapPoint, type = '地名地址信息;自然地名;河流') =>
    waterPlace(name, type, ...location)!
  const nearbyLake = place('竹林湖', [114.004, 30.0012], '地名地址信息;自然地名;湖泊')
  const namedRiver = place('东荆河', [114.005, 30.0005])
  const hit = { name: '', point: riverTap, distance: 0, polygon: riverBank }
  assert.equal(matchingWaterPlace(riverTap, [nearbyLake, namedRiver], 2000, hit)?.name, '东荆河')
  assert.equal(matchingWaterPlace(riverTap, [nearbyLake], 2000, hit), undefined)
  const island: MapPoint[] = [[114.0048,30.0003], [114.0052,30.0003], [114.0052,30.0007], [114.0048,30.0007], [114.0048,30.0003]]
  assert.equal(matchingWaterPlace(riverTap, [namedRiver], 2000, { ...hit, polygon: [...riverBank, island] }), undefined)
  assert.equal(matchingWaterPlace(riverTap, [nearbyLake], 2000, { ...hit, polygon: undefined, line: riverPath.path }), undefined)
  assert.equal(place('东荆河路', riverTap, '地名地址信息;交通地名;道路名'), undefined)
  assert.equal(place('东荆河钓场', riverTap, '体育休闲服务;休闲场所;垂钓园'), undefined)
  assert.equal(place('某某水库管理处', riverTap, '地名地址信息;自然地名;自然地名'), undefined)
  assert.equal(place('某某水库', riverTap, '地名地址信息;自然地名;自然地名').name, '某某水库')
})
