import { isDemo } from '@/config'
import { sessionRequest } from './session'
import { ApiError } from './http'
import { serviceErrorMessage } from '@/domain/user-errors'
import type { MapPlace, MapPreviewTarget } from '@/domain/map'

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
