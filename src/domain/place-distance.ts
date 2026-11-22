import { distanceMeters } from '@mobile-core/coordinates'
import { validCoordinates } from './rules'

export function fishingMapPoint(longitude: unknown, latitude: unknown): [number, number] | undefined {
  if (typeof longitude !== 'number' || typeof latitude !== 'number' || !validCoordinates(longitude, latitude) ||
      longitude < 73 || longitude > 136 || latitude < 3 || latitude > 54) return
  return [longitude, latitude]
}

export function fishingDistanceOrigin(point: { longitude: number; latitude: number; accuracyM?: number }) {
  if (point.accuracyM !== undefined &&
      (!Number.isFinite(point.accuracyM) || point.accuracyM < 0 || point.accuracyM > 25_000)) return
  return fishingMapPoint(point.longitude, point.latitude)
}
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
export function distanceLabel(metres: number, unit?: 'km') {
  if (!Number.isFinite(metres) || metres < 0) return ''
  if (unit === 'km') {
    const precision = metres < 1000 ? 3 : metres < 10000 ? 1 : 0
    return `${Number((metres / 1000).toFixed(precision))} km`
  }
  if (metres < 10) return '10米内'
  if (metres < 1000) return `${Math.round(metres / 10) * 10}米`
  return `${metres < 10000 ? (metres / 1000).toFixed(1) : Math.round(metres / 1000)}公里`
}
