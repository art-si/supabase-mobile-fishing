import type { MapSpot } from './map-spots'

export interface MapSpotGroup {
  /** An already-authorized point, never a reconstructed exact location. */
  anchor: MapSpot
  spots: MapSpot[]
}

/** Group the bounded, authorized viewport result using the map's screen projection.
 * Stable seeds keep each marker at least radius pixels from every other marker.
 * There are at most 100 points; no provider plugin or additional coordinate read.
 */
export function groupMapSpots(
  spots: readonly MapSpot[],
  project: (spot: MapSpot) => { x: number; y: number },
  radius = 64
): MapSpotGroup[] {
  const groups: Array<MapSpotGroup & { x: number; y: number }> = []
  const seen = new Set<string>()
  for (const spot of [...spots].sort((a, b) => a.id.localeCompare(b.id))) {
    if (seen.has(spot.id)) continue
    seen.add(spot.id)
    const { x, y } = project(spot)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const group = groups.find((item) => Math.hypot(item.x - x, item.y - y) < radius)
    if (group) group.spots.push(spot)
    else groups.push({ anchor: spot, spots: [spot], x, y })
  }
  return groups.map(({ anchor, spots }) => ({ anchor, spots }))
}

export function groupExpansionZoom(group: MapSpotGroup, zoom: number, maxZoom = 20) {
  if (group.spots.length < 2 || !Number.isFinite(zoom) || zoom >= maxZoom) return null
  // Stable area grids and genuinely co-located points cannot be separated by zoom.
  if (
    group.spots.every(
      (spot) => spot.longitude === group.anchor.longitude && spot.latitude === group.anchor.latitude
    )
  )
    return null
  return Math.min(maxZoom, Math.floor(zoom) + 1)
}
