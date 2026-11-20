import { isDemo } from '@/config'
import type { Payload } from '@/domain/models'
import type { ReviewItem } from '@/domain/moderation'
import { ApiError } from './http'
import { sessionRequest, sessionScope, assertSession } from './session'
import { resolvePhotos } from './media'

export async function moderation<T>(action: string, payload: Payload = {}): Promise<T> {
  if (isDemo) {
    if (action === 'access') return { allowed: false } as T
    throw new ApiError('本机体验不提供审核权限', 403, 'FORBIDDEN')
  }
  const scope = sessionScope.value
  const result = await sessionRequest<T>('/rest/v1/rpc/fishing_moderation', {
    method: 'POST',
    data: { action, payload }
  })
  if (action === 'item' || action === 'proposal_item') {
    const item = result as ReviewItem
    await resolvePhotos(item.current ? [item, item.current] : [item])
  }
  assertSession(scope)
  return result
}
