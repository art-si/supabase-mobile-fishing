import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { ref } from 'vue'
import { authSessionFromResponse, authSessionFromStorage } from '../src/domain/auth-errors'
import { privateStorageKey } from '../src/domain/private-storage'
import { createCredentialStore } from '../src/_mobile-core/credential-store'
import { createAppForeground } from '../src/_mobile-core/app-foreground'

// Execute the real session implementation with only its platform/network boundary replaced.
// No real users, credentials, SMS or network requests are involved.
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code = ''
  ) {
    super(message)
  }
}
const ids = { A: '11111111-1111-4111-8111-111111111111', B: '22222222-2222-4222-8222-222222222222' }
function session(who: 'A' | 'B', expires_at = Date.now() / 1000 + 3600, suffix = '') {
  return {
    access_token: `access-${who}${suffix}`,
    refresh_token: `refresh-${who}${suffix}`,
    expires_at,
    user: { id: ids[who] }
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function harness(
  request: (...args: any[]) => Promise<any> = async () => ({}),
  {
    native = false,
    secure = new Map<string, string>(),
    secureRead = undefined as undefined | (() => Promise<string | null>),
    waitForEntryLocation = (): Promise<void> | undefined => undefined
  } = {}
) {
  const storage = new Map<string, any>(),
    failRemoval = new Set<string>()
  let failWrites = false,
    discarded = 0
  const source = readFileSync(new URL('../src/services/session.ts', import.meta.url), 'utf8')
  const dependencies: Record<string, unknown> = {
    vue: { ref },
    './http': { request, ApiError },
    './entry-location': { waitForEntryLocation },
    '@/domain/private-storage': { privateStorageKey },
    '@/domain/auth-errors': { authSessionFromResponse, authSessionFromStorage },
    './draft-handoff': {
      clearTripDraft: () => {
        discarded++
      }
    },
    './native-credentials': {
      nativeCredentialsAvailable: () => native,
      nativeCredentials: createCredentialStore({
        read: secureRead || (async () => secure.get('session') || null),
        write: async (value) => {
          if (failWrites) throw new Error('locked')
          secure.set('session', value)
        },
        remove: async () => {
          if (failRemoval.has('session')) throw new Error('locked')
          secure.delete('session')
        }
      })
    },
    '@capacitor/core': { Capacitor: { isNativePlatform: () => false } }
  }
  const exports: Record<string, any> = {}
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    {
      exports,
      Error,
      require(name: string) {
        assert.ok(name in dependencies, name)
        return dependencies[name]
      },
      uni: {
        getStorageSync: (key: string) => storage.get(key),
        setStorageSync(key: string, value: unknown) {
          if (failWrites) throw new Error('storage full')
          storage.set(key, value)
        },
        removeStorageSync(key: string) {
          if (failRemoval.has(key)) throw new Error('storage denied')
          storage.delete(key)
        },
        getStorageInfoSync: () => ({ keys: [...storage.keys()] })
      }
    }
  )
  return {
    api: exports,
    storage,
    failRemoval,
    failWrites: () => {
      failWrites = true
    },
    discarded: () => discarded
  }
}
function appHarness(api: Record<string, any>) {
  const source = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8').match(
    /<script setup lang="ts">([\s\S]*?)<\/script>/
  )?.[1]
  assert.ok(source, 'App script exists')
  let launch!: () => void,
    show!: () => void,
    hide!: () => void,
    appearanceRefreshes = 0
  const resumes: Promise<void>[] = []
  const dependencies: Record<string, unknown> = {
    vue: { onUnmounted() {}, watch() {} },
    '@dcloudio/uni-app': {
      onLaunch: (callback: () => void) => {
        launch = callback
      },
      onShow: (callback: () => void) => {
        show = callback
      },
      onHide: (callback: () => void) => {
        hide = callback
      }
    },
    '@/stores/auth': { useAuthStore: () => ({ hydrate: api.hydrateSession }) },
    '@/services/session': {
      watchExternalSessions() {},
      resumeSession() {
        const resumed = api.resumeSession()
        resumes.push(resumed)
        return resumed
      }
    },
    // Session lifecycle tests never open the independent Realtime transport.
    '@/services/live-updates': { initializeLiveUpdates() {}, setLiveForeground() {} },
    '@/services/app-activity': { setAppForeground() {} },
    '@/services/entry-location': {
      checkEntryLocation() {},
      disposeEntryLocation() {},
      startEntryLocation() {},
      entryLocationReady: ref(true)
    },
    '@mobile-core/app-foreground': { createAppForeground },
    '@/stores/appearance': {
      watchSystemAppearance() {},
      useAppearanceStore: () => ({
        refreshSystem: () => {
          appearanceRefreshes++
        }
      })
    },
    '@capacitor/app': { App: {} },
    '@capacitor/core': { Capacitor: { isNativePlatform: () => false } },
    '@mobile-core/android-back': { registerAndroidBackHandler() {} }
  }
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    {
      exports: {},
      require(name: string) {
        assert.ok(name in dependencies, name)
        return dependencies[name]
      }
    }
  )
  return {
    launch: () => launch(),
    show: () => show(),
    hide: () => hide(),
    resumes,
    appearanceRefreshes: () => appearanceRefreshes
  }
}
test('session hydration validates all persisted credentials and expiry fields', () => {
  for (const bad of [
    {},
    { ...session('A'), access_token: '' },
    { ...session('A'), expires_at: NaN },
    { ...session('A'), user: { id: 'invalid' } }
  ]) {
    const { api, storage } = harness()
    storage.set('dyj.auth.v1', bad)
    api.hydrateSession()
    assert.equal(api.session.value, null)
  }
  const { api, storage } = harness()
  storage.set('dyj.auth.v1', session('A', 1))
  api.hydrateSession()
  assert.equal(api.session.value.user.id, ids.A, 'expired persisted sessions can still refresh')
})

