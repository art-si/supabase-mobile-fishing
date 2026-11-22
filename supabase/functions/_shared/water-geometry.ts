export type MapPoint = [number, number]

export interface WaterSurface {
  id: string
  name: string
  coordinates: MapPoint[][][]
}

export interface WaterHit {
  point: MapPoint
  distance: number
  name: string
  nameUnavailable?: boolean
  polygon?: MapPoint[][]
  line?: MapPoint[]
}

const metersPerDegree = 111320
const longitudeScale = (latitude: number) => metersPerDegree * Math.cos(latitude * Math.PI / 180)

export function waterDistance(a: MapPoint, b: MapPoint) {
  return Math.hypot((b[0] - a[0]) * longitudeScale(a[1]), (b[1] - a[1]) * metersPerDegree)
}

export function indexWaterSurfaces(surfaces: WaterSurface[]) {
  return surfaces.map(surface => {
    const bounds = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity }
    for (const polygon of surface.coordinates) {
      for (const [x, y] of polygon[0] || []) {
        bounds.west = Math.min(bounds.west, x)
        bounds.east = Math.max(bounds.east, x)
        bounds.south = Math.min(bounds.south, y)
        bounds.north = Math.max(bounds.north, y)
      }
    }
    return { ...surface, bounds }
  })
}

function ringContains(point: MapPoint, ring: MapPoint[]) {
  let inside = false
  for (let i = 1; i < ring.length; i++) {
    const [x, y] = ring[i - 1]!
    const [x2, y2] = ring[i]!
    if ((y > point[1]) !== (y2 > point[1]) &&
        point[0] < x + (x2 - x) * (point[1] - y) / (y2 - y)) inside = !inside
  }
  return inside
}

export const containsWaterPoint = (point: MapPoint, polygon: MapPoint[][]) =>
  ringContains(point, polygon[0]!) && !polygon.slice(1).some(ring => ringContains(point, ring))

function projectSegment(point: MapPoint, a: MapPoint, b: MapPoint, mx: number) {
  const x = (a[0] - point[0]) * mx, y = (a[1] - point[1]) * metersPerDegree
  const dx = (b[0] - a[0]) * mx, dy = (b[1] - a[1]) * metersPerDegree
  const length2 = dx * dx + dy * dy
  const t = length2 ? Math.max(0, Math.min(1, -(x * dx + y * dy) / length2)) : 0
  const projected: MapPoint = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  return { point: projected, distance: Math.hypot(x + dx * t, y + dy * t) }
}

export function closestOnWaterPath(point: MapPoint, path: MapPoint[]) {
  if (!path.length) return undefined
  const mx = longitudeScale(point[1])
  let closest = { point: path[0]!, distance: waterDistance(point, path[0]!) }
  for (let i = 1; i < path.length; i++) {
    const projected = projectSegment(point, path[i - 1]!, path[i]!, mx)
    if (projected.distance < closest.distance) closest = projected
  }
  return closest
}

function pointInsideShore(shore: MapPoint, polygon: MapPoint[][], mx: number, my: number) {
  for (const meters of [5, 1, 0.25]) {
    for (let step = 0; step < 8; step++) {
      const angle = step * Math.PI / 4
      const inset: MapPoint = [
        shore[0] + meters * Math.cos(angle) / mx,
        shore[1] + meters * Math.sin(angle) / my
      ]
      if (containsWaterPoint(inset, polygon)) return inset
    }
  }
}

export function matchWater(
  point: MapPoint,
  candidates: ReturnType<typeof indexWaterSurfaces>,
  maxDistanceM: number
) {
  const mx = longitudeScale(point[1]), my = metersPerDegree
  let best: { point: MapPoint; surface: WaterSurface; polygon: MapPoint[][]; distance: number } | undefined
  for (const surface of candidates) {
    const { west, east, south, north } = surface.bounds
    if (point[0] < west - maxDistanceM / mx || point[0] > east + maxDistanceM / mx ||
        point[1] < south - maxDistanceM / my || point[1] > north + maxDistanceM / my) continue
    for (const polygon of surface.coordinates) {
      if (containsWaterPoint(point, polygon)) return { point, surface, polygon, distance: 0 }
      // Project onto complete shoreline segments, including shores of islands.
      for (const ring of polygon) {
        for (let i = 1; i < ring.length; i++) {
          const { point: shore, distance } = projectSegment(point, ring[i - 1]!, ring[i]!, mx)
          if (distance > (best?.distance ?? maxDistanceM)) continue
          const inset = pointInsideShore(shore, polygon, mx, my)
          if (inset) best = { point: inset, surface, polygon, distance }
        }
      }
    }
  }
  return best
}
