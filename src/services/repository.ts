import { isDemo } from '@/config'
import { useAuthStore } from '@/stores/auth'
import { sessionRequest, sessionScope, assertSession } from './session'
import type { Payload } from '@/domain/models'
import { resolvePhotos } from './media'
import type { Media } from '@/domain/models'

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
  const posts: { media: Media[] }[] = []
  function collect(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(collect)
      return
    }
    if (!value || typeof value !== 'object') return
    if ('media' in value && Array.isArray(value.media)) posts.push(value as { media: Media[] })
    if ('avatar' in value && value.avatar && typeof value.avatar === 'object' && 'path' in value.avatar)
      posts.push({ media: [value.avatar as Media] })
    Object.entries(value).forEach(([key, child]) => { if (key !== 'media' && key !== 'avatar') collect(child) })
  }
  collect(result)
  await resolvePhotos(posts)
  assertSession(scope)
  return result
}
export const read = <T>(action: string, payload: Payload = {}) =>
  execute<T>('read', action, payload)
export const write = <T>(action: string, payload: Payload = {}) =>
  execute<T>('write', action, payload)