test('retired local identity is ignored and cannot restore a real session', async () => {
  const { api, storage } = harness(async () => assert.fail('Unexpected network request'))
  storage.set('dyj.demo.signed-in', true)
  storage.set('dyj.demo.session', session('A'))
  await api.hydrateSession()
  assert.equal(api.session.value, null)
  assert.equal(api.sessionNotice.value, '')
})

test('a fresh guest with no stored session has no restoration error', async () => {
  const { api, storage } = harness()
  storage.set('dyj.auth.v1', '')
  await api.hydrateSession()
  assert.equal(api.session.value, null)
  assert.equal(api.sessionNotice.value, '')
})
test('waiting for startup location cannot release a request from a previous account', async () => {
  const checking = deferred<void>()
  const ready = deferred<void>()
  const calls: string[] = []
  const { api } = harness(async (_path, options) => {
    calls.push(options.token)
    return { items: [] }
  }, {
    waitForEntryLocation: () => {
      checking.resolve()
      return ready.promise
    }
  })
  await api.saveSession(session('A'))
  const pending = api.sessionRequest('/rest/v1/rpc/fishing_read')
  await checking.promise
  assert.deepEqual(calls, [])
  await api.saveSession(session('B'))
  ready.resolve()
  await assert.rejects(pending, { code: 'SESSION_CHANGED' })
  await api.sessionRequest('/rest/v1/rpc/fishing_read')
  assert.deepEqual(calls, ['access-B'])
})
test('a hydrated expired access token renews through its persisted refresh token', async () => {
  let calls = 0
  const { api, storage } = harness(async (path, options) => {
    calls++
    assert.equal(path, '/auth/v1/token?grant_type=refresh_token')
    assert.equal(options.data.refresh_token, 'refresh-A')
    return session('A', Date.now() / 1000 + 3600, '-renewed')
  })
  storage.set('dyj.auth.v1', session('A', 1))
  api.hydrateSession()
  assert.equal(await api.accessToken(), 'access-A-renewed')
  assert.equal(calls, 1)
  assert.ok(storage.get('dyj.auth.v1').expires_at > Date.now() / 1000)
})
test('foreground resume makes no requests for guests or valid sessions', async () => {
  let calls = 0
  const request = async () => {
    calls++
    return {}
  }
  const { api } = harness(request)
  await api.resumeSession()
  api.saveSession(session('A'))
  await api.resumeSession()
  assert.equal(calls, 0)
})

