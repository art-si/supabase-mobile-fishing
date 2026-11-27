import { request, ApiError } from './http'
import {
  session,
  sessionScope,
  assertSession,
  saveSession,
  sessionRequest,
  sessionNotice,
  type Session
} from './session'
import { normalizePhone } from '@/domain/rules'
import { authSessionFromResponse } from '@/domain/auth-errors'
import { passwordIssue, normalizeLoginIdentifier } from '@/domain/account-security'
import { config } from '@/config'
import { smsLoginUnavailable } from '@/domain/auth-errors'
import { rememberedLogin } from './login-memory'

export async function accountPasswordConfigured() {
  const result = await sessionRequest<unknown>('/rest/v1/rpc/fishing_password_configured', {
    method: 'POST',
    data: {}
  })
  if (typeof result !== 'boolean')
    throw new ApiError('暂时无法确认密码状态，请重试', 502, 'PASSWORD_STATE_INVALID')
  return result
}

export async function accountIdentity() {
  const owner = session.value?.user.id
  const user = await sessionRequest<{ id: string; phone?: string; phone_confirmed_at?: string }>(
    '/auth/v1/user'
  )
  if (!owner || user.id !== owner || !user.phone || !user.phone_confirmed_at)
    throw new ApiError('请重新登录后再管理账号', 401, 'ACCOUNT_IDENTITY_INVALID')
  return { id: owner, phone: normalizePhone(user.phone) }
}

export async function passwordLogin(identifier: string, password: string, isActive = () => true) {
  const scope = sessionScope.value
  const check = () => {
    assertSession(scope)
    if (!isActive()) throw new ApiError('已取消登录', 0, 'AUTH_CANCELLED')
  }
  check()
  if (!password) throw new ApiError('请输入登录密码', 0, 'PASSWORD_REQUIRED')
  const normalized = normalizeLoginIdentifier(identifier)
  const account = normalized.startsWith('DY')
  let data: unknown
  try {
    data = await request(
      account ? '/functions/v1/account-login' : '/auth/v1/token?grant_type=password',
      {
        method: 'POST',
        data: account ? { identifier: normalized, password } : { phone: normalized, password }
      }
    ).finally(check)
  } catch (error) {
    if (
      error instanceof ApiError &&
      ['invalid_credentials', 'PASSWORD_INCORRECT'].includes(error.code)
    )
      throw new ApiError('账号、手机号或密码不正确，可使用短信登录', 400, 'PASSWORD_INCORRECT')
    throw error
  }
  const next = authSessionFromResponse(data)
  if (!next) throw new ApiError('登录未能完成，请重新登录', 502, 'AUTH_RESPONSE_INVALID')
  check()
  sessionNotice.value = ''
  await saveSession(next)
}

