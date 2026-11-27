import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { authSessionFromResponse, smsLoginUnavailable } from '../src/domain/auth-errors'
import { passwordIssue, maskPhone, normalizeLoginIdentifier } from '../src/domain/account-security'
import { normalizePhone } from '../src/domain/rules'

const A = '11111111-1111-4111-8111-111111111111',
  B = '22222222-2222-4222-8222-222222222222'
const phone = '+8613800000000',
  otherPhone = '+8613900000000'
function session(id = A, number = phone) {
  return {
    access_token: `access-${id}`,
    refresh_token: `refresh-${id}`,
    expires_at: Date.now() / 1000 + 3600,
    user: { id, phone: number }
  }
}
class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = ''
  ) {
    super(message)
  }
}
function harness(
  handler: (path: string, options: any) => Promise<any>,
  flags = { phoneAuth: true, captcha: false }
) {
  const scope = { value: 0 },
    current = { value: null as ReturnType<typeof session> | null },
    notice = { value: '' }
  const calls: any[] = [],
    saved: any[] = []
  let time = Date.now()
  const exports: Record<string, any> = {}
  const dependencies: Record<string, any> = {
    './http': {
      ApiError,
      request: async (path: string, options = {}) => {
        calls.push({ path, options })
        return handler(path, options)
      }
    },
    './session': {
      session: current,
      sessionScope: scope,
      sessionNotice: notice,
      assertSession(expected: number) {
        if (expected !== scope.value) throw new ApiError('changed', 409, 'SESSION_CHANGED')
      },
      async saveSession(value: any, continuing = false) {
        current.value = value
        saved.push(value)
        if (!continuing) scope.value++
        return true
      },
      sessionRequest: handler
    },
    '@/domain/rules': { normalizePhone },
    '@/domain/auth-errors': { authSessionFromResponse, smsLoginUnavailable },
    '@/domain/account-security': { passwordIssue, normalizeLoginIdentifier },
    '@/config': { config: flags },
    './login-memory': { rememberedLogin: { forgetOwner: async () => undefined } }
  }
  class Clock extends Date {
    static now() {
      return time
    }
  }
  runInNewContext(
    ts.transpileModule(
      readFileSync(new URL('../src/services/account-security.ts', import.meta.url), 'utf8'),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
      }
    ).outputText,
    {
      exports,
      Error,
      Date: Clock,
      uni: {
        base64ToArrayBuffer: (value: string) => Uint8Array.from(Buffer.from(value, 'base64')).buffer
      },
      require: (name: string) => {
        assert.ok(name in dependencies, name)
        return dependencies[name]
      }
    }
  )
  return {
    api: exports,
    calls,
    saved,
    scope,
    current,
    notice,
    now: () => time,
    advance: (ms: number) => {
      time += ms
    }
  }
}

test('password validation and phone masking preserve user input and enforce the service limits', () => {
  for (const bad of ['short1', '12345678', 'onlyletters', 'A1' + '中'.repeat(30), 'a1'.repeat(33)])
    assert.ok(passwordIssue(bad))
  assert.equal(passwordIssue(' fishing1 '), '', 'do not trim or alter a password')
  assert.equal(maskPhone(phone), '138 **** 0000')
  assert.equal(maskPhone('8613800000000'), '138 **** 0000')
  assert.equal(normalizePhone('8613800000000'), phone, 'Auth returns numbers without a plus prefix')
  assert.equal(maskPhone('invalid'), '未绑定手机号')
})

test('password setup uses an authenticated state query and rejects malformed results', async () => {
  for (const configured of [true, false]) {
    const h = harness(async (path, options) => {
      assert.equal(path, '/rest/v1/rpc/fishing_password_configured')
      assert.equal(options.method, 'POST')
      assert.equal(Object.keys(options.data).length, 0, 'no phone or account can be queried')
      return configured
    })
    assert.equal(await h.api.accountPasswordConfigured(), configured)
  }
  for (const invalid of [null, {}, [], 'false', 0]) {
    const h = harness(async () => invalid)
    await assert.rejects(h.api.accountPasswordConfigured(), { code: 'PASSWORD_STATE_INVALID' })
  }
})

test('password login installs only a complete real session and never submits signup or persists the password', async () => {
  const h = harness(async (path, options) => {
    assert.equal(path, '/auth/v1/token?grant_type=password')
    assert.equal(options.data.password, ' ExactPassword1 ')
    return session()
  })
  await h.api.passwordLogin(phone, ' ExactPassword1 ')
  assert.equal(h.saved.length, 1)
  assert.doesNotMatch(JSON.stringify(h.saved), /ExactPassword1/)
  const invalid = harness(async () => ({}))
  await assert.rejects(invalid.api.passwordLogin(phone, 'password1'), {
    code: 'AUTH_RESPONSE_INVALID'
  })
  assert.equal(invalid.saved.length, 0)
})

