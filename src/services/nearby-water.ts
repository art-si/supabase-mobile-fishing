import {
  containsWaterPoint, matchingWaterPlace, type MapPoint, type WaterHit
} from '@/domain/water-geometry'
import type { WaterPlace } from '../../supabase/functions/_shared/water-places'
import { lookupMappedWater } from './water-index'
// #ifdef MP-WEIXIN
import { waterHitToGcj02, waterQueryPoint } from '@/domain/water-geometry'
import { lookupMapShoreline } from './amap'
// #endif

export interface NearbyWater extends WaterHit {
  source: 'index' | 'live' | 'amap'
}

async function onlineWater(point: MapPoint, radius: number) {
  // #ifdef H5
  const { lookupLiveWater } = await import('./live-water-map')
  return lookupLiveWater(point, radius)
  // #endif
  // #ifdef MP-WEIXIN
  return lookupMapShoreline(waterQueryPoint(point)).then(hit =>
    hit ? waterHitToGcj02(hit, point) : undefined)
  // #endif
}

/** Search previews stay local. Committed selections verify the nearest geometry and its name. */
export async function resolveNearbyWater(
  point: MapPoint, radius: number,
  readPlaces?: (anchor: MapPoint, radius: number) => Promise<WaterPlace[]>
): Promise<NearbyWater | undefined> {
  if (point[0] < 72 || point[0] > 137 || point[1] < 3 || point[1] > 55) return
  let result: NearbyWater | undefined
  let geometryFailed = false
  try {
    const match = await lookupMappedWater(point, radius)
    if (match) result = {
      name: match.surface.name, point: match.point, distance: match.distance, polygon: match.polygon, source: 'index'
    }
  } catch {
    geometryFailed = true
  }
  if (!readPlaces || (result?.distance === 0 && result.name)) return result
  try {
    const live = await onlineWater(point, radius)
    geometryFailed = false
    if (live && (!result || live.distance < result.distance)) {
      const indexedName = result?.polygon && containsWaterPoint(live.point, result.polygon) ? result.name : ''
      const name = live.name || indexedName
      result = { ...live, name, nameUnavailable: !name && live.nameUnavailable, source: 'live' }
    } else if (live?.name && result && !result.name &&
        ((live.polygon && containsWaterPoint(result.point, live.polygon)) ||
         (live.line && result.polygon && containsWaterPoint(live.point, result.polygon)))) {
      result = { ...result, name: live.name, source: 'live' }
    } else if (result && !result.name && live?.nameUnavailable) {
      result = { ...result, nameUnavailable: true }
    }
  } catch {
    geometryFailed = true
  }
  if (result?.source === 'index' && result.name) return result

  const anchor = result?.point ?? point
  const poiRadius = result ? 2000 : Math.min(2000, Math.ceil(radius))
  try {
    const places = await readPlaces(anchor, poiRadius)
    // A local map label can differ from the OSM river name. Prefer it only on
    // this geometry; a distant POI never substitutes for a nearby unnamed pond.
    const place = matchingWaterPlace(anchor, places, result?.name ? 300 : poiRadius, result)
    if (place) return result ? { ...result, name: place.name, nameUnavailable: false } : { ...place, source: 'amap' }
  } catch {
    if (result) return { ...result, nameUnavailable: !result.name }
    throw new Error('Water names unavailable')
  }
  if (geometryFailed && !result) throw new Error('Water map unavailable')
  return result && { ...result, nameUnavailable: !result.name && (result.nameUnavailable || geometryFailed) }
}