/** Phone verification is kept in memory for this flow; it never replaces another account. */
export function createAccountSecurityFlow(owner = '', isActive = () => true) {
  const scope = sessionScope.value
  let proof: Session | null = null
  let ownsProof = true
  let verifiedAt = 0
  let proofLifetime = 300_000
  let newPhone = ''
  let cancelled = false
  const check = () => {
    assertSession(scope)
    if (cancelled || !isActive()) throw new ApiError('已取消登录', 0, 'AUTH_CANCELLED')
  }
  const requireProof = () => {
    check()
    if (!proof || Date.now() - verifiedAt >= proofLifetime)
      throw new ApiError('验证已过期，请重新验证原手机号', 401, 'PHONE_PROOF_EXPIRED')
    return proof
  }
  const available = () => {
    check()
    const unavailable = smsLoginUnavailable(config)
    if (unavailable) throw new ApiError(unavailable.message, 0, unavailable.code)
  }
  const checkedSession = (data: unknown, expectedId = owner, expectedPhone = '') => {
    const next = authSessionFromResponse(data)
    let phoneMatches = !expectedPhone
    try {
      if (next && expectedPhone)
        phoneMatches = normalizePhone(next.user.phone || '') === expectedPhone
    } catch {
      /* malformed identity is rejected below */
    }
    if (!next || (expectedId && next.user.id !== expectedId) || !phoneMatches)
      throw new ApiError('验证的账号与当前账号不一致，请重新登录', 409, 'ACCOUNT_IDENTITY_MISMATCH')
    return next
  }
  async function discardProof() {
    const previous = proof
    const shouldRevoke = ownsProof
    proof = null
    verifiedAt = 0
    newPhone = ''
    if (previous && shouldRevoke)
      await request('/auth/v1/logout?scope=local', {
        method: 'POST',
        token: previous.access_token
      }).catch(() => undefined)
  }
  return {
    useRecentVerification() {
      check()
      const current = session.value
      if (!owner || !current || current.user.id !== owner || !current.user.phone) return false
      try {
        const part = current.access_token.split('.')[1]
        if (!part) return false
        const base64 = part
          .replace(/-/g, '+')
          .replace(/_/g, '/')
          .padEnd(Math.ceil(part.length / 4) * 4, '=')
        const claims = JSON.parse(
          String.fromCharCode(...new Uint8Array(uni.base64ToArrayBuffer(base64)))
        )
        if (
          claims.sub !== owner ||
          normalizePhone(claims.phone || '') !== normalizePhone(current.user.phone)
        )
          return false
        const now = Date.now()
        const verified = Array.isArray(claims.amr)
          ? claims.amr
              .filter(
                (entry: { method?: string; timestamp?: number }) =>
                  ['otp', 'sms'].includes(entry.method || '') &&
                  typeof entry.timestamp === 'number' &&
                  Number.isSafeInteger(entry.timestamp) &&
                  entry.timestamp * 1000 <= now + 15000 &&
                  now - entry.timestamp * 1000 < 900000
              )
              .map((entry: { timestamp: number }) => entry.timestamp * 1000)
          : []
        if (!verified.length) return false
        // The setting page first checks /user; the Auth endpoint verifies this same JWT on save.
        // AMR here controls the UI step only, never server-side authorization.
        proof = current
        ownsProof = false
        proofLifetime = 900_000
        verifiedAt = Math.max(...verified)
        return true
      } catch {
        return false
      }
    },
    async send(phone: string) {
      available()
      await request('/auth/v1/otp', {
        method: 'POST',
        data: { phone: normalizePhone(phone), create_user: false, channel: 'sms' }
      }).finally(check)
    },
    async verify(phone: string, code: string) {
      available()
      if (!/^\d{6}$/.test(code.trim())) throw new Error('请输入 6 位短信验证码')
      const normalized = normalizePhone(phone)
      const data = await request('/auth/v1/verify', {
        method: 'POST',
        data: { phone: normalized, token: code.trim(), type: 'sms' }
      }).finally(check)
      const next = checkedSession(data, owner, normalized)
      await discardProof()
      check()
      proof = next
      ownsProof = true
      proofLifetime = 300_000
      verifiedAt = Date.now()
      return next.user.id
    },
    async setPassword(password: string) {
      const current = requireProof()
      const issue = passwordIssue(password)
      if (issue) throw new ApiError(issue, 0, 'PASSWORD_WEAK')
      const user = await request<{ id: string; phone?: string }>('/auth/v1/user', {
        method: 'PUT',
        token: current.access_token,
        data: { password }
      }).finally(check)
      if (user.id !== current.user.id)
        throw new ApiError('账号状态已变化，请重新打开页面', 409, 'SESSION_CHANGED')
      // Auth revokes other sessions on password change; keep this verified session.
      proof = null
      sessionNotice.value = ''
      await saveSession(current, Boolean(owner))
      try {
        await rememberedLogin.forgetOwner(current.user.id)
      } catch {
        sessionNotice.value =
          '密码已更新，但设备未能完全清除旧的记忆密码。请在登录页取消记住后重试。'
      }
    },
    async sendNew(phone: string) {
      available()
      const current = requireProof()
      const normalized = normalizePhone(phone)
      if (normalizePhone(current.user.phone || '') === normalized)
        throw new ApiError('新手机号不能与原手机号相同', 0, 'PHONE_UNCHANGED')
      const user = await request<{ id: string }>('/auth/v1/user', {
        method: 'PUT',
        token: current.access_token,
        data: { phone: normalized, channel: 'sms' }
      }).finally(check)
      if (user.id !== current.user.id)
        throw new ApiError('账号状态已变化，请重新打开页面', 409, 'SESSION_CHANGED')
      newPhone = normalized
    },
    async verifyNew(phone: string, code: string) {
      const current = requireProof()
      const normalized = normalizePhone(phone)
      if (!newPhone || normalized !== newPhone)
        throw new ApiError('请先获取新手机号的验证码', 0, 'NEW_PHONE_CODE_REQUIRED')
      if (!/^\d{6}$/.test(code.trim())) throw new Error('请输入 6 位短信验证码')
      const data = await request('/auth/v1/verify', {
        method: 'POST',
        data: { phone: normalized, token: code.trim(), type: 'phone_change' }
      }).finally(check)
      const next = checkedSession(data, current.user.id, normalized)
      proof = null
      const installedScope = sessionScope.value
      await saveSession(next, true)
      try {
        await rememberedLogin.forgetOwner(next.user.id)
      } catch {
        sessionNotice.value =
          '手机号已换绑，但设备未能完全清除旧的登录记忆。请在登录页取消记住后重试。'
      }
      try {
        await request('/auth/v1/logout?scope=others', { method: 'POST', token: next.access_token })
      } catch {
        if (sessionScope.value === installedScope && session.value?.user.id === next.user.id)
          sessionNotice.value = '手机号已换绑。暂时无法退出其他设备，请稍后检查账号安全。'
      }
    },
    cancel() {
      cancelled = true
      void discardProof()
    }
  }
}