test('App onShow is non-blocking and repeated foreground events share one near-expiry refresh', async () => {
  const pending = deferred<any>()
  let calls = 0
  const { api, storage } = harness(async (path, options) => {
    calls++
    assert.equal(path, '/auth/v1/token?grant_type=refresh_token', 'never SMS or a profile read')
    assert.equal(options.data.refresh_token, 'refresh-A')
    return pending.promise
  })
  storage.set('dyj.auth.v1', session('A', Date.now() / 1000 + 30))
  const app = appHarness(api)
  app.launch()
  const scope = api.sessionScope.value
  assert.equal(app.show(), undefined, 'show does not wait for network')
  assert.equal(app.show(), undefined)
  const foregroundToken = api.accessToken()
  assert.equal(
    app.appearanceRefreshes(),
    1,
    'theme updates immediately without duplicate foreground work'
  )
  assert.equal(calls, 1)
  pending.resolve(session('A', Date.now() / 1000 + 3600, '-renewed'))
  await Promise.all(app.resumes)
  assert.equal(await foregroundToken, 'access-A-renewed')
  assert.equal(api.sessionScope.value, scope, 'refresh does not switch the account scope')
  assert.equal(storage.get('dyj.auth.v1').refresh_token, 'refresh-A-renewed')
  app.hide()
  app.show()
  await Promise.all(app.resumes)
  assert.equal(calls, 1, 'a valid foreground session does not fetch refresh or profile again')
})

test('foreground resume retains credentials after temporary failures and recovers on a later show', async () => {
  for (const error of [
    new Error('offline'),
    new ApiError('offline', 0),
    new ApiError('slow down', 429, 'over_request_rate_limit'),
    new ApiError('unavailable', 503, 'unexpected_failure'),
    new ApiError('bad gateway', 502, 'session_not_found'),
    new ApiError('invalid client configuration', 400, 'validation_failed'),
    new ApiError('invalid public key', 401, 'bad_jwt')
  ]) {
    let calls = 0
    const { api, storage } = harness(async (path) => {
      assert.equal(path, '/auth/v1/token?grant_type=refresh_token')
      if (++calls === 1) throw error
      return session('A', Date.now() / 1000 + 3600, '-recovered')
    })
    api.saveSession(session('A', 1))
    api.sessionNotice.value = 'existing notice'
    const app = appHarness(api)
    app.launch()
    const scope = api.sessionScope.value
    app.show()
    await Promise.all(app.resumes)
    assert.equal(calls, 1, 'background failure does not automatically retry')
    assert.equal(api.session.value.refresh_token, 'refresh-A', error.message)
    assert.equal(storage.get('dyj.auth.v1').refresh_token, 'refresh-A')
    assert.equal(api.sessionScope.value, scope)
    assert.equal(api.sessionNotice.value, 'existing notice')
    app.hide()
    app.show()
    await Promise.all(app.resumes)
    assert.equal(calls, 2)
    assert.equal(api.session.value.access_token, 'access-A-recovered')
    assert.equal(storage.get('dyj.auth.v1').refresh_token, 'refresh-A-recovered')
  }
})

test('explicitly invalid or revoked refresh sessions sign out while keeping account drafts', async () => {
  for (const code of [
    'refresh_token_not_found',
    'refresh_token_already_used',
    'session_not_found',
    'session_expired',
    'user_not_found',
    'user_banned'
  ]) {
    const { api, storage } = harness(async () => {
      throw new ApiError('invalid refresh session', code === 'user_banned' ? 403 : 400, code)
    })
    api.saveSession(session('A', 1))
    const key = `dyj.live.draft.${ids.A}.post`
    storage.set(key, { title: 'private' })
    await api.resumeSession()
    assert.equal(api.session.value, null, code)
    assert.equal(storage.has('dyj.auth.v1'), false)
    assert.ok(storage.has(key))
    assert.match(api.sessionNotice.value, /登录已失效.*草稿已保留/)
  }
})

