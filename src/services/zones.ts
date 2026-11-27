import { sessionRequest } from './session'
import type { Zone, ZoneBounds, ZoneFeedback, ZoneMap, ZonePage } from '@/domain/zones'
export function zonesRead<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  return sessionRequest<T>(
    '/rest/v1/rpc/fishing_zones_read',
    { method: 'POST', data: { action, payload } },
    action !== 'nearby'
  )
}
export function zonesNearby(bounds: ZoneBounds) {
  return zonesRead<ZoneMap>('nearby', { ...bounds })
}
export function zonesMine(cursor: ZonePage['next'] = null) {
  return zonesRead<ZonePage>('mine', { cursor })
}
export function zonesWrite<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  return sessionRequest<T>('/rest/v1/rpc/fishing_zones_write', {
    method: 'POST',
    data: { action, payload }
  })
}
export function zoneFeedback(
  zone: Zone,
  vote?: 'can_fish' | 'cannot_fish',
  note = '',
  version = ''
) {
  return sessionRequest<ZoneFeedback>(
    '/rest/v1/rpc/fishing_zone_feedback',
    {
      method: 'POST',
      data: {
        action: vote ? 'vote' : 'state',
        payload: { source: zone.source, id: zone.id, ...(vote ? { vote, note, version } : {}) }
      }
    },
    Boolean(vote)
  )
}
