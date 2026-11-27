import { validCoordinates } from '@/domain/rules'
import type { MapPlace, SelectedPlace } from '@/domain/map'
import { searchMapPlaces } from '@/services/amap'
import { locateWaterPlace } from './water-location'
import { describeReportLocation } from './report-location'
// #ifdef H5
import { searchPlacePage } from './amap'
// #endif

export async function capturePostLocation(options: { detailedLabel?: boolean } = {}): Promise<SelectedPlace> {
  const water = await locateWaterPlace()
  if (options.detailedLabel) return water
  const { city, district } = await describeReportLocation([water.longitude, water.latitude])
  const name = [...new Set([city, district].filter(Boolean))].join(' · ')
  return { ...water, name }
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
  if (validCoordinates(place.longitude, place.latitude)) {
    return (await searchPlacePage('', '', 1, [place.longitude, place.latitude])).items
  }
  // #endif
  return []
}
