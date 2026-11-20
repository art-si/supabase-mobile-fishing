import test from 'node:test'
import assert from 'node:assert/strict'
import {
  authErrorMessage,
  authSessionFromResponse,
  authSessionFromStorage,
  parseRetryAfter,
  retryAfterFromHeaders,
  smsLoginUnavailable
} from '../src/domain/auth-errors'

const sessionFixture = {
  access_token: 'access-fixture',
  refresh_token: 'refresh-fixture',
  expires_in: 3600,
  user: { id: '11111111-1111-4111-8111-111111111111' }
}

test('Auth errors explain expired codes, limits and temporary failure without technical details', () => {
  assert.match(authErrorMessage('otp_expired', 403), /验证码错误或已过期/)
  assert.match(authErrorMessage('invalid_credentials', 400), /手机号或验证码不正确/)
  assert.match(authErrorMessage('over_sms_send_rate_limit', 429), /发送过于频繁/)
  assert.match(authErrorMessage('captcha_failed', 400), /安全验证未通过/)
  for (const code of ['phone_provider_disabled', 'sms_send_failed', 'hook_timeout', 'unknown']) {
    const message = authErrorMessage(code, 503)
    assert.match(message, /稍后/)
    assert.doesNotMatch(message, /配置|Supabase|provider|hook|Key|CAPTCHA/)
  }
  assert.match(authErrorMessage('unknown', 429), /频繁/)
  assert.match(authErrorMessage('unknown', 401), /重新登录/)
})

test('Retry-After supports seconds, HTTP dates and case-insensitive response headers', () => {
  const now = Date.parse('2026-11-19T04:00:00Z')
  assert.equal(parseRetryAfter('60', now), 60)
  assert.equal(parseRetryAfter(0, now), 0)
  assert.equal(parseRetryAfter('Thu, 19 Nov 2026 04:01:00 GMT', now), 60)
  assert.equal(parseRetryAfter('Thu, 19 Nov 2026 03:59:00 GMT', now), 0)
  assert.equal(retryAfterFromHeaders({ 'rEtRy-AfTeR': '45' }, now), 45)
  for (const value of ['', '-1', '1.5', 'not-a-date', Infinity, {}, null, undefined])
    assert.equal(parseRetryAfter(value, now), undefined)
  assert.equal(parseRetryAfter('999999999999999999999'), undefined)
  assert.equal(retryAfterFromHeaders(null), undefined)
})

test('SMS guard refuses demo, disabled phone auth and unsupported CAPTCHA', () => {
  assert.equal(
    smsLoginUnavailable({ isDemo: true, phoneAuth: true, captcha: false })?.code,
    'DEMO_AUTH_DISABLED'
  )
  assert.equal(
    smsLoginUnavailable({ isDemo: false, phoneAuth: false, captcha: false })?.code,
    'PHONE_AUTH_UNAVAILABLE'
  )
  assert.equal(
    smsLoginUnavailable({ isDemo: false, phoneAuth: true, captcha: true })?.code,
    'AUTH_SECURITY_UNAVAILABLE'
  )
  assert.equal(smsLoginUnavailable({ isDemo: false, phoneAuth: true, captcha: false }), null)
})

test('Session contract accepts complete OTP responses and computes an omitted expiry', () => {
  assert.deepEqual(authSessionFromResponse(sessionFixture, 1000), {
    access_token: sessionFixture.access_token,
    refresh_token: sessionFixture.refresh_token,
    expires_at: 4600,
    user: sessionFixture.user
  })
  assert.equal(
    authSessionFromResponse({ ...sessionFixture, expires_at: 5000 }, 1000)?.expires_at,
    5000
  )
})

test('Session contract rejects incomplete responses, invalid identities and non-finite expiry', () => {
  for (const patch of [
    { access_token: '' },
    { access_token: undefined },
    { access_token: ' contains-whitespace' },
    { refresh_token: null },
    { user: null },
    { user: {} },
    { user: { id: 'not-a-user-id' } },
    { expires_at: NaN },
    { expires_at: Infinity },
    { expires_at: 0 },
    { expires_at: '5000' },
    { expires_in: undefined },
    { expires_in: -1 },
    { expires_in: Infinity }
  ])
    assert.equal(authSessionFromResponse({ ...sessionFixture, ...patch }, 1000), null)
  for (const value of [null, undefined, {}, [], 'unexpected response'])
    assert.equal(authSessionFromResponse(value, 1000), null)
})

test('Fresh sessions must expire in the future and require a valid current time', () => {
  for (const expires_at of [1, 999, 1000])
    assert.equal(authSessionFromResponse({ ...sessionFixture, expires_at }, 1000), null)
  for (const now of [NaN, Infinity, -Infinity, -1]) {
    assert.equal(authSessionFromResponse({ ...sessionFixture, expires_at: 5000 }, now), null)
    assert.equal(authSessionFromResponse(sessionFixture, now), null)
  }
})

test('Stored sessions retain expired access tokens for refresh but never invent a new expiry', () => {
  assert.equal(authSessionFromStorage({ ...sessionFixture, expires_at: 1 })?.expires_at, 1)
  assert.equal(authSessionFromStorage(sessionFixture), null)
  for (const expires_at of [NaN, Infinity, 0, -1, '5000'])
    assert.equal(authSessionFromStorage({ ...sessionFixture, expires_at }), null)
})
