import type { MapPoint } from '@mobile-core/map'
import type { ZoneBoundary } from './zone-geometry'
import { indexWaterSurfaces, matchWater, type WaterSurface } from './water-geometry'
import wuhan from './data/wuhan-water-surfaces.json'

const surfaces = indexWaterSurfaces(wuhan as WaterSurface[])

export function nearestWater(point: MapPoint, maxDistanceM = 2000) {
  return matchWater(point, surfaces, maxDistanceM)
}

export function waterOutline(name: string): ZoneBoundary | null {
  const coordinates = surfaces.filter(surface => surface.name === name).flatMap(surface => surface.coordinates)
  if (!coordinates.length) return null
  return coordinates.length === 1
    ? { type: 'Polygon', coordinates: coordinates[0]! }
    : { type: 'MultiPolygon', coordinates }
}
