import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import {
  closestOnWaterPath, containsWaterPoint, indexWaterSurfaces, matchWater, waterDistance,
  type MapPoint, type WaterHit, type WaterSurface
} from './water-geometry.ts'

interface WaterPath {
  id: string
  name: string
  path: MapPoint[]
  waterway: boolean
}
interface WaterTile {
  surfaces: ReturnType<typeof indexWaterSurfaces>
  paths: WaterPath[]
}
interface TileHit extends WaterHit { id: string }

const tileJson = 'https://tiles.openfreemap.org/planet'
const detailZoom = 14
const detailRadius = 2000
const tiles = new Map<string, Promise<WaterTile>>()
let source: Promise<string> | undefined
let refreshAt = 0

async function read<T>(url: string, decode: (reply: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 9000)
  try {
    const reply = await fetch(url, { signal: controller.signal, credentials: 'omit' })
    if (!reply.ok) throw new Error('Water map unavailable')
    return await decode(reply)
  } finally {
    clearTimeout(timeout)
  }
}

function tileSource() {
  if (!source || Date.now() >= refreshAt) {
    refreshAt = Date.now() + 10 * 60_000
    source = read(tileJson, reply => reply.json()).then(data => {
      const template = data?.tiles?.[0]
      if (typeof template !== 'string' ||
          !/^https:\/\/tiles\.openfreemap\.org\/planet\/[\w-]+\/\{z\}\/\{x\}\/\{y\}\.pbf$/.test(template))
        throw new Error('Invalid water map source')
      return template
    }).catch(error => {
      source = undefined
      throw error
    })
  }
  return source
}

function tilePoint(longitude: number, latitude: number, zoom: number): MapPoint {
  const grid = 2 ** zoom
  const radians = latitude * Math.PI / 180
  return [
    Math.floor((longitude + 180) / 360 * grid),
    Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * grid)
  ]
}

function readWaterTile(template: string, x: number, y: number, zoom: number) {
  const url = template.replace('{z}', String(zoom)).replace('{x}', String(x)).replace('{y}', String(y))
  const stored = tiles.get(url)
  const pending = stored ?? read(url, reply => reply.arrayBuffer())
    .then(bytes => decodeWater(bytes, x, y, zoom))
    .catch(error => {
      if (tiles.get(url) === pending) tiles.delete(url)
      throw error
    })
  tiles.delete(url)
  tiles.set(url, pending)
  if (tiles.size > 24) tiles.delete(tiles.keys().next().value!)
  return pending
}

function waterName(props: Record<string, unknown>) {
  for (const key of ['name:zh-Hans', 'name:zh', 'name', 'name:zh-Hant', 'name:en']) {
    const value = props[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 120)
  }
  return ''
}

export function decodeWater(bytes: ArrayBuffer, x: number, y: number, zoom: number): WaterTile {
  const layers = new VectorTile(new PbfReader(new Uint8Array(bytes))).layers
  const surfaces: WaterSurface[] = []
  const water = layers.water
  for (let i = 0; water && i < water.length; i++) {
    const feature = water.feature(i)
    if (feature.type !== 3 || feature.properties.brunnel === 'tunnel') continue
    const geometry = feature.toGeoJSON(x, y, zoom).geometry
    if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') continue
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
    surfaces.push({
      id: String(feature.id ?? feature.properties.id ?? `${zoom}/${x}/${y}/${i}`),
      name: waterName(feature.properties),
      coordinates: polygons as MapPoint[][][]
    })
  }
  const paths: WaterPath[] = []
  for (const layerName of ['water_name', 'waterway']) {
    const layer = layers[layerName]
    const waterway = layerName === 'waterway'
    for (let i = 0; layer && i < layer.length; i++) {
      const feature = layer.feature(i)
      if (feature.properties.brunnel === 'tunnel') continue
      const name = waterName(feature.properties)
      if (!waterway && !name) continue
      const id = String(feature.id ?? feature.properties.id ?? '')
      const geometry = feature.toGeoJSON(x, y, zoom).geometry
      const parts = geometry.type === 'MultiLineString' ? geometry.coordinates
        : geometry.type === 'LineString' ? [geometry.coordinates]
        : !waterway && geometry.type === 'Point' ? [[geometry.coordinates]]
        : !waterway && geometry.type === 'MultiPoint' ? geometry.coordinates.map(p => [p]) : []
      for (const path of parts) paths.push({ id, name, waterway, path: path as MapPoint[] })
    }
  }
  return { surfaces: indexWaterSurfaces(surfaces), paths }
}

