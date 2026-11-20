import { isDemo } from '@/config'
import { validCoordinates } from '@/domain/rules'
import type { MapPlace, SelectedPlace } from '@/domain/map'
import { searchMapPlaces } from '@/services/amap'
// #ifdef H5
import { locate, reverseAreaName, reverseGeocode, searchPlacePage } from './amap'
// #endif

let supportsLocation = false
// #ifdef H5
supportsLocation = true
// #endif
export const canCapturePostLocation = supportsLocation && !isDemo

export async function capturePostLocation(options: { detailedLabel?: boolean } = {}): Promise<SelectedPlace> {
  // #ifdef H5
  if (canCapturePostLocation) {
    const { point, accuracyM } = await locate()
    if (!validCoordinates(point[0], point[1])) throw new Error('MAP_LOCATION_UNAVAILABLE')
    const name = options.detailedLabel ? await reverseGeocode(point).catch(() => reverseAreaName(point)) : await reverseAreaName(point)
    return { longitude: point[0], latitude: point[1], name, crs: 'GCJ-02', created_at: Date.now(), ...(Number.isFinite(accuracyM) ? { accuracyM } : {}) }
  }
  // #endif
  throw new Error('MAP_LOCATION_UNAVAILABLE')
}

export async function findPostPlaces(
  query: string,
  city = '',
  page = 1
): Promise<{ items: MapPlace[]; hasMore: boolean }> {
  // #ifdef H5
  return searchPlacePage(query, city, page)
  // #endif
  // #ifndef H5
  return searchMapPlaces(query, city, page)
  // #endif
}

export async function findNearbyPostPlaces(place: SelectedPlace): Promise<MapPlace[]> {
  // #ifdef H5
  if (canCapturePostLocation && validCoordinates(place.longitude, place.latitude)) {
    return (await searchPlacePage('', '', 1, [place.longitude, place.latitude])).items
  }
  // #endif
  return []
}
