import { isDemo } from '@/config'
import { sessionRequest } from './session'
import { ApiError } from './http'
import type { Zone, ZoneBounds, ZoneFeedback, ZoneMap, ZonePage } from '@/domain/zones'
export function zonesRead<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (isDemo) {
    // No fictional safety restrictions on a real map, even in demo mode.
    if (action === 'nearby')
      return Promise.resolve({ items: [], truncated: false, zoom_in: false } as T)
    if (action === 'mine') return Promise.resolve({ items: [], next: null } as T)
    return Promise.reject(new ApiError('本机体验不提供审核权限', 403, 'FORBIDDEN'))
  }
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
  if (isDemo) return Promise.reject(new ApiError('体验模式不提交真实禁钓提醒', 400, 'ZONE_DEMO'))
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
  if (isDemo) return Promise.reject(new ApiError('体验模式不提交真实禁钓提醒', 400, 'ZONE_DEMO'))
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
