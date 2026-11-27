import { describeReportLocation } from './report-location'
import { locateWaterPlace, waterAt } from './water-location'
import { districtOptions } from '@/domain/regions'
import { cityOptions } from '@/domain/cities'
import type { SelectedPlace } from '@/domain/map'
import { validCoordinates } from '@/domain/rules'

export interface SpotLocation {
  longitude: number
  latitude: number
  city: string
  label: string
}
export async function locateSpot(): Promise<SpotLocation> {
  return describeSpotWater(await locateWaterPlace())
}

export async function describeSpotWater(place: SelectedPlace): Promise<SpotLocation> {
  const water = place.kind === 'water' ? place : await waterAt([place.longitude, place.latitude])
  const { city } = await describeReportLocation([water.longitude, water.latitude])
  return { longitude: water.longitude, latitude: water.latitude, label: water.name, city }
}
/** City and label always belong to this GCJ-02 point, never to an unrelated current-city setting. */
export async function describeSpotLocation(place: SelectedPlace): Promise<SpotLocation> {
  if (!validCoordinates(place.longitude, place.latitude))
    throw new Error('请先在地图上选择有效位置。')
  const city =
    districtOptions.find((item) => item.id === place.adcode)?.city ||
    cityOptions.find((item) => item.id === place.adcode)?.name
  if (city) {
    const address = place.address || place.name
    return {
      longitude: place.longitude,
      latitude: place.latitude,
      city,
      label: address.includes(city) ? address : `${city} ${address}`
    }
  }
  // A pin placed on the interactive map has no provider POI metadata.
  const result = await describeReportLocation([place.longitude, place.latitude])
  return {
    longitude: place.longitude,
    latitude: place.latitude,
    city: result.city,
    label: result.location_label || place.address || place.name
  }
}
