import { validCoordinates } from './rules'
export interface MapPlace {
  id: string
  name: string
  address: string
  longitude: number
  latitude: number
  crs: 'GCJ-02'
  adcode?: string
}
export interface SelectedPlace {
  longitude: number
  latitude: number
  name: string
  address?: string
  crs: 'GCJ-02'
  created_at: number
  accuracyM?: number
  adcode?: string
}
export type MapPreviewTarget =
  | { spotId: string }
  | { longitude: number; latitude: number; radiusM?: number }
export function validSelection(value: unknown, now = Date.now()): value is SelectedPlace {
  if (!value || typeof value !== 'object') return false
  const p = value as SelectedPlace
  return (
    p.crs === 'GCJ-02' &&
    validCoordinates(p.longitude, p.latitude) &&
    typeof p.name === 'string' &&
    p.name.trim().length > 0 &&
    p.name.length <= 120 &&
    (p.address === undefined || (typeof p.address === 'string' && p.address.length <= 240)) &&
    typeof p.created_at === 'number' &&
    Number.isFinite(p.created_at) &&
    now >= p.created_at &&
    now - p.created_at < 600000
  )
}
