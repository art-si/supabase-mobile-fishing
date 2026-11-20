import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as authContract from '../src/domain/auth-errors'
import * as userErrors from '../src/domain/user-errors'

// Exercise the actual service modules with in-memory platform/dependency doubles.
// No environment files, real credentials, network calls or SMS are used.
function loadService(file: string, dependencies: Record<string, unknown>, globals = {}) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const exports: Record<string, any> = {}
  runInNewContext(compiled, {
    exports,
    Error,
    require(name: string) {
      if (!(name in dependencies)) throw new Error(`Unexpected test dependency: ${name}`)
      return dependencies[name]
    },
    ...globals
  })
  return exports
}

function httpHarness(response: unknown, key = 'public-fixture') {
  const calls: unknown[] = []
  const service = loadService(
    'services/http.ts',
    {
      '@/config': { config: { supabaseUrl: 'https://test.invalid', supabaseKey: key } },
      '@/domain/auth-errors': authContract,
      '@/domain/user-errors': userErrors
    },
    {
      uni: {
        request(options: any) {
          calls.push(options)
          options.success(response)
        }
      }
    }
  )
  return { ...service, calls }
}

function authHarness(
  request: (...args: any[]) => Promise<unknown>,
  flags = { isDemo: false, phoneAuth: true, captcha: false }
) {
  const { ApiError } = httpHarness({})
  const scope = { value: 0 }
  const saved: unknown[] = []
  const notice = { value: 'prior notice' }
  const service = loadService('stores/auth.ts', {
    vue: {
      computed: (getter: () => unknown) => ({
        get value() {
          return getter()
        }
      })
    },
    pinia: { defineStore: (_name: string, setup: () => unknown) => setup },
    '@/config': { isDemo: flags.isDemo, config: flags },
    '@/services/http': { request, ApiError },
    '@/domain/rules': { normalizePhone: () => 'normalized-phone-fixture' },
    '@/domain/auth-errors': authContract,
    '@/services/session': {
      demoUser: { value: false },
      session: { value: null },
      sessionScope: scope,
      sessionNotice: notice,
      hydrateSession() {},
      signOut() {},
      enterDemoSession() {},
      saveSession(value: unknown) {
        saved.push(value)
      },
      assertSession(started: number) {
        if (started !== scope.value) throw new ApiError('账号状态已变化', 409, 'SESSION_CHANGED')
      }
    }
  })
  return { auth: service.useAuthStore(), saved, scope, notice }
}

test('HTTP auth failures retain status/code/retry delay and never expose upstream details', async () => {
  const service = httpHarness({
    statusCode: 429,
    header: { 'Retry-After': '30' },
    data: { error_code: 'over_sms_send_rate_limit', msg: 'private vendor diagnostic' }
  })
  await assert.rejects(service.request('/auth/v1/otp'), (error: any) => {
    assert.equal(error.status, 429)
    assert.equal(error.code, 'over_sms_send_rate_limit')
    assert.equal(error.retryAfter, 30)
    assert.match(error.message, /验证码发送过于频繁/)
    assert.doesNotMatch(error.message, /private|vendor|diagnostic/)
    return true
  })
})

test('HTTP keeps existing business errors and handles malformed error bodies safely', async () => {
  const business = httpHarness({ statusCode: 403, data: { message: 'NOT_FRIENDS' } })
  await assert.rejects(business.request('/rest/v1/rpc/fishing_write'), {
    code: 'NOT_FRIENDS',
    message: '双方成为好友后才能发送消息'
  })
  for (const data of [null, 'upstream failure', { message: {}, code: 500 }]) {
    const service = httpHarness({ statusCode: 503, data })
    await assert.rejects(service.request('/auth/v1/verify'), {
      message: '登录服务暂时不可用，请稍后重试'
    })
  }
  const unavailable = httpHarness({}, '')
  await assert.rejects(unavailable.request('/auth/v1/otp'), { code: 'SERVICE_UNAVAILABLE' })
  assert.equal(unavailable.calls.length, 0)
})

test('HTTP public errors use exact codes, retain status and do not echo diagnostics', async () => {
  const diagnostics = [
    'Supabase: set Web Key in backend deployment',
    'Unable to read private CONFIG: MAP_NOT_CONFIGURED',
    'https://private.invalid/?secret=fixture NOT_FRIENDS',
    '服务端 SQL 执行错误，连接串 fixture-secret',
    'constructor',
    '__proto__'
  ]
  for (const message of diagnostics) {
    const service = httpHarness({ statusCode: 503, data: { code: 'vendor_failure', message } })
    await assert.rejects(service.request('/functions/v1/amap'), (error: any) => {
      assert.equal(error.status, 503)
      assert.equal(error.code, 'vendor_failure')
      assert.equal(error.message, '服务暂时不可用，请稍后重试')
      assert.equal(userErrors.userErrorText(error), error.message)
      return true
    })
  }
  for (const code of ['MAP_NOT_CONFIGURED', 'MAP_BACKEND_UNAVAILABLE', 'EDIT_CONFLICT']) {
    const service = httpHarness({ statusCode: 409, data: { code, message: diagnostics[0] } })
    await assert.rejects(service.request('/rest/v1/rpc/fishing_write'), (error: any) => {
      assert.equal(error.status, 409)
      assert.equal(error.code, code)
      assert.equal(error.message, userErrors.serviceErrorMessage(code))
      assert.doesNotMatch(error.message, /Supabase|Key|配置|部署|接入|后台/i)
      return true
    })
  }
})

