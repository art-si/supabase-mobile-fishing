import { sessionRequest, sessionScope } from './session'
import { ApiError } from './http'
import { serviceErrorMessage } from '@/domain/user-errors'
import type { MapPlace, MapPreviewTarget } from '@/domain/map'
import type { MapPoint, WaterHit } from '@/domain/water-geometry'
import type { WaterPlace } from '../../supabase/functions/_shared/water-places'
import type { UploadSignal } from '@mobile-core/upload-progress'

export interface StaticPreview {
  image: string
  width: number
  height: number
  zoom: number
  precision: 'exact' | 'area'
  density?: 1 | 2
}
const cacheable = new Set(['region', 'water-places', 'shoreline'])
const mapFacts = new Map<string, { expires: number; value: unknown }>()
const pendingFacts = new Map<string, Promise<unknown>>()
let factOwner = sessionScope.value
async function call<T>(data: unknown, signal?: UploadSignal): Promise<T> {
  const action = data && typeof data === 'object' && 'action' in data ? String(data.action) : ''
  if (!cacheable.has(action)) return sessionRequest<T>('/functions/v1/amap', { method: 'POST', data, ...(action === 'preview' && signal ? { signal } : {}) })
  const owner = sessionScope.value
  if (owner !== factOwner) {
    mapFacts.clear()
    pendingFacts.clear()
    factOwner = owner
  }
  // Provider facts only, held in memory for this session; no private map previews.
  const key = JSON.stringify(data)
  const cached = mapFacts.get(key)
  if (cached && cached.expires > Date.now()) return cached.value as T
  const pending = pendingFacts.get(key)
  if (pending) return pending as Promise<T>
  const request = sessionRequest<T>('/functions/v1/amap', { method: 'POST', data }).then(value => {
    if (owner === sessionScope.value) {
      mapFacts.delete(key)
      mapFacts.set(key, { expires: Date.now() + 10 * 60_000, value })
      if (mapFacts.size > 12) mapFacts.delete(mapFacts.keys().next().value!)
    }
    return value
  }).finally(() => {
    if (pendingFacts.get(key) === request) pendingFacts.delete(key)
  })
  pendingFacts.set(key, request)
  return request
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
export async function getStaticPreview(target: MapPreviewTarget, zoom: number, signal?: UploadSignal) {
  const result = await call<StaticPreview>({ action: 'preview', ...target, zoom }, signal)
  if (
    !result ||
    typeof result.image !== 'string' ||
    !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(result.image) ||
    result.image.length > 710000
  )
    throw new ApiError(serviceErrorMessage('MAP_RESPONSE_INVALID')!, 502, 'MAP_RESPONSE_INVALID')
  return result
}
