import { computed, readonly, ref, shallowRef } from 'vue'
import { validCoordinates } from '@/domain/rules'
import {
  captureEntryLocation,
  readEntryPermission,
  releaseEntryPermissionListener,
  type EntryLocation,
  type EntryPermission
} from '@/platforms/entry-location'

const position = shallowRef<EntryLocation | null>(null)
const status = ref<Exclude<EntryPermission, 'granted' | 'unknown'> | 'checking' | 'ready'>('prompt')
export const entryPosition = readonly(position)
export const entryLocationStatus = readonly(status)
export const entryLocationReady = computed(() => Boolean(position.value))
let started = false
let revision = 0
let pending: Promise<void> | undefined
let gate: Promise<void> | undefined
let unlock: (() => void) | undefined

export function startEntryLocation() {
  started = true
}

export function disposeEntryLocation() {
  started = false
  revision++
  position.value = null
  pending = undefined
  releaseEntryPermissionListener()
}

export function waitForEntryLocation() {
  if (!started || entryLocationReady.value) return
  return (gate ??= new Promise<void>((resolve) => {
    unlock = resolve
  }))
}

function block(reason: typeof status.value) {
  status.value = reason
  position.value = null
}

function permissionChanged(next: PermissionState) {
  if (next === 'granted') {
    void checkEntryLocation()
    return
  }
  if (next === 'prompt' && !position.value) return
  revision++
  pending = undefined
  block(next)
}

export function checkEntryLocation(interactive = false) {
  if (!started) return Promise.resolve()
  if (pending) return pending
  const attempt = ++revision
  if (!entryLocationReady.value) status.value = 'checking'
  pending = (async () => {
    try {
      const permission = await readEntryPermission(permissionChanged)
      if (attempt !== revision) return
      if (
        permission !== 'granted' &&
        !(permission === 'prompt' && interactive) &&
        !(permission === 'unknown' && (interactive || position.value))
      ) {
        block(permission === 'unknown' ? 'prompt' : permission)
        return
      }
      const next = await captureEntryLocation()
      if (attempt !== revision) return
      if (!validCoordinates(next.longitude, next.latitude)) {
        block('unavailable')
        return
      }
      position.value = next
      status.value = 'ready'
      unlock?.()
      unlock = undefined
      gate = undefined
    } catch (error) {
      if (attempt !== revision) return
      const message = error instanceof Error ? error.message : ''
      block(
        message === 'LOCATION_DEVTOOLS_UNAVAILABLE'
          ? 'devtools-unavailable'
          : message === 'LOCATION_NOT_ENABLED'
          ? 'not-enabled'
          : message === 'LOCATION_UNSUPPORTED'
            ? 'unsupported'
            : /LOCATION_DENIED|权限未开启/.test(message)
              ? 'denied'
              : 'unavailable'
      )
    } finally {
      if (attempt === revision) pending = undefined
    }
  })()
  return pending
}

export async function retryEntryLocation() {
  // #ifdef MP-WEIXIN
  if (status.value === 'denied') {
    try {
      await uni.openSetting()
    } catch {
      return
    }
  }
  // #endif
  await checkEntryLocation(true)
}
