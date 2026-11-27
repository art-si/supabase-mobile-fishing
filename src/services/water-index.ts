import { wgs84ToGcj02 } from '@mobile-core/coordinates'
import type { MapPoint } from '@mobile-core/map'
import { containsWaterPoint, indexWaterSurfaces, matchWater, waterQueryPoint, type WaterSurface } from '@/domain/water-geometry'
import { nearestWater } from '@/domain/water-surfaces'
// #ifdef MP-WEIXIN
import { readBundledWaterIndex } from './bundled-water-index'
// #endif

const cellSize = 0.25
const cacheSize = 16
const timeoutMs = 4500
const configuredUrl = (import.meta.env.VITE_WATER_INDEX_BASE_URL || '').trim().replace(/\/+$/, '')
export const hasRemoteWaterIndex = /^https:\/\/[a-z0-9.-]+(?:\/[a-z0-9_.\/-]+)?$/i.test(configuredUrl)
const tileCache = new Map<string, Promise<ReturnType<typeof indexWaterSurfaces>>>()
let manifestPromise: Promise<{ version: string; tiles: Set<string> }> | undefined
let manifestExpiresAt = 0
let bundledIndexReader: ((path: string) => unknown) | undefined
// #ifdef MP-WEIXIN
bundledIndexReader=readBundledWaterIndex
// #endif

// Registered by the map subpackage, so public geometry is delivered through
// normal compiled module dependencies instead of unreadable raw package files.
export function registerBundledWaterIndex(reader: (path: string) => unknown) {
  bundledIndexReader = reader
}

// The index uses original OSM coordinates. The map and matching geometry use GCJ-02.
function tileKey(point: MapPoint) {
  const [longitude, latitude] = waterQueryPoint(point)
  return `${Math.floor(longitude / cellSize)}_${Math.floor(latitude / cellSize)}`
}

async function readIndexFile(path: string) {
  if (hasRemoteWaterIndex) {
    return new Promise<unknown>((resolve, reject) => {
      uni.request({
        url: `${configuredUrl}/${path}`,
        method: 'GET',
        dataType: 'json',
        timeout: timeoutMs,
        success: response => {
          if (response.statusCode === 200) resolve(response.data)
          else reject(new Error('Water index unavailable'))
        },
        fail: reject
      })
    })
  }
  // #ifdef H5
  const url = new URL(`static/web/water-index/${path}`, new URL(import.meta.env.BASE_URL, location.href))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: path === 'manifest.json' ? 'no-cache' : 'default'
    })
    if (!response.ok) throw new Error('Water index unavailable')
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
  // #endif
  // #ifdef MP-WEIXIN
  const data = bundledIndexReader?.(path)
  if (!data) throw new Error('Water index unavailable')
  return data
  // #endif
}

function loadManifest() {
  if (!manifestPromise || Date.now() >= manifestExpiresAt) {
    manifestExpiresAt = Date.now() + 10 * 60_000
    manifestPromise = readIndexFile('manifest.json').then(data => {
      const manifest = data as { version?: string; tiles?: string[] } | null
      if (!manifest?.version || !/^\d{8}T\d{6}Z$/.test(manifest.version) || !Array.isArray(manifest.tiles))
        throw new Error('Invalid water index manifest')
      return { version: manifest.version, tiles: new Set(manifest.tiles) }
    }).catch(error => {
      manifestPromise = undefined
      throw error
    })
  }
  return manifestPromise
}

function loadTile(version: string, key: string) {
  const path = `${version}/${key}.json`
  const cached = tileCache.get(path)
  const pending = cached ?? readIndexFile(path).then(data =>
    indexWaterSurfaces((data as WaterSurface[]).map(surface => ({
      ...surface,
      coordinates: surface.coordinates.map(polygon => polygon.map(ring =>
        ring.map(([longitude, latitude]) => wgs84ToGcj02(longitude, latitude))
      ))
    })))
  ).catch(error => {
    if (tileCache.get(path) === pending) tileCache.delete(path)
    throw error
  })
  tileCache.delete(path)
  tileCache.set(path, pending)
  if (tileCache.size > cacheSize) tileCache.delete(tileCache.keys().next().value!)
  return pending
}

export async function lookupWaterIndex(point: MapPoint, maxDistanceM: number) {
  const manifest = await loadManifest()
  const key = tileKey(point)
  if (!manifest.tiles.has(key)) return undefined
  return matchWater(point, await loadTile(manifest.version, key), maxDistanceM)
}

// Both sources match in GCJ-02. A land point is only a search origin.
export async function lookupMappedWater(point: MapPoint, maxDistanceM: number) {
  const local = nearestWater(point, maxDistanceM)
  if (local?.distance === 0 && local.surface.name) return local
  try {
    const indexed = await lookupWaterIndex(point, maxDistanceM)
    if (!indexed) return local
    if (local && local.distance <= indexed.distance) {
      if (!local.surface.name && indexed.surface.name && containsWaterPoint(local.point, indexed.polygon))
        return { ...local, surface: { ...local.surface, name: indexed.surface.name } }
      return local
    }
    if (!indexed.surface.name && local?.surface.id === indexed.surface.id)
      return { ...indexed, surface: { ...indexed.surface, name: local.surface.name } }
    return indexed
  } catch (cause) {
    if (local) return local
    throw cause
  }
}
