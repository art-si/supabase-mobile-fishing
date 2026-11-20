import { distanceMeters } from '@mobile-core/coordinates'
export function placeDistanceLabel(
  origin: { longitude: number; latitude: number } | null,
  place: { longitude: number; latitude: number }
) {
  if (!origin) return ''
  const metres = distanceMeters(
    [origin.longitude, origin.latitude],
    [place.longitude, place.latitude]
  )
  if (metres === undefined) return ''
  return distanceLabel(metres)
}
export function distanceLabel(metres: number) {
  if (!Number.isFinite(metres) || metres < 0) return ''
  if (metres < 10) return '10米内'
  if (metres < 1000) return `${Math.round(metres / 10) * 10}米`
  return `${metres < 10000 ? (metres / 1000).toFixed(1) : Math.round(metres / 1000)}公里`
}
