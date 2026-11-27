const authMessages: Record<string, string> = {
  otp_expired: '验证码错误或已过期，请重新获取',
  invalid_credentials: '手机号或验证码不正确，请重新填写',
  validation_failed: '请检查手机号和验证码后重试',
  over_sms_send_rate_limit: '验证码发送过于频繁，请稍后再试',
  over_request_rate_limit: '操作过于频繁，请稍后再试',
  rate_limit_exceeded: '操作过于频繁，请稍后再试',
  captcha_failed: '安全验证未通过，请稍后重试',
  phone_provider_disabled: '短信登录暂时不可用，请稍后再试',
  otp_disabled: '短信登录暂时不可用，请稍后再试',
  signup_disabled: '暂时无法注册新账号，请稍后再试',
  sms_send_failed: '验证码暂时未能发送，请稍后重试',
  user_banned: '当前账号暂时无法登录，请联系运营方',
  phone_exists: '手机号已被其他账号使用，请换一个号码',
  user_already_exists: '手机号已被其他账号使用，请换一个号码',
  same_password: '新密码不能与原密码相同',
  weak_password: '请使用更安全的密码，包含字母和数字',
  reauthentication_needed: '请重新验证手机号后再设置密码',
  reauthentication_not_valid: '请重新验证手机号后再设置密码'
}

export function authErrorMessage(code: string, status: number) {
  if (Object.prototype.hasOwnProperty.call(authMessages, code)) return authMessages[code]
  if (status === 429) return '操作过于频繁，请稍后再试'
  if (status === 401) return '登录状态已失效，请重新登录'
  return '登录服务暂时不可用，请稍后重试'
}

export function parseRetryAfter(value: unknown, now = Date.now()): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const raw = String(value).trim()
  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw)
    return Number.isSafeInteger(seconds) ? seconds : undefined
  }
  // HTTP-date values contain a named month/day; do not interpret malformed numbers as dates.
  if (!/[a-z]/i.test(raw)) return undefined
  const timestamp = Date.parse(raw)
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return undefined
  return Math.max(0, Math.ceil((timestamp - now) / 1000))
}

export function retryAfterFromHeaders(headers: unknown, now = Date.now()) {
  if (!headers || typeof headers !== 'object') return undefined
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === 'retry-after')
  return parseRetryAfter(entry?.[1], now)
}

export function smsLoginUnavailable(options: {
  phoneAuth: boolean
  captcha: boolean
}) {
  if (!options.phoneAuth)
    return { code: 'PHONE_AUTH_UNAVAILABLE', message: '短信登录暂时不可用，请稍后再试' }
  if (options.captcha)
    return { code: 'AUTH_SECURITY_UNAVAILABLE', message: '短信验证暂时不可用，请稍后再试' }
  return null
}

export interface AuthSessionData {
  access_token: string
  refresh_token: string
  expires_at: number
  user: { id: string; phone?: string }
}

function parseAuthSession(
  value: unknown,
  nowSeconds: number,
  allowExpired: boolean
): AuthSessionData | null {
  if (!Number.isFinite(nowSeconds) || nowSeconds < 0) return null
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  const validToken = (token: unknown): token is string =>
    typeof token === 'string' && token.length > 0 && !/\s/.test(token)
  if (!validToken(data.access_token) || !validToken(data.refresh_token)) return null
  if (!data.user || typeof data.user !== 'object') return null
  const user = data.user as Record<string, unknown>
  if (
    typeof user.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id) ||
    (user.phone !== undefined && typeof user.phone !== 'string')
  )
    return null
  let expiresAt = data.expires_at
  if (expiresAt === undefined) {
    // Persisted sessions must keep their original absolute expiry, never extend it on hydration.
    if (allowExpired) return null
    if (
      typeof data.expires_in !== 'number' ||
      !Number.isFinite(data.expires_in) ||
      data.expires_in <= 0
    )
      return null
    expiresAt = nowSeconds + data.expires_in
  }
  if (
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= 0 ||
    (!allowExpired && expiresAt <= nowSeconds)
  )
    return null
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt,
    user: { id: user.id, ...(typeof user.phone === 'string' ? { phone: user.phone } : {}) }
  }
}

export function authSessionFromResponse(
  value: unknown,
  nowSeconds = Math.floor(Date.now() / 1000)
): AuthSessionData | null {
  return parseAuthSession(value, nowSeconds, false)
}

export function authSessionFromStorage(value: unknown): AuthSessionData | null {
  // An expired access token may still have a valid refresh token; accessToken handles renewal.
  return parseAuthSession(value, Math.floor(Date.now() / 1000), true)
}