export function matchTileWater(point: MapPoint, available: WaterTile[], maxDistanceM: number): TileHit | undefined {
  const area = matchWater(point, available.flatMap(tile => tile.surfaces), maxDistanceM)
  let closestLine: TileHit | undefined
  let label = '', labelDistance = Infinity, river = '', riverDistance = Infinity
  let sameIdName = ''
  for (const tile of available) {
    for (const item of tile.paths) {
      // Lake label anchors can be in another tile of the same OSM feature.
      if (area && !item.waterway && item.id === area.surface.id) sameIdName = item.name
      if (item.waterway && area?.distance !== 0) {
        const nearest = closestOnWaterPath(point, item.path)
        if (nearest && nearest.distance <= maxDistanceM && nearest.distance < (area?.distance ?? Infinity) &&
            nearest.distance < (closestLine?.distance ?? Infinity)) {
          closestLine = { ...nearest, id: item.id, name: item.name, line: item.path }
        }
      }
      if (!area || !item.name) continue
      const onPath = closestOnWaterPath(area.point, item.path)
      if (!onPath || !containsWaterPoint(onPath.point, area.polygon)) continue
      if (!item.waterway && onPath.distance < labelDistance) {
        label = item.name
        labelDistance = onPath.distance
      } else if (item.waterway && onPath.distance < riverDistance) {
        river = item.name
        riverDistance = onPath.distance
      }
    }
  }
  if (closestLine) return closestLine
  if (area) return {
    id: area.surface.id, point: area.point, distance: area.distance, polygon: area.polygon,
    name: area.surface.name || sameIdName || label || river
  }
}

async function lookupWaterTiles(point: MapPoint, maxDistanceM: number, zoom: number) {
  const [longitude, latitude] = point
  const dy = (maxDistanceM + 10) / 111320
  const dx = dy / Math.cos(latitude * Math.PI / 180)
  const [left, top] = tilePoint(longitude - dx, latitude + dy, zoom)
  const [right, bottom] = tilePoint(longitude + dx, latitude - dy, zoom)
  const template = await tileSource()
  const requests = []
  for (let x = left; x <= right; x++)
    for (let y = top; y <= bottom; y++) requests.push(readWaterTile(template, x, y, zoom))
  const replies = await Promise.allSettled(requests)
  const available = replies.flatMap(reply => reply.status === 'fulfilled' ? reply.value : [])
  const result = matchTileWater(point, available, maxDistanceM)
  if (available.length < replies.length) {
    if (!result || result.distance !== 0) throw new Error('Some water map tiles are unavailable')
    if (!result.name) return { ...result, nameUnavailable: true }
  }
  return result
}

/** All tile coordinates and results are WGS84. The client converts once at the map boundary. */
export async function lookupTileWater(point: MapPoint, maxDistanceM: number): Promise<WaterHit | undefined> {
  if (point[0] < 72 || point[0] > 137 || point[1] < 3 || point[1] > 55) return
  const nearby = await lookupWaterTiles(point, Math.min(maxDistanceM, detailRadius), detailZoom)
  if (nearby?.polygon && !nearby.name) {
    // A large lake's label may be many detail tiles away. Only inherit a name
    // across zoom levels when the source feature ID also identifies this water.
    const template = await tileSource()
    const parents = await Promise.allSettled([11, 8].map(zoom => {
      const [x, y] = tilePoint(...nearby.point, zoom)
      return readWaterTile(template, x, y, zoom)
    }))
    for (const reply of parents) {
      if (reply.status !== 'fulfilled') continue
      const tile = reply.value
      const label = tile.paths.find(p => !p.waterway && p.id === nearby.id)
      const parent = label ? undefined : matchTileWater(nearby.point, [tile], 0)
      const name = label?.name || (parent?.id === nearby.id ? parent.name : '')
      if (name) return { ...nearby, name, nameUnavailable: undefined }
    }
    if (parents.some(reply => reply.status === 'rejected')) return { ...nearby, nameUnavailable: true }
  }
  if (nearby || maxDistanceM <= detailRadius) return nearby

  // At a regional scale, locate a candidate with fewer tiles and verify the shore in detail.
  const zoom = maxDistanceM <= 9000 ? 12 : maxDistanceM <= 25000 ? 10 : 9
  const regional = await lookupWaterTiles(point, maxDistanceM, zoom)
  if (!regional) return
  const confirmed = await lookupWaterTiles(regional.point, 1500, detailZoom)
  if (!confirmed) return
  const distance = waterDistance(point, confirmed.point)
  if (distance <= maxDistanceM) return {
    ...confirmed, distance,
    name: confirmed.name || (confirmed.id === regional.id ? regional.name : '')
  }
}
