import { validCoordinates } from './rules'
import type { MapPoint } from '@mobile-core/map'
export interface MapPlace {
  id: string
  name: string
  address: string
  longitude: number
  latitude: number
  crs: 'GCJ-02'
  adcode?: string
  source?: 'share'
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
  kind?: 'water'
}
export function placeSelection([longitude, latitude]: MapPoint, place?: Pick<SelectedPlace, 'name' | 'address' | 'adcode'>): SelectedPlace {
  return {
    longitude, latitude, name: place?.name.trim().slice(0, 120) || '已选位置',
    address: place?.address?.trim().slice(0, 240), adcode: place?.adcode,
    crs: 'GCJ-02', created_at: Date.now()
  }
}
export function waterSelection([longitude, latitude]: MapPoint, name: string, nameUnavailable = false): SelectedPlace {
  return {
    longitude,
    latitude,
    name: name.trim().slice(0, 120) || (nameUnavailable ? '水域名称待确认' : '未命名水域'),
    kind: 'water',
    crs: 'GCJ-02',
    created_at: Date.now()
  }
}
export function formatMapCoordinates(longitude: number, latitude: number) {
  return `经度 ${longitude.toFixed(6)}，纬度 ${latitude.toFixed(6)}`
}
export type MapPreviewTarget = (
  | { spotId: string }
  | { longitude: number; latitude: number; radiusM?: number; viewport?: { width: number; height: number }; density?: 1 | 2 }
) & { hideMarker?: true }
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
