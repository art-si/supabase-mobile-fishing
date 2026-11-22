import type { MapPoint } from '@mobile-core/map'
import { wgs84ToGcj02 } from '@mobile-core/coordinates'
import type { WaterHit } from '../../supabase/functions/_shared/water-geometry'
import { closestOnWaterPath, containsWaterPoint, waterDistance } from '../../supabase/functions/_shared/water-geometry'
import type { WaterPlace } from '../../supabase/functions/_shared/water-places'
export * from '../../supabase/functions/_shared/water-geometry'

export function waterQueryPoint([lng, lat]: MapPoint): MapPoint {
  let longitude = lng, latitude = lat
  for (let i = 0; i < 3; i++) {
    const converted = wgs84ToGcj02(longitude, latitude)
    longitude += lng - converted[0]
    latitude += lat - converted[1]
  }
  return [longitude, latitude]
}

export function waterHitToGcj02(hit: WaterHit, origin: MapPoint): WaterHit {
  const convert = ([lng, lat]: MapPoint) => wgs84ToGcj02(lng, lat)
  return {
    ...hit, point: hit.distance === 0 ? origin : convert(hit.point),
    polygon: hit.polygon?.map(ring => ring.map(convert)),
    line: hit.line?.map(convert)
  }
}

export function matchingWaterPlace(anchor: MapPoint, places: WaterPlace[], radius: number, hit?: WaterHit) {
  let best: { name: string; point: MapPoint; distance: number } | undefined
  for (const place of places) {
    const distance = waterDistance(anchor, place.point)
    if (distance > radius || (best && distance >= best.distance)) continue
    if (hit?.polygon && !containsWaterPoint(place.point, hit.polygon)) continue
    if (hit?.line && (!place.flowing || (closestOnWaterPath(place.point, hit.line)?.distance ?? Infinity) > 10)) continue
    best = { name: place.name, point: place.point, distance }
  }
  return best
}

export function waterTapRadiusM(latitude: number, zoom: number, screenPixels: number) {
  if (!Number.isFinite(zoom)) return 150
  const metersPerPixel = 156543.034 * Math.cos(latitude * Math.PI / 180) / 2 ** zoom
  const limit = zoom >= 14 ? 2000 : 60000
  return Math.max(150, Math.min(limit, metersPerPixel * screenPixels))
}
