import { sessionRequest, sessionScope, assertSession } from './session'
import type { Payload } from '@/domain/models'
import { resolveContentMedia } from './media'
import { ApiError } from './http'

async function execute<T>(kind: 'read' | 'write', action: string, payload: Payload): Promise<T> {
  const scope = sessionScope.value
  const send = () => sessionRequest<T>(`/rest/v1/rpc/fishing_${kind}`, {
    method: 'POST', data: { action, payload }
  }, kind === 'write')
  let result: T
  try {
    result = await send()
  } catch (error) {
    // These endpoints are business reads even though RPC uses POST. Recover once
    // from a lost connection; never replay a write or a rejected business request.
    assertSession(scope)
    const transient = error instanceof ApiError && (
      (error.status === 0 && ['NETWORK_ERROR', 'REQUEST_TIMEOUT'].includes(error.code)) ||
      [408, 502, 503, 504].includes(error.status)
    )
    if (kind !== 'read' || !transient) throw error
    result = await send()
  }
  await resolveContentMedia(result)
  assertSession(scope)
  return result
}
// Share only a currently running, identical read in the same account context.
// Results are not cached, and changing accounts can never reuse a private response.
const reading = new Map<string, Promise<unknown>>()
/** A successful removal must not let the next reader join a pre-removal snapshot. */
export function invalidatePendingReads() { reading.clear() }
export function read<T>(action: string, payload: Payload = {}): Promise<T> {
  const key = JSON.stringify([sessionScope.value, action, payload])
  const pending = reading.get(key)
  if (pending) return pending as Promise<T>
  const result = execute<T>('read', action, payload).finally(() => {
    if (reading.get(key) === result) reading.delete(key)
  })
  reading.set(key, result)
  return result
}
export const write = <T>(action: string, payload: Payload = {}) =>
  execute<T>('write', action, payload)
