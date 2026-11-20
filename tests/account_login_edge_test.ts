import { createAccountLoginHandler } from '../supabase/functions/account-login/handler.ts'

// Local boundary fixtures. No network/environment permissions and no real credential or SMS.
const id = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const phone = '+8613800000000'
const handle = 'DY000000000001'
const now = 1_800_000_000_000
const config = {
  url: 'https://auth-fixture.invalid',
  anonKey: 'fixture-public',
  serviceKey: 'fixture-server'
}
const session = {
  access_token: 'fixture-access',
  refresh_token: 'fixture-refresh',
  expires_in: 3600,
  user: { id, phone }
}
const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
function fixture(
  overrides: Record<string, (init: RequestInit) => Response | Promise<Response>> = {},
  timeoutMs = 8000
) {
  const calls: { path: string; init: RequestInit }[] = []
  const f: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)),
      path = url.pathname + url.search
    check(url.origin === config.url, 'fixed backend destination')
    check(init.redirect === 'error' && init.signal, 'bounded request and no redirects')
    calls.push({ path, init })
    if (overrides[path]) return await overrides[path](init)
    if (path === '/rest/v1/rpc/fishing_account_login_ticket')
      return json({ allowed: true, user_id: id })
    if (path === '/auth/v1/admin/users/' + id)
      return json({ id, phone, phone_confirmed_at: '2026-01-01T00:00:00Z' })
    if (path === '/auth/v1/token?grant_type=password') return json(session)
    if (path === '/auth/v1/logout?scope=local') return json({})
    throw new Error('unexpected endpoint')
  }
  return {
    calls,
    handler: createAccountLoginHandler(config, { fetch: f, now: () => now, timeoutMs })
  }
}
function request(body: unknown = { identifier: handle, password: ' ExactPassword1 ' }) {
  return new Request('https://login-fixture.invalid/account-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}
const ticket = '/rest/v1/rpc/fishing_account_login_ticket'
const admin = '/auth/v1/admin/users/' + id
const grant = '/auth/v1/token?grant_type=password'
Deno.test(
  'handle login uses server-only resolution and native password grant, preserving UUID and exact password',
  async () => {
    const f = fixture(),
      response = await f.handler(
        request({ identifier: ' dy000000000001 ', password: ' ExactPassword1 ' })
      )
    const body = await response.json()
    check(
      response.status === 200 && body.user.id === id && body.access_token === session.access_token,
      'genuine session'
    )
    check(response.headers.get('cache-control') === 'no-store', 'never cache credentials')
    check(f.calls.length === 3, 'no signup/SMS/extra requests')
    check(
      JSON.parse(String(f.calls[0].init.body)).login_handle === handle,
      'canonical public handle'
    )
    for (const call of f.calls.slice(0, 2))
      check(
        new Headers(call.init.headers).get('authorization') === 'Bearer fixture-server',
        'server lookup only'
      )
    const auth = f.calls[2]
    check(
      !new Headers(auth.init.headers).has('authorization'),
      'do not authenticate password grant as administrator'
    )
    check(
      new Headers(auth.init.headers).get('apikey') === 'fixture-public',
      'native public password API'
    )
    const submitted = JSON.parse(String(auth.init.body))
    check(
      submitted.phone === phone && submitted.password === ' ExactPassword1 ',
      'unaltered password to current bound phone'
    )
    check(
      !JSON.stringify(body).includes('fixture-server') && Object.keys(body).length === 4,
      'minimal session, no service credentials'
    )
  }
)
Deno.test(
  'missing handle and wrong password have the same safe failure with no phone disclosure',
  async () => {
    const absent = fixture({ [ticket]: () => json({ allowed: true, user_id: null }) })
    const wrong = fixture({
      [grant]: () =>
        json({ error_code: 'invalid_credentials', phone, diagnostic: 'PRIVATE_SENTINEL' }, 400)
    })
    const a = await absent.handler(request()),
      b = await wrong.handler(request())
    check(
      a.status === 400 && b.status === 400 && (await a.text()) === (await b.text()),
      'generic credential failure'
    )
    check(absent.calls.length === 1, 'never call Auth for an absent handle')
  }
)
Deno.test(
  'durable rate limit fails closed before lookup and exposes bounded Retry-After',
  async () => {
    for (const failure of [false, true]) {
      const f = fixture({
        [ticket]: () =>
          failure
            ? json({ error: 'PRIVATE_SENTINEL' }, 503)
            : json({ allowed: false, retry_after: 125 })
      })
      const r = await f.handler(request())
      check(r.status === (failure ? 503 : 429) && f.calls.length === 1, 'do not bypass ticket')
      if (!failure) check(r.headers.get('retry-after') === '125', 'readable retry period')
      check(!(await r.text()).includes('PRIVATE_SENTINEL'), 'no raw error')
    }
  }
)
Deno.test('malformed, oversize and empty requests never reach a privileged endpoint', async () => {
  const f = fixture()
  const bodies = [
    { identifier: 'nickname', password: 'password1' },
    { identifier: handle, password: '' },
    { identifier: handle, password: 'x'.repeat(129) },
    { identifier: handle, password: 'x', padding: 'x'.repeat(5000) }
  ]
  for (const body of bodies)
    check((await f.handler(request(body))).status === 400, 'reject invalid input')
  const bad = new Request('https://login-fixture.invalid', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'invalid json'
  })
  check((await f.handler(bad)).status === 400 && f.calls.length === 0, 'no backend request')
})
Deno.test(
  'CORS and method handling support H5/miniapp without cookies or credentialed cross-origin access',
  async () => {
    const f = fixture()
    const options = await f.handler(
      new Request('https://login-fixture.invalid', { method: 'OPTIONS' })
    )
    check(
      options.status === 204 && options.headers.get('access-control-allow-origin') === '*',
      'public preflight'
    )
    check(!options.headers.has('access-control-allow-credentials'), 'no credentialed cookies')
    check(
      (await f.handler(new Request('https://login-fixture.invalid'))).status === 405 &&
        f.calls.length === 0,
      'POST only'
    )
  }
)
Deno.test('deleted, unverified or mismatched accounts cannot receive a session', async () => {
  for (const user of [
    { id, phone },
    { id: other, phone, phone_confirmed_at: 'verified' },
    { id, phone: 'bad', phone_confirmed_at: 'verified' }
  ]) {
    const f = fixture({ [admin]: () => json(user) }),
      r = await f.handler(request())
    check(r.status === 400 && f.calls.length === 2, 'reject before password grant')
  }
  const deleted = fixture({ [admin]: () => json({}, 404) })
  check((await deleted.handler(request())).status === 400, 'deleted account fails generically')
})
Deno.test(
  'phone reassignment cannot sign into another UUID and revokes the unreturned session',
  async () => {
    for (const user of [
      { id: other, phone },
      { id, phone: '+8613900000000' }
    ]) {
      const f = fixture({ [grant]: () => json({ ...session, user }) }),
        r = await f.handler(request())
      check(
        r.status === 400 && f.calls.at(-1)?.path === '/auth/v1/logout?scope=local',
        'revoke mismatched session'
      )
      check(!(await r.text()).includes('fixture-access'), 'never return wrong-account credentials')
    }
  }
)
Deno.test(
  'incomplete or expired native sessions are rejected, never substituted or self-signed',
  async () => {
    for (const change of [
      { access_token: '' },
      { refresh_token: '' },
      { expires_in: -1 },
      { expires_at: now / 1000 - 1 },
      { access_token: 'token with spaces' }
    ]) {
      const f = fixture({ [grant]: () => json({ ...session, ...change }) })
      check((await f.handler(request())).status === 503, 'reject invalid native response')
    }
  }
)
Deno.test(
  'native Auth limit and outage are mapped without leaking diagnostic response bodies',
  async () => {
    for (const status of [429, 503]) {
      const f = fixture({
        [grant]: () => json({ message: 'PRIVATE_SENTINEL' }, status, { 'Retry-After': '91' })
      })
      const r = await f.handler(request())
      check(
        r.status === status && !(await r.text()).includes('PRIVATE_SENTINEL'),
        'safe failure mapping'
      )
      if (status === 429) check(r.headers.get('retry-after') === '91', 'preserve Auth retry window')
    }
  }
)
Deno.test(
  'network failures and stalled upstream requests are bounded and never retried',
  async () => {
    const failed = fixture({
      [ticket]: () => {
        throw new Error('PRIVATE_SENTINEL')
      }
    })
    check(
      (await failed.handler(request())).status === 503 && failed.calls.length === 1,
      'no automatic retry'
    )
    const stalled = fixture(
      {
        [ticket]: (init) =>
          new Promise((_, reject) =>
            init.signal?.addEventListener('abort', () => reject(new Error('timeout')), {
              once: true
            })
          )
      },
      20
    )
    const started = performance.now()
    check(
      (await stalled.handler(request())).status === 503 && performance.now() - started < 1000,
      'total timeout'
    )
  }
)
