import { isDemo } from '@/config'
import type { Payload } from '@/domain/models'
import { ApiError } from './http'
import { sessionRequest } from './session'
import { resolveContentMedia } from './media'

export function notifications<T>(action: string, payload: Payload = {}): Promise<T> {
  if (isDemo) return Promise.reject(new ApiError('本机体验不产生真实通知', 0, 'NOTIFICATIONS_DEMO'))
  return sessionRequest<T>('/rest/v1/rpc/fishing_notifications', {
    method: 'POST',
    data: { action, payload }
  }).then(resolveContentMedia)
}
