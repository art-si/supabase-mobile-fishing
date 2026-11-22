import { isDemo } from '@/config'
import { useAuthStore } from '@/stores/auth'
import { sessionRequest, sessionScope, assertSession } from './session'
import type { Payload } from '@/domain/models'
import { resolveContentMedia } from './media'

let demoModule: typeof import('@/demo/database') | undefined
async function execute<T>(kind: 'read' | 'write', action: string, payload: Payload): Promise<T> {
  const scope = sessionScope.value
  if (isDemo) {
    const owner = useAuthStore().userId
    demoModule ??= await import('@/demo/database')
    assertSession(scope)
    return demoModule.execute(kind, action, payload, owner) as T
  }
  const result = await sessionRequest<T>(
    `/rest/v1/rpc/fishing_${kind}`,
    {
      method: 'POST',
      data: { action, payload }
    },
    kind === 'write'
  )
  await resolveContentMedia(result)
  assertSession(scope)
  return result
}
export const read = <T>(action: string, payload: Payload = {}) =>
  execute<T>('read', action, payload)
export const write = <T>(action: string, payload: Payload = {}) =>
  execute<T>('write', action, payload)
