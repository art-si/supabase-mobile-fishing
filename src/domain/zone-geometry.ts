import type { MapPoint } from '@mobile-core/map'

export type ZoneBoundary =
  | { type: 'Polygon'; coordinates: MapPoint[][] }
  | { type: 'MultiPolygon'; coordinates: MapPoint[][][] }

export function boundaryPaths(boundary?: ZoneBoundary | null): MapPoint[][][] {
  if (!boundary) return []
  return boundary.type === 'Polygon' ? [boundary.coordinates] : boundary.coordinates
}
const cross = (a: MapPoint, b: MapPoint, c: MapPoint) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
function intersects(a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint) {
  if (
    Math.max(a[0], b[0]) < Math.min(c[0], d[0]) ||
    Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
    Math.max(a[1], b[1]) < Math.min(c[1], d[1]) ||
    Math.max(c[1], d[1]) < Math.min(a[1], b[1])
  )
    return false
  return cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0
}
export function reportBoundary(points: MapPoint[]): ZoneBoundary {
  return {
    type: 'Polygon',
    coordinates: [points.length ? [...points.map((p): MapPoint => [...p]), [...points[0]!]] : []]
  }
}
/** Reports must describe a simple water-surface polygon, never a location accuracy circle. */
export function validReportBoundary(value: unknown, maxDiagonalM = 10000): value is ZoneBoundary {
  return validPolygonBoundary(value, maxDiagonalM, 120, 1)
}
/** Government polygons clipped to a water surface can retain shoreline detail and islands. */
export function validOfficialZoneBoundary(value: unknown): value is ZoneBoundary {
  return validPolygonBoundary(value, 1000000, 4000, 64)
}
function validPolygonBoundary(
  value: unknown,
  maxDiagonalM: number,
  maxVertices: number,
  maxRings: number
): value is ZoneBoundary {
  if (!value || typeof value !== 'object') return false
  const boundary = value as ZoneBoundary
  if (
    boundary.type !== 'Polygon' ||
    !Array.isArray(boundary.coordinates) ||
    boundary.coordinates.length < 1 ||
    boundary.coordinates.length > maxRings
  )
    return false
  return boundary.coordinates.every((ring) => validZoneRing(ring, maxDiagonalM, maxVertices))
}
function validZoneRing(ring: MapPoint[], maxDiagonalM: number, maxVertices: number) {
  if (!Array.isArray(ring) || ring.length < 4 || ring.length > maxVertices + 1) return false
  if (
    !ring.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every(Number.isFinite) &&
        p[0] >= 73 &&
        p[0] <= 136 &&
        p[1] >= 3 &&
        p[1] <= 54
    )
  )
    return false
  if (ring[0]![0] !== ring.at(-1)![0] || ring[0]![1] !== ring.at(-1)![1]) return false
  const points = ring.slice(0, -1)
  if (new Set(points.map((p) => p.join(','))).size !== points.length) return false
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const a = ring[i]!,
      b = ring[i + 1]!
    area +=
      (a[0] - ring[0]![0]) * (b[1] - ring[0]![1]) - (b[0] - ring[0]![0]) * (a[1] - ring[0]![1])
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue
      if (intersects(a, b, ring[j]!, ring[j + 1]!)) return false
    }
  }
  const bounds = boundaryBounds({ type: 'Polygon', coordinates: [ring] })
  const metresX = (bounds.east - bounds.west) * 111320 * Math.cos((ring[0]![1] * Math.PI) / 180)
  const metresY = (bounds.north - bounds.south) * 111320
  return (Math.abs(area) * 111320 ** 2) / 2 > 25 && Math.hypot(metresX, metresY) <= maxDiagonalM
}
export function boundaryBounds(boundary: ZoneBoundary) {
  const points = boundaryPaths(boundary).flat(2)
  return {
    west: Math.min(...points.map((p) => p[0])),
    east: Math.max(...points.map((p) => p[0])),
    south: Math.min(...points.map((p) => p[1])),
    north: Math.max(...points.map((p) => p[1]))
  }
}
/** A scan-line interior point keeps the label inside a concave river/lake outline. */
export function boundaryAnchor(boundary: ZoneBoundary): MapPoint {
  let best: MapPoint | undefined,
    width = -1
  for (const polygon of boundaryPaths(boundary)) {
    const outer = polygon[0]!
    const ys = outer.map((p) => p[1])
    for (const ratio of [0.5, 0.25, 0.75]) {
      const y = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * ratio
      const xs: number[] = []
      for (const ring of polygon)
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1]!,
            b = ring[i]!
          if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]))
        }
      xs.sort((a, b) => a - b)
      for (let i = 0; i + 1 < xs.length; i += 2)
        if (xs[i + 1]! - xs[i]! > width) {
          width = xs[i + 1]! - xs[i]!
          best = [(xs[i]! + xs[i + 1]!) / 2, y]
        }
    }
  }
  return best || [...boundaryPaths(boundary)[0]![0]![0]!]
}
