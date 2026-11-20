import { canLocateReport, locateReport, describeReportLocation } from './report-location'
import { districtOptions } from '@/domain/regions'
import { cityOptions } from '@/domain/cities'
import type { SelectedPlace } from '@/domain/map'
import { validCoordinates } from '@/domain/rules'

export const canLocateSpot = canLocateReport
export interface SpotLocation {
  longitude: number
  latitude: number
  city: string
  label: string
}
export async function locateSpot(): Promise<SpotLocation> {
  const place = await locateReport()
  return {
    longitude: place.longitude,
    latitude: place.latitude,
    city: place.city,
    label: place.location_label
  }
}
/** City and label always belong to this GCJ-02 point, never to an unrelated current-city setting. */
export async function describeSpotLocation(place: SelectedPlace): Promise<SpotLocation> {
  if (!validCoordinates(place.longitude, place.latitude))
    throw new Error('请先在地图上选择有效位置。')
  // #ifdef H5
  const result = await describeReportLocation([place.longitude, place.latitude])
  return {
    longitude: place.longitude,
    latitude: place.latitude,
    city: result.city,
    label: result.location_label || place.address || place.name
  }
  // #endif
  // #ifndef H5
  // Personal-subject miniapps use authorized place search; no unsupported device GPS call.
  const city =
    districtOptions.find((item) => item.id === place.adcode)?.city ||
    cityOptions.find((item) => item.id === place.adcode)?.name ||
    ''
  if (!city) throw new Error('未能识别这个地点的城市，请在高德中重新搜索并选择地点。')
  const address = place.address || place.name
  return {
    longitude: place.longitude,
    latitude: place.latitude,
    city,
    label: address.includes(city) ? address : `${city}${address}`
  }
  // #endif
}