test('a resumed old-account refresh cannot restore or revoke a newer account', async () => {
  for (const fails of [false, true]) {
    const pending = deferred<any>()
    const { api, storage } = harness(async () => pending.promise)
    api.saveSession(session('A', 1))
    const resumed = api.resumeSession()
    api.saveSession(null)
    api.saveSession(session('B'))
    api.sessionNotice.value = 'B notice'
    const scope = api.sessionScope.value
    if (fails) pending.reject(new ApiError('old session revoked', 400, 'refresh_token_not_found'))
    else pending.resolve(session('A'))
    await resumed
    assert.equal(api.session.value.user.id, ids.B)
    assert.equal(storage.get('dyj.auth.v1').user.id, ids.B)
    assert.equal(api.sessionScope.value, scope)
    assert.equal(api.sessionNotice.value, 'B notice')
  }
})

test('refresh refuses an already-expired response instead of installing it as a fresh session', async () => {
  const { api } = harness(async () => session('A', 1))
  api.saveSession(session('A', 1))
  await assert.rejects(api.accessToken(), { code: 'AUTH_RESPONSE_INVALID' })
  assert.equal(api.session.value, null)
})
test('refresh single-flight is generation bound and an old finally cannot release a new flight', async () => {
  const a = deferred<any>(),
    b = deferred<any>(),
    calls: string[] = []
  const { api } = harness(async (_path, options) => {
    calls.push(options.data.refresh_token)
    return options.data.refresh_token === 'refresh-A' ? a.promise : b.promise
  })
  api.saveSession(session('A', 1))
  const old = Promise.allSettled([api.accessToken(), api.accessToken()])
  assert.equal(calls.length, 1)
  api.saveSession(session('B', 1))
  const current = api.accessToken()
  a.resolve(session('A'))
  const rejected = await old
  assert.ok(rejected.every((r) => r.status === 'rejected' && r.reason.code === 'SESSION_CHANGED'))
  const shared = api.accessToken()
  assert.equal(calls.length, 2)
  b.resolve(session('B'))
  assert.deepEqual(await Promise.all([current, shared]), ['access-B', 'access-B'])
  assert.equal(api.session.value.user.id, ids.B)
})
test('refresh rejects a different identity and retains the original account draft', async () => {
  const { api, storage } = harness(async () => session('B'))
  api.saveSession(session('A', 1))
  const key = `dyj.live.draft.${ids.A}.post`
  storage.set(key, { title: 'private' })
  await assert.rejects(api.accessToken(), { code: 'AUTH_RESPONSE_INVALID' })
  assert.equal(api.session.value, null)
  assert.ok(storage.has(key))
  assert.match(api.sessionNotice.value, /草稿已保留/)
})
test('a response for an older access token does not expire an already refreshed session', async () => {
  const result = deferred<any>(),
    started = deferred<void>()
  const { api } = harness(async () => {
    started.resolve()
    return result.promise
  })
  api.saveSession(session('A'))
  const read = api.sessionRequest('/private')
  const denied = assert.rejects(read, { status: 401 })
  await started.promise
  const scope = api.sessionScope.value
  api.saveSession(session('A', Date.now() / 1000 + 3600, '-fresh'), true)
  result.reject(new ApiError('expired old token', 401))
  await denied
  assert.equal(api.session.value.access_token, 'access-A-fresh')
  assert.equal(api.sessionScope.value, scope)
})
test('logout immediately isolates local state; late server failure never overwrites a new login', async () => {
  const result = deferred<any>()
  const { api, storage, discarded } = harness(async () => result.promise)
  api.saveSession(session('A'))
  const key = `dyj.live.draft.${ids.A}.post`
  storage.set(key, { title: 'private' })
  storage.set(`dyj.live.draft.${ids.B}.post`, { title: 'keep' })
  const logout = api.signOut()
  assert.equal(api.session.value, null)
  assert.equal(storage.has('dyj.auth.v1'), false)
  assert.equal(storage.has(key), false)
  assert.ok(storage.has(`dyj.live.draft.${ids.B}.post`))
  assert.ok(discarded() > 0)
  api.saveSession(session('B'))
  api.sessionNotice.value = 'B notice'
  result.reject(new Error('offline'))
  const outcome = await logout
  assert.match(outcome.warning, /未能确认服务器会话撤销/)
  assert.equal(api.session.value.user.id, ids.B)
  assert.equal(api.sessionNotice.value, 'B notice')
})
test('storage failures are reported and do not stop best-effort cleanup of remaining owned keys', async () => {
  const { api, storage, failRemoval, failWrites } = harness()
  api.saveSession(session('A'))
  const failedKey = `dyj.live.draft.${ids.A}.post`,
    removableKey = `dyj.live.chat.${ids.A}.room`
  storage.set(failedKey, { title: 'private' })
  storage.set(removableKey, 'message')
  storage.set('unrelated', 'keep')
  failRemoval.add(failedKey)
  const result = await api.signOut()
  assert.match(result.warning, /存储未能完全清理/)
  assert.equal(storage.has(removableKey), false)
  assert.equal(storage.get('unrelated'), 'keep')
  failWrites()
  assert.equal(await api.saveSession(session('B')), false)
  assert.equal(api.session.value.user.id, ids.B, 'in-memory login is usable')
  assert.equal(storage.has('dyj.auth.v1'), false, 'no older credential is left behind')
  assert.match(api.sessionNotice.value, /未能保存登录状态/)
})

