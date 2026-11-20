import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as capability from '../src/domain/phone-login-capability'
import * as authContract from '../src/domain/auth-errors'

// Contract-only doubles: no environment files, native SDK, phone number or network are used.
class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = ''
  ) {
    super(message)
  }
}

const sessionFixture = {
  access_token: 'access-fixture',
  refresh_token: 'refresh-fixture',
  expires_in: 3600,
  user: { id: '11111111-1111-4111-8111-111111111111' }
}
const consent = { consent: true }

function preprocess(source: string, target: string) {
  const enabled = [true]
  return source
    .split('\n')
    .filter((line) => {
      const directive = line.match(/^\s*\/\/ #(ifdef|ifndef|endif)(?:\s+(\S+))?/)
      if (!directive) return enabled.at(-1)
      if (directive[1] === 'endif') enabled.pop()
      else
        enabled.push(
          Boolean(enabled.at(-1)) &&
            (directive[1] === 'ifdef' ? directive[2] === target : directive[2] !== target)
        )
      return false
    })
    .join('\n')
}

interface HarnessOptions {
  target?: string
  platform?: string
  native?: boolean
  plugin?: boolean
  isDemo?: boolean
  backendReady?: boolean
  enabled?: boolean
  subject?: string
  check?: () => Promise<unknown>
  authorize?: () => Promise<unknown>
  request?: () => Promise<unknown>
  login?: () => Promise<unknown>
}

function harness(options: HarnessOptions = {}) {
  const source = preprocess(
    readFileSync(new URL('../src/services/phone-login.ts', import.meta.url), 'utf8'),
    options.target || 'H5'
  )
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const calls: Array<{ step: string; data?: any }> = []
  const saved: unknown[] = []
  const scope = { value: 0 }
  const notice = { value: 'existing notice' }
  const invoke = (
    step: string,
    action: (() => Promise<unknown>) | undefined,
    fallback: unknown
  ) => {
    calls.push({ step })
    return action ? action() : Promise.resolve(fallback)
  }
  const dependencies: Record<string, unknown> = {
    '@/config': {
      config: {
        wechatPhone: options.enabled ?? true,
        operatorPhone: options.enabled ?? true,
        miniProgramSubject: options.subject || 'organization'
      },
      isDemo: options.isDemo ?? false,
      backendReady: options.backendReady ?? true
    },
    '@/domain/auth-errors': authContract,
    '@/domain/phone-login-capability': capability,
    './http': {
      ApiError,
      request: (_path: string, requestOptions: unknown) => {
        calls.push({ step: 'request', data: requestOptions })
        return options.request ? options.request() : Promise.resolve(sessionFixture)
      }
    },
    './session': {
      sessionScope: scope,
      sessionNotice: notice,
      saveSession(value: unknown) {
        saved.push(value)
        scope.value++
      },
      assertSession(started: number) {
        if (started !== scope.value) throw new ApiError('账号状态已变化', 409, 'SESSION_CHANGED')
      }
    },
    '@capacitor/core': {
      Capacitor: {
        getPlatform: () => options.platform || 'android',
        isNativePlatform: () => options.native ?? true,
        isPluginAvailable: () => options.plugin ?? true
      },
      registerPlugin: () => ({
        checkAvailability: () => invoke('check', options.check, { available: true }),
        authorize: () => invoke('authorize', options.authorize, { token: 'proof-fixture' })
      })
    }
  }
  const api: Record<string, any> = {}
  runInNewContext(compiled, {
    exports: api,
    Error,
    require: (name: string) => {
      assert.ok(name in dependencies, `unexpected dependency: ${name}`)
      return dependencies[name]
    },
    uni: {
      login: (callbacks: any) =>
        invoke('login', options.login, { code: 'login-proof-fixture' }).then(
          callbacks.success,
          callbacks.fail
        )
    }
  })
  return { api, calls, saved, scope, notice }
}

test('Phone capability rejects personal/unknown WeChat subjects and wrong runtimes', () => {
  const base = { isDemo: false, backendReady: true, enabled: true, platform: 'wechat' as const }
  for (const subject of ['personal', '', 'unknown'])
    assert.equal(capability.wechatPhoneCapability({ ...base, subject }).available, false)
  assert.equal(
    capability.wechatPhoneCapability({ ...base, subject: 'organization' }).available,
    true
  )
  assert.equal(
    capability.wechatPhoneCapability({ ...base, subject: 'organization', platform: 'web' })
      .available,
    false
  )
  for (const value of [undefined, null, true, {}, { available: 'true' }, { available: false }])
    assert.equal(capability.operatorCapabilityFromCheck(value).available, false)
})

test('Native plugin registration allows only an entry; vendor check requires explicit consent', async () => {
  const { api, calls } = harness()
  assert.equal(api.operatorEntryAvailable(), true)
  assert.equal(api.operatorAvailable(), false)
  assert.equal(calls.length, 0)
  await assert.rejects(api.checkOperatorAvailability(), { code: 'CONSENT_REQUIRED' })
  await assert.rejects(api.operatorPhoneLogin(), { code: 'CONSENT_REQUIRED' })
  await assert.rejects(api.wechatPhoneLogin('proof'), { code: 'CONSENT_REQUIRED' })
  assert.equal(calls.length, 0)
  assert.equal((await api.checkOperatorAvailability(consent)).available, true)
  assert.equal(api.operatorAvailable(), true)
  assert.deepEqual(
    calls.map(({ step }) => step),
    ['check']
  )
})

test('Disabled/demo/missing-backend/missing-plugin/browser/other runtimes never call vendor or exchange', async () => {
  for (const options of [
    { enabled: false },
    { isDemo: true },
    { backendReady: false },
    { plugin: false },
    { native: false },
    { platform: 'web' },
    { target: 'MP-WEIXIN' },
    { target: 'OTHER' }
  ]) {
    const { api, calls, saved } = harness(options)
    assert.equal(api.operatorEntryAvailable(), false)
    await assert.rejects(api.operatorPhoneLogin(consent))
    assert.equal(calls.length, 0)
    assert.equal(saved.length, 0)
  }
})

test('Personal WeChat and non-mini-program runtimes cannot request WeChat login', async () => {
  for (const options of [
    { target: 'MP-WEIXIN', subject: 'personal' },
    {},
    { target: 'MP-WEIXIN', isDemo: true }
  ]) {
    const { api, calls } = harness(options)
    assert.equal(api.wechatPhoneAvailable(), false)
    await assert.rejects(api.wechatPhoneLogin('phone-proof', consent), {
      code: 'PHONE_AUTH_UNAVAILABLE'
    })
    assert.equal(calls.length, 0)
  }
})

test('SDK check failure or malformed result never authorizes or leaks vendor details', async () => {
  for (const check of [
    async () => ({}),
    async () => ({ available: 'true' }),
    async () => {
      throw new Error('vendor-private-diagnostic')
    }
  ]) {
    const { api, calls } = harness({ check })
    await assert.rejects(api.operatorPhoneLogin(consent), (error: any) => {
      assert.equal(error.code, 'PHONE_AUTH_UNAVAILABLE')
      assert.doesNotMatch(error.message, /vendor|private|diagnostic/)
      return true
    })
    assert.equal(api.operatorAvailable(), false)
    assert.deepEqual(
      calls.map(({ step }) => step),
      ['check']
    )
  }
})

test('Cancellation and invalid proofs never reach the backend', async () => {
  for (const proof of [
    null,
    {},
    { token: '' },
    { token: 'has space' },
    { token: 'x'.repeat(16385) },
    { token: 'ignored-proof', cancelled: true }
  ]) {
    const { api, calls, saved } = harness({ authorize: async () => proof })
    await assert.rejects(api.operatorPhoneLogin(consent))
    assert.equal(
      calls.some(({ step }) => step === 'request'),
      false
    )
    assert.equal(saved.length, 0)
  }
  const cancelled = harness({
    authorize: async () => {
      throw { code: 'USER_CANCELLED', message: 'private detail' }
    }
  })
  await assert.rejects(cancelled.api.operatorPhoneLogin(consent), {
    code: 'AUTH_CANCELLED',
    message: '已取消登录'
  })
  const wechat = harness({ target: 'MP-WEIXIN', login: async () => ({ code: '' }) })
  await assert.rejects(wechat.api.wechatPhoneLogin('phone-proof', consent), {
    code: 'PHONE_AUTH_PROOF_INVALID'
  })
  assert.equal(
    wechat.calls.some(({ step }) => step === 'request'),
    false
  )
})

test('Only a complete fresh Supabase session is saved for either phone provider', async () => {
  for (const target of ['H5', 'MP-WEIXIN']) {
    for (const response of [
      {},
      { ...sessionFixture, refresh_token: '' },
      { ...sessionFixture, expires_at: 1 }
    ]) {
      const { api, saved, notice } = harness({ target, request: async () => response })
      const login =
        target === 'H5'
          ? api.operatorPhoneLogin(consent)
          : api.wechatPhoneLogin('phone-proof', consent)
      await assert.rejects(login, { code: 'AUTH_RESPONSE_INVALID' })
      assert.equal(saved.length, 0)
      assert.equal(notice.value, 'existing notice')
    }
    const valid = harness({ target })
    if (target === 'H5') await valid.api.operatorPhoneLogin(consent)
    else await valid.api.wechatPhoneLogin('phone-proof', consent)
    assert.equal(valid.saved.length, 1)
    assert.equal(valid.notice.value, '')
    assert.equal((valid.saved[0] as any).refresh_token, sessionFixture.refresh_token)
    assert.ok((valid.saved[0] as any).expires_at > Date.now() / 1000)
    assert.equal(valid.calls.at(-1)?.data.data.provider, target === 'H5' ? 'operator' : 'wechat')
  }
})

test('Every async success/failure rejects changed account scope before saving', async () => {
  for (const step of ['check', 'authorize', 'request', 'login'] as const) {
    for (const fails of [false, true]) {
      let release!: () => void
      let reached!: () => void
      const pending = new Promise<void>((resolve) => {
        reached = resolve
      })
      const options: HarnessOptions = {
        target: step === 'login' ? 'MP-WEIXIN' : 'H5',
        [step]: () =>
          new Promise((resolve, reject) => {
            reached()
            release = () =>
              fails
                ? reject(new Error('stale-failure'))
                : resolve(
                    step === 'check'
                      ? { available: true }
                      : step === 'request'
                        ? sessionFixture
                        : { token: 'proof', code: 'proof' }
                  )
          })
      }
      const { api, saved, scope } = harness(options)
      const login =
        step === 'login'
          ? api.wechatPhoneLogin('phone-proof', consent)
          : api.operatorPhoneLogin(consent)
      await pending
      scope.value++
      release()
      await assert.rejects(login, { code: 'SESSION_CHANGED' })
      assert.equal(saved.length, 0)
    }
  }
})

test('Leaving the page and concurrent authorizations cannot overwrite a session', async () => {
  let finish!: (value: unknown) => void
  let reached!: () => void
  const pending = new Promise<void>((resolve) => {
    reached = resolve
  })
  let active = true
  const { api, saved } = harness({
    authorize: () =>
      new Promise((resolve) => {
        finish = resolve
        reached()
      })
  })
  const first = api.operatorPhoneLogin({ consent: true, isActive: () => active })
  await pending
  await assert.rejects(api.operatorPhoneLogin(consent), { code: 'AUTH_IN_PROGRESS' })
  active = false
  finish({ token: 'proof-fixture' })
  await assert.rejects(first, { code: 'AUTH_CANCELLED' })
  assert.equal(saved.length, 0)
})
