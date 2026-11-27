import type { Payload } from '@/domain/models'
import { sessionRequest } from './session'
import { resolveContentMedia } from './media'

export function notifications<T>(action: string, payload: Payload = {}): Promise<T> {
  return sessionRequest<T>('/rest/v1/rpc/fishing_notifications', {
    method: 'POST',
    data: { action, payload }
  }).then(resolveContentMedia)
}