test('HTTP network failure is actionable and retains a non-success code', async () => {
  const service = loadService(
    'services/http.ts',
    {
      '@/config': { config: { supabaseUrl: 'https://test.invalid', supabaseKey: 'fixture' } },
      '@/domain/auth-errors': authContract,
      '@/domain/user-errors': userErrors
    },
    { uni: { request: (options: any) => options.fail({ errMsg: 'private DNS diagnostic' }) } }
  )
  await assert.rejects(service.request('/functions/v1/amap'), {
    status: 0,
    code: 'NETWORK_ERROR',
    message: '网络连接中断，请检查网络后重试'
  })
})

test('Both SMS methods refuse disallowed environments before making any request', async () => {
  for (const flags of [
    { isDemo: true, phoneAuth: true, captcha: false },
    { isDemo: false, phoneAuth: false, captcha: false },
    { isDemo: false, phoneAuth: true, captcha: true }
  ]) {
    let calls = 0
    const { auth, saved } = authHarness(async () => {
      calls++
      return {}
    }, flags)
    await assert.rejects(auth.sendCode('phone-fixture'))
    await assert.rejects(auth.verify('phone-fixture', '123456'))
    assert.equal(calls, 0)
    assert.equal(saved.length, 0)
  }
})

test('SMS send allows first-time registration but does not create a local login before verification', async () => {
  const calls: any[] = []
  const { auth, saved, notice } = authHarness(async (...args) => {
    calls.push(args)
    return {}
  })
  await auth.sendCode('phone-fixture')
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], '/auth/v1/otp')
  assert.equal(calls[0][1].method, 'POST')
  assert.equal(calls[0][1].data.phone, 'normalized-phone-fixture')
  assert.equal(calls[0][1].data.create_user, true)
  assert.equal(calls[0][1].data.channel, 'sms')
  assert.equal(saved.length, 0)
  assert.equal(notice.value, 'prior notice')
})

test('SMS send rejects stale success and stale failure after an account change', async () => {
  for (const fails of [false, true]) {
    let finish!: () => void
    const request = () =>
      new Promise((resolve, reject) => {
        finish = () => (fails ? reject(new Error('old request failed')) : resolve({}))
      })
    const { auth, scope } = authHarness(request)
    const sending = auth.sendCode('phone-fixture')
    scope.value++
    finish()
    await assert.rejects(sending, { code: 'SESSION_CHANGED' })
  }
})

test('OTP verification uses the server result, trims pasted codes and saves only complete sessions', async () => {
  const calls: any[] = []
  const valid = {
    access_token: 'access-fixture',
    refresh_token: 'refresh-fixture',
    expires_in: 3600,
    user: { id: '11111111-1111-4111-8111-111111111111' }
  }
  const { auth, saved, notice } = authHarness(async (...args) => {
    calls.push(args)
    return valid
  })
  await auth.verify('phone-fixture', ' 123456 ')
  assert.equal(calls[0][0], '/auth/v1/verify')
  assert.equal(calls[0][1].data.token, '123456')
  assert.equal(calls[0][1].data.type, 'sms')
  assert.equal(saved.length, 1)
  assert.equal(notice.value, '')
  const invalid = authHarness(async () => ({}))
  await assert.rejects(invalid.auth.verify('phone-fixture', '123456'), {
    code: 'AUTH_RESPONSE_INVALID'
  })
  assert.equal(invalid.saved.length, 0)
  assert.equal(invalid.notice.value, 'prior notice')
})

test('OTP verification cannot save a session after the account scope changes', async () => {
  let finish!: (value: unknown) => void
  const { auth, scope, saved } = authHarness(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const verifying = auth.verify('phone-fixture', '123456')
  scope.value++
  finish({})
  await assert.rejects(verifying, { code: 'SESSION_CHANGED' })
  assert.equal(saved.length, 0)
})

test('OTP verification refuses an already inactive page without a request', async () => {
  let calls = 0
  const { auth, saved, notice } = authHarness(async () => {
    calls++
    return {}
  })
  await assert.rejects(auth.verify('phone-fixture', '123456', { isActive: () => false }), {
    code: 'AUTH_CANCELLED',
    message: '已取消登录'
  })
  assert.equal(calls, 0)
  assert.equal(saved.length, 0)
  assert.equal(notice.value, 'prior notice')
})

test('Leaving the SMS page cancels pending success and failure without saving or exposing stale errors', async () => {
  for (const fails of [false, true]) {
    let active = true
    let finish!: () => void
    const { auth, saved, notice } = authHarness(
      () =>
        new Promise((resolve, reject) => {
          finish = () =>
            fails
              ? reject(new Error('private stale upstream failure'))
              : resolve({
                  access_token: 'access-fixture',
                  refresh_token: 'refresh-fixture',
                  expires_in: 3600,
                  user: { id: '11111111-1111-4111-8111-111111111111' }
                })
        })
    )
    const verifying = auth.verify('phone-fixture', '123456', { isActive: () => active })
    active = false
    finish()
    await assert.rejects(verifying, (error: any) => {
      assert.equal(error.code, 'AUTH_CANCELLED')
      assert.equal(error.message, '已取消登录')
      assert.doesNotMatch(error.message, /private|stale|upstream/)
      return true
    })
    assert.equal(saved.length, 0)
    assert.equal(notice.value, 'prior notice')
  }
})
