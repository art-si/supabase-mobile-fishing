import { validCoordinates } from './rules'
import type { ProhibitedSpotPoint, Zone } from './zones'

export function spotReportZone(spot: ProhibitedSpotPoint): Zone | null {
  if (!validCoordinates(spot.longitude, spot.latitude)) return null
  return {
    id: 'spot-' + spot.id,
    ...(spot.catalog ? {} : { spot_id: spot.id }),
    source: 'spot',
    title: spot.name,
    community_based: spot.community_based,
    description: spot.community_based
      ? '近期钓友评论达到比例，点位已标记为禁钓。'
      : '钓友将这个公开钓位标记为禁钓。',
    location_label: spot.city,
    longitude: spot.longitude,
    latitude: spot.latitude,
    radius_m: 0,
    crs: 'GCJ-02',
    source_url: '',
    status: 'published',
    observed_on: spot.observed_on || '',
    expires_on: '',
    revision: spot.review_revision || 1,
    created_at: spot.created_at
  }
}
