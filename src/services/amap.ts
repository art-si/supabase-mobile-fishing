import { isDemo } from '@/config'
import { sessionRequest } from './session'
import { ApiError } from './http'
import { serviceErrorMessage } from '@/domain/user-errors'
import type { MapPlace, MapPreviewTarget } from '@/domain/map'
import type { MapPoint, WaterHit } from '@/domain/water-geometry'
import type { WaterPlace } from '../../supabase/functions/_shared/water-places'

export interface StaticPreview {
  image: string
  width: number
  height: number
  zoom: number
  precision: 'exact' | 'area'
}
async function call<T>(data: unknown) {
  if (isDemo)
    throw new ApiError(serviceErrorMessage('MAP_DEMO_UNAVAILABLE')!, 0, 'MAP_DEMO_UNAVAILABLE')
  return sessionRequest<T>('/functions/v1/amap', { method: 'POST', data })
}
export function searchMapPlaces(query: string, city: string, page = 1) {
  return call<{ items: MapPlace[]; hasMore: boolean }>({
    action: 'search',
    query: query.trim(),
    city: city.trim(),
    page
  })
}
export function lookupMapRegion(longitude: number, latitude: number) {
  return call<{ province: string; city: string; district: string; adcode: string; citycode: string }>({
    action: 'region', longitude, latitude
  })
}
export async function searchMapWaterPlaces([longitude, latitude]: MapPoint, radius: number) {
  const result = await call<{ items: WaterPlace[] }>({ action: 'water-places', longitude, latitude, radius })
  return result.items
}

export async function lookupMapShoreline([longitude, latitude]: MapPoint) {
  const result = await call<{ water: WaterHit | null }>({ action: 'shoreline', longitude, latitude, crs: 'WGS84' })
  return result.water
}
export async function getStaticPreview(target: MapPreviewTarget, zoom: number) {
  const result = await call<StaticPreview>({ action: 'preview', ...target, zoom })
  if (
    !result ||
    typeof result.image !== 'string' ||
    !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(result.image) ||
    result.image.length > 710000
  )
    throw new ApiError(serviceErrorMessage('MAP_RESPONSE_INVALID')!, 502, 'MAP_RESPONSE_INVALID')
  return result
}
