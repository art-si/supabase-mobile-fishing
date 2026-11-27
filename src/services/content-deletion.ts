import { shallowRef, watch } from 'vue'
import { sessionScope } from './session'
import { invalidatePendingReads } from './repository'

export interface ContentDeletion { type: 'post' | 'spot' | 'trip'; id: string; scope: number }
const deleted = shallowRef<ContentDeletion | null>(null)
watch(sessionScope, () => { deleted.value = null }, { flush: 'sync' })

/** Publish only an acknowledged write from the same account; this is local UI invalidation. */
export function notifyContentDeleted(value: ContentDeletion) {
  if (value.scope !== sessionScope.value) return
  invalidatePendingReads()
  deleted.value = value
}
export function onContentDeleted(listener: (value: ContentDeletion) => void) {
  return watch(deleted, value => {
    if (value && value.scope === sessionScope.value) listener(value)
  }, { flush: 'sync' })
}
