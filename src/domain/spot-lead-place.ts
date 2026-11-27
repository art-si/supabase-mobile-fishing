import { wgs84ToGcj02 } from '@mobile-core/coordinates'
import { readSpotSharePosition, type SpotLead } from '../../supabase/functions/_shared/discovery-contract'
import type { MapPlace } from './map'
import { validCoordinates } from './rules'

export function sharedLeadPlace(lead: SpotLead): MapPlace | undefined {
  const position = readSpotSharePosition(lead.sourcePosition)
  if (!position) return
  const [longitude, latitude] = position.crs === 'WGS84'
    ? wgs84ToGcj02(position.longitude, position.latitude)
    : [position.longitude, position.latitude]
  return {
    id: lead.positionSource === 'amap' && lead.poiId ? lead.poiId : `share:${longitude.toFixed(6)},${latitude.toFixed(6)}`,
    name: lead.poiQuery || lead.name,
    address: lead.sourceAddress || '',
    longitude, latitude, crs: 'GCJ-02', ...(lead.positionSource === 'amap' ? {} : { source: 'share' as const })
  }
}

export function matchLeadPlace(lead: SpotLead, places: MapPlace[], districtCode?: string) {
  const normalize = (name: string) => name.replace(/[\s·()（）-]/gu, '').toLowerCase()
  const names = [lead.name, lead.poiQuery || lead.name].map(normalize)
  const matches = places.filter(place =>
    place.crs === 'GCJ-02' && /^[a-z0-9]{5,40}$/i.test(place.id) &&
    validCoordinates(place.longitude, place.latitude) && names.includes(normalize(place.name)) &&
    (!districtCode || !place.adcode || districtCode === place.adcode)
  )
  return matches.length === 1 ? matches[0] : undefined
}
