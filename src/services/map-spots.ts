import { isDemo } from '@/config'
import type { MapSpots } from '@/domain/map-spots'
import type { ZoneBounds } from '@/domain/zones'
import { sessionRequest } from './session'

export function readMapSpots(bounds: ZoneBounds): Promise<MapSpots> {
  // Never place fixture community coordinates on the real map.
  if (isDemo) return Promise.resolve({ items: [], truncated: false, zoom_in: false })
  return sessionRequest<MapSpots>(
    '/rest/v1/rpc/fishing_map_spots',
    { method: 'POST', data: { payload: { ...bounds } } },
    false
  )
}