test('a fishing handle uses the server login boundary while a phone keeps native password login', async () => {
  const h = harness(async (path, options) => {
    assert.equal(path, '/functions/v1/account-login')
    assert.deepEqual(JSON.parse(JSON.stringify(options.data)), {
      identifier: 'DY000000000001',
      password: ' ExactPassword1 '
    })
    return session()
  })
  await h.api.passwordLogin(' dy000000000001 ', ' ExactPassword1 ')
  assert.equal(h.saved[0].user.id, A)
  assert.equal(normalizeLoginIdentifier('136 0000 0000'), '+8613600000000')
  assert.throws(() => normalizeLoginIdentifier('水边的钓友'))
  for (const code of ['PASSWORD_INCORRECT', 'invalid_credentials']) {
    const wrong = harness(async () => {
      throw new ApiError('private diagnostic', 400, code)
    })
    await assert.rejects(wrong.api.passwordLogin('DY000000000001', 'wrong'), {
      code: 'PASSWORD_INCORRECT'
    })
    assert.equal(wrong.saved.length, 0)
  }
})

function recentSession(claims: Record<string, unknown> = {}, now = Date.now()) {
  const value = session()
  value.access_token =
    'fixture.' +
    Buffer.from(
      JSON.stringify({
        sub: A,
        phone,
        amr: [{ method: 'otp', timestamp: Math.floor(now / 1000) }],
        ...claims
      })
    ).toString('base64url') +
    '.not-a-real-signature'
  return value
}

test('a recent SMS login skips a duplicate verification for password setup without revoking the borrowed session', async () => {
  const h = harness(async (path, options) => {
    assert.equal(path, '/auth/v1/user')
    assert.equal(options.method, 'PUT')
    return session().user
  })
  h.current.value = recentSession()
  const cancelled = h.api.createAccountSecurityFlow(A)
  assert.equal(cancelled.useRecentVerification(), true)
  cancelled.cancel()
  assert.equal(h.calls.length, 0, 'leaving setup must not log out the current real session')
  const flow = h.api.createAccountSecurityFlow(A)
  assert.equal(flow.useRecentVerification(), true)
  await flow.setPassword('password1')
  assert.equal(h.calls.length, 1, 'no OTP resend or registration')
  assert.equal(h.saved[0].user.id, A)
  assert.equal(h.scope.value, 0, 'same account keeps draft scope')
})

test('old, password-only, future or mismatched verification cannot skip phone verification', async () => {
  for (const claims of [
    { sub: B },
    { phone: otherPhone },
    { amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] },
    { amr: [{ method: 'otp', timestamp: Math.floor(Date.now() / 1000) - 901 }] },
    { amr: [{ method: 'otp', timestamp: Math.floor(Date.now() / 1000) + 60 }] },
    { amr: [null] }
  ]) {
    const h = harness(async () => {
      throw new Error('no network expected')
    })
    h.current.value = recentSession(claims)
    assert.equal(h.api.createAccountSecurityFlow(A).useRecentVerification(), false)
    assert.equal(h.calls.length, 0)
  }
  const h = harness(async () => {
    throw new Error('no network expected')
  })
  // Claims and expiry must use the same simulated clock, even if transpilation
  // crossed a real second while other browser/build tests were running.
  h.current.value = recentSession({}, h.now())
  const flow = h.api.createAccountSecurityFlow(A)
  assert.equal(flow.useRecentVerification(), true)
  h.advance(900_001)
  await assert.rejects(flow.setPassword('password1'), { code: 'PHONE_PROOF_EXPIRED' })
  assert.equal(h.calls.length, 0)
})

test('wrong password and stale password responses offer recovery without replacing another account', async () => {
  const failed = harness(async () => {
    throw new ApiError('upstream diagnostic', 400, 'invalid_credentials')
  })
  await assert.rejects(failed.api.passwordLogin(phone, 'wrong'), {
    code: 'PASSWORD_INCORRECT',
    message: '账号、手机号或密码不正确，可使用短信登录'
  })
  let release!: (value: unknown) => void
  const h = harness(
    () =>
      new Promise((yes) => {
        release = yes
      })
  )
  const pending = h.api.passwordLogin(phone, 'password1')
  h.scope.value++
  h.current.value = session(B)
  release(session())
  await assert.rejects(pending, { code: 'SESSION_CHANGED' })
  assert.equal(h.saved.length, 0)
  assert.equal(h.current.value.user.id, B)
})