test('native restart restores only the secure session, refreshes it and logout removes it', async () => {
  const secure = new Map<string, string>()
  const first = harness(async () => ({}), { native: true, secure })
  await first.api.saveSession(session('A', 1))
  assert.equal(first.storage.has('dyj.auth.v1'), false, 'no token in ordinary native storage')
  const restarted = harness(
    async (path) => {
      assert.equal(path, '/auth/v1/token?grant_type=refresh_token')
      return session('A', Date.now() / 1000 + 3600, '-restart')
    },
    { native: true, secure }
  )
  assert.equal(restarted.api.sessionReady.value, false)
  await restarted.api.hydrateSession()
  assert.equal(restarted.api.sessionReady.value, true)
  assert.equal(await restarted.api.accessToken(), 'access-A-restart')
  assert.equal(JSON.parse(secure.get('session')!).refresh_token, 'refresh-A-restart')
  await restarted.api.signOut()
  assert.equal(secure.has('session'), false)
  const next = harness(undefined, { native: true, secure })
  await next.api.hydrateSession()
  assert.equal(next.api.session.value, null)
})

test('a late native hydration cannot restore credentials after logout or a new login', async () => {
  for (const login of [false, true]) {
    const read = deferred<string | null>()
    const { api } = harness(undefined, { native: true, secureRead: () => read.promise })
    const restoring = api.hydrateSession()
    const saving = api.saveSession(login ? session('B') : null)
    read.resolve(JSON.stringify(session('A')))
    await Promise.all([restoring, saving])
    assert.equal(api.session.value?.user.id || '', login ? ids.B : '')
  }
})

test('native locked storage retains credentials and retries restoration on foreground', async () => {
  let reads = 0
  const secure = new Map([['session', JSON.stringify(session('A'))]])
  const { api, storage } = harness(undefined, {
    native: true,
    secure,
    secureRead: async () => {
      if (++reads === 1) throw new Error('Device locked')
      return secure.get('session') || null
    }
  })
  await api.hydrateSession()
  assert.equal(api.session.value, null)
  assert.equal(secure.has('session'), true)
  assert.equal(storage.size, 0, 'no plaintext fallback')
  await api.resumeSession()
  assert.equal(api.session.value.user.id, ids.A)
  assert.equal(reads, 2)
})
