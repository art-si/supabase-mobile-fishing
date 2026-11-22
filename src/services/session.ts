import { ref } from 'vue'
import { isDemo } from '@/config'
import { request, ApiError, type RequestOptions } from './http'
import { privateStorageKey } from '@/domain/private-storage'
import { authSessionFromResponse, authSessionFromStorage } from '@/domain/auth-errors'
import { clearTripDraft } from './draft-handoff'
import { nativeCredentials, nativeCredentialsAvailable } from './native-credentials'
import { waitForEntryLocation } from './entry-location'
// #ifdef H5
import { Capacitor } from '@capacitor/core'
// #endif
export interface Session {
  access_token: string
  refresh_token: string
  expires_at: number
  user: { id: string; phone?: string }
}
const storageKey = 'dyj.auth.v1'
export const session = ref<Session | null>(null)
export const demoUser = ref(false)
export const sessionScope = ref(0)
export const sessionNotice = ref('')
export const sessionReady = ref(!nativeCredentialsAvailable())
let hydration: Promise<void> | undefined
let restorationFailed = false
let refreshing: { generation: number; promise: Promise<string> } | undefined
let generation = 0
const invalidRefreshCodes = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_not_found',
  'session_expired',
  'user_not_found',
  'user_banned',
  'AUTH_RESPONSE_INVALID'
])
export function assertSession(scope: number) {
  if (scope !== sessionScope.value)
    throw new ApiError('账号状态已变化，请重新打开页面', 409, 'SESSION_CHANGED')
}
export async function saveSession(value: Session | null, continuing = false) {
  generation++
  const revision = generation
  restorationFailed = false
  session.value = value
  if (!continuing) {
    clearTripDraft()
    sessionScope.value++
  }
  try {
    if (nativeCredentialsAvailable()) {
      if (value) await nativeCredentials.write(JSON.stringify(value))
      else await nativeCredentials.remove()
    } else if (value) uni.setStorageSync(storageKey, value)
    else uni.removeStorageSync(storageKey)
    return true
  } catch {
    if (value) {
      // Don't silently leave an older account's credentials in storage.
      try {
        uni.removeStorageSync(storageKey)
      } catch {
        /* warning remains visible */
      }
      if (revision === generation)
        sessionNotice.value =
          '设备未能保存登录状态。关闭页面后可能需要重新登录；请检查设备存储权限。'
    }
    return false
  }
}
export function enterDemoSession() {
  uni.setStorageSync('dyj.demo.signed-in', true)
  demoUser.value = true
  sessionScope.value++
  sessionNotice.value = ''
}
export function hydrateSession(): Promise<void> {
  if (hydration) return hydration
  const started = generation
  hydration = (async () => {
    if (isDemo) {
      demoUser.value = uni.getStorageSync('dyj.demo.signed-in') === true
      return
    }
    try {
      const stored = nativeCredentialsAvailable()
        ? await nativeCredentials.read()
        : uni.getStorageSync(storageKey)
      if (generation !== started) return
      if (stored === null || stored === undefined || stored === '') return
      const data = authSessionFromStorage(typeof stored === 'string' ? JSON.parse(stored) : stored)
      if (data) {
        session.value = data
        sessionScope.value++
      }
    } catch {
      if (generation === started) {
        session.value = null
        restorationFailed = true
        sessionNotice.value = '暂时无法恢复登录，请解锁设备后重试，或重新登录。'
      }
    }
  })().finally(() => {
    sessionReady.value = true
    if (restorationFailed) hydration = undefined
  })
  return hydration
}
export async function accessToken() {
  if (!sessionReady.value) await hydrateSession()
  if (!session.value) return ''
  if (session.value.expires_at > Date.now() / 1000 + 60) return session.value.access_token
  if (refreshing?.generation === generation) return refreshing.promise
  const started = generation
  const previous = session.value
  const promise = request<Session & { expires_in: number }>(
    '/auth/v1/token?grant_type=refresh_token',
    { method: 'POST', data: { refresh_token: previous.refresh_token } }
  )
    .then(async (data) => {
      if (generation !== started)
        throw new ApiError('账号状态已变化，请重新打开页面', 409, 'SESSION_CHANGED')
      const next = authSessionFromResponse(data)
      if (!next || next.user.id !== previous.user.id)
        throw new ApiError('登录服务返回异常，请重新登录', 401, 'AUTH_RESPONSE_INVALID')
      await saveSession(next, true)
      return next.access_token
    })
    .catch(async (error) => {
      if (
        generation === started &&
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 429 &&
        invalidRefreshCodes.has(error.code)
      ) {
        await saveSession(null)
        sessionNotice.value = '登录已失效，原账号草稿已保留。请重新登录后继续。'
      }
      throw error
    })
    .finally(() => {
      if (refreshing?.promise === promise) refreshing = undefined
    })
  refreshing = { generation: started, promise }
  return promise
}
export async function resumeSession() {
  if (!sessionReady.value || restorationFailed) await hydrateSession()
  if (isDemo || !session.value || session.value.expires_at > Date.now() / 1000 + 60) return
  try {
    // Share the generation-bound refresh with any foreground data request.
    await accessToken()
  } catch {
    // Only an explicitly invalid session is cleared by accessToken. Offline,
    // rate-limited and unavailable services can recover on the next request/show.
  }
}
export async function sessionRequest<T>(
  path: string,
  options: Omit<RequestOptions, 'token'> = {},
  required = true
): Promise<T> {
  if (!sessionReady.value) await hydrateSession()
  const scope = sessionScope.value
  const location = waitForEntryLocation()
  if (location) {
    await location
    assertSession(scope)
  }
  const token = await accessToken()
  assertSession(scope)
  if (required && !token) throw new ApiError('请先登录，原账号草稿会保留', 401, 'NOT_AUTHENTICATED')
  try {
    const result = await request<T>(path, { ...options, token })
    assertSession(scope)
    return result
  } catch (error) {
    assertSession(scope)
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      token &&
      session.value?.access_token === token
    ) {
      await saveSession(null)
      sessionNotice.value = '登录已失效，原账号草稿已保留。请重新登录后继续。'
    }
    throw error
  }
}
export function clearPrivateDrafts(userId: string) {
  clearTripDraft()
  let cleared = true
  try {
    const keys = uni.getStorageInfoSync().keys
    for (const key of keys) {
      if (!privateStorageKey(key, isDemo ? 'demo' : 'live', userId)) continue
      try {
        uni.removeStorageSync(key)
      } catch {
        cleared = false
      }
    }
    return cleared
  } catch {
    return false
  }
}
export async function signOut() {
  const previous = session.value
  const owner = isDemo ? '11111111-1111-4111-8111-111111111111' : previous?.user.id || ''
  demoUser.value = false
  const clearing = saveSession(null)
  let demoCleared = true
  try {
    uni.removeStorageSync('dyj.demo.signed-in')
  } catch {
    demoCleared = false
  }
  const draftsCleared = clearPrivateDrafts(owner)
  const scope = sessionScope.value
  const cleared = await clearing
  const cleanupWarning =
    !cleared || !demoCleared || !draftsCleared
      ? '本次页面已退出，但设备存储未能完全清理。请清除此应用的网站数据后再交给他人使用。'
      : ''
  if (scope === sessionScope.value)
    sessionNotice.value = cleanupWarning || '已退出本机，正在结束服务器会话…'
  let revoked = true
  if (!isDemo && previous) {
    try {
      await request('/auth/v1/logout?scope=local', { method: 'POST', token: previous.access_token })
    } catch {
      revoked = false
    }
  }
  const warning = [
    cleanupWarning,
    !revoked && '已退出本机，但未能确认服务器会话撤销。已签发的访问令牌仍可能在到期前有效。'
  ]
    .filter(Boolean)
    .join(' ')
  if (scope === sessionScope.value) sessionNotice.value = warning
  return { warning, scope }
}
let watchingStorage = false
export function watchExternalSessions() {
  // #ifdef H5
  if (watchingStorage || Capacitor.isNativePlatform()) return
  watchingStorage = true
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== (isDemo ? 'dyj.demo.signed-in' : storageKey)) return
    if (isDemo) {
      const next = uni.getStorageSync('dyj.demo.signed-in') === true
      if (demoUser.value !== next) {
        demoUser.value = next
        sessionScope.value++
      }
      return
    }
    try {
      const next = authSessionFromStorage(uni.getStorageSync(storageKey))
      if (next?.refresh_token === session.value?.refresh_token) return
      const changed = next?.user.id !== session.value?.user.id
      generation++
      session.value = next
      if (changed) {
        clearTripDraft()
        sessionScope.value++
        sessionNotice.value = next
          ? '账号已在另一页面切换，旧账号内容已清空。'
          : '已在另一页面退出登录。'
      }
    } catch {
      generation++
      session.value = null
      sessionScope.value++
      sessionNotice.value = '无法读取设备登录状态，请重新登录。'
    }
  })
  // #endif
}