test('password recovery does not register, persists no temporary session and requires verified phone ownership', async () => {
  const h = harness(async (path, options) => {
    if (path === '/auth/v1/otp') {
      assert.equal(options.data.create_user, false)
      return {}
    }
    if (path === '/auth/v1/verify') return session()
    if (path === '/auth/v1/user') {
      assert.equal(options.method, 'PUT')
      assert.equal(options.token, session().access_token)
      return session().user
    }
    throw new Error('Unexpected request')
  })
  const flow = h.api.createAccountSecurityFlow()
  await flow.send(phone)
  await assert.rejects(flow.setPassword('password1'), { code: 'PHONE_PROOF_EXPIRED' })
  await flow.verify(phone, ' 010203 ')
  assert.equal(h.calls.find((c) => c.path === '/auth/v1/verify').options.data.token, '010203')
  assert.equal(h.saved.length, 0, 'verification stays in memory until password save')
  await flow.setPassword('password1')
  assert.equal(h.saved[0].user.id, A)
  assert.equal(h.calls.filter((c) => c.path.includes('signup')).length, 0)
})

test('account security refuses another UUID, another phone and expired phone verification', async () => {
  for (const response of [session(B), session(A, otherPhone)]) {
    const h = harness(async () => response)
    await assert.rejects(h.api.createAccountSecurityFlow(A).verify(phone, '123456'), {
      code: 'ACCOUNT_IDENTITY_MISMATCH'
    })
    assert.equal(h.saved.length, 0)
  }
  const h = harness(async () => session())
  const flow = h.api.createAccountSecurityFlow(A)
  await flow.verify(phone, '123456')
  h.advance(300_001)
  await assert.rejects(flow.setPassword('password1'), { code: 'PHONE_PROOF_EXPIRED' })
  await assert.rejects(flow.sendNew(otherPhone), { code: 'PHONE_PROOF_EXPIRED' })
  assert.equal(h.calls.length, 1)
})

test('phone change verifies both destinations, keeps the account UUID and uses phone_change verification', async () => {
  const h = harness(async (path, options) => {
    if (path === '/auth/v1/verify')
      return options.data.type === 'phone_change' ? session(A, otherPhone) : session()
    if (path === '/auth/v1/user') return { ...session().user, new_phone: otherPhone }
    if (path === '/auth/v1/logout?scope=others') return {}
    throw new Error('Unexpected request')
  })
  h.current.value = session()
  const flow = h.api.createAccountSecurityFlow(A)
  await assert.rejects(flow.sendNew(otherPhone), { code: 'PHONE_PROOF_EXPIRED' })
  await flow.verify(phone, '123456')
  await assert.rejects(flow.sendNew(phone), { code: 'PHONE_UNCHANGED' })
  await assert.rejects(flow.verifyNew(otherPhone, '123456'), { code: 'NEW_PHONE_CODE_REQUIRED' })
  await flow.sendNew(otherPhone)
  assert.equal(h.current.value.user.phone, phone, 'pending phone is not the bound phone')
  await flow.verifyNew(otherPhone, '010203')
  assert.equal(h.current.value.user.id, A)
  assert.equal(h.current.value.user.phone, otherPhone)
  assert.equal(h.scope.value, 0, 'same account keeps records and drafts')
  assert.equal(h.calls[2].options.data.type, 'phone_change')
  assert.equal(h.calls[2].options.data.phone, otherPhone)
})

test('cancelling verification revokes only its temporary session and disables further mutations', async () => {
  const h = harness(async () => session())
  const flow = h.api.createAccountSecurityFlow(A)
  await flow.verify(phone, '123456')
  flow.cancel()
  await assert.rejects(flow.setPassword('password1'), { code: 'AUTH_CANCELLED' })
  await assert.rejects(flow.sendNew(otherPhone), { code: 'AUTH_CANCELLED' })
  assert.equal(h.calls.filter((c) => c.path === '/auth/v1/logout?scope=local').length, 1)
  assert.equal(h.saved.length, 0)
})

test('failed password saves retain the current login; late mutation responses cannot install an older account', async () => {
  let release!: (value: unknown) => void
  const h = harness(async (path) =>
    path === '/auth/v1/verify'
      ? session()
      : new Promise((yes) => {
          release = yes
        })
  )
  h.current.value = session()
  const flow = h.api.createAccountSecurityFlow(A)
  await flow.verify(phone, '123456')
  const saving = flow.setPassword('password1')
  h.scope.value++
  h.current.value = session(B)
  release(session().user)
  await assert.rejects(saving, { code: 'SESSION_CHANGED' })
  assert.equal(h.current.value.user.id, B)
  assert.equal(h.saved.length, 0)
})
