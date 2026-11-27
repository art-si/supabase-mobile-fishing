import { computed } from 'vue'
import { defineStore } from 'pinia'
import { config } from '@/config'
import {
  session,
  hydrateSession,
  saveSession,
  signOut,
  sessionScope,
  sessionNotice,
  assertSession
} from '@/services/session'
import { request, ApiError } from '@/services/http'
import { normalizePhone } from '@/domain/rules'
import { authSessionFromResponse, smsLoginUnavailable } from '@/domain/auth-errors'
export const useAuthStore = defineStore('fishing-auth', () => {
  const userId = computed(() => session.value?.user.id || '')
  const signedIn = computed(() => Boolean(userId.value))
  function assertSmsAvailable() {
    const unavailable = smsLoginUnavailable(config)
    if (unavailable) throw new ApiError(unavailable.message, 0, unavailable.code)
  }
  async function sendCode(phone: string) {
    assertSmsAvailable()
    const scope = sessionScope.value
    await request('/auth/v1/otp', {
      method: 'POST',
      data: { phone: normalizePhone(phone), create_user: true, channel: 'sms' }
    }).finally(() => assertSession(scope))
  }
  async function verify(phone: string, code: string, options: { isActive?: () => boolean } = {}) {
    assertSmsAvailable()
    const scope = sessionScope.value
    function assertVerificationActive() {
      assertSession(scope)
      if (options.isActive && !options.isActive())
        throw new ApiError('已取消登录', 0, 'AUTH_CANCELLED')
    }
    assertVerificationActive()
    const token = code.trim()
    if (!/^\d{6}$/.test(token)) throw new Error('请输入 6 位短信验证码')
    const data = await request<unknown>('/auth/v1/verify', {
      method: 'POST',
      data: { phone: normalizePhone(phone), token, type: 'sms' }
    }).finally(assertVerificationActive)
    const nextSession = authSessionFromResponse(data)
    if (!nextSession)
      throw new ApiError('登录服务暂时不可用，请稍后重试', 502, 'AUTH_RESPONSE_INVALID')
    assertVerificationActive()
    sessionNotice.value = ''
    await saveSession(nextSession)
  }
  function requireLogin() {
    if (signedIn.value) return true
    uni.navigateTo({ url: '/pages/login/index' })
    return false
  }
  return {
    userId,
    context: sessionScope,
    signedIn,
    hydrate: hydrateSession,
    sendCode,
    verify,
    signOut,
    requireLogin
  }
})
