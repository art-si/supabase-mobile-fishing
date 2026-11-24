import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createJsMapHandler,
  jsMapAllowedOrigins,
  type JsMapDependencies
} from '../supabase/functions/_shared/amap-js'

test('Pages proxy preserves configured origins and permits only the exact Pages host', async () => {
  const origins = jsMapAllowedOrigins(
    ' http://localhost:5179,capacitor://localhost,https://existing.example, '
  )
  assert.deepEqual(origins, [
    'http://localhost:5179',
    'capacitor://localhost',
    'https://existing.example',
    'https://art-si.github.io'
  ])
  const f = fixture({ allowedOrigins: origins })
  for (const origin of origins) {
    const response = await f.call(undefined, { headers: { Origin: origin } })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin)
  }
  for (const origin of [
    'https://other.github.io',
    'https://art-si.github.io.evil.example',
    'http://art-si.github.io'
  ])
    assert.equal((await f.call(undefined, { headers: { Origin: origin } })).status, 403)
  assert.equal(f.reservations(), origins.length)
})

function fixture(overrides: Partial<JsMapDependencies> = {}) {
  const requests: URL[] = []
  let reservations = 0
  const handler = createJsMapHandler({
    key: 'public-js-key',
    securityCode: 'server-only-security-code',
    allowedOrigins: ['http://localhost:5179', 'capacitor://localhost'],
    reserve: async () => {
      reservations++
      return true
    },
    fetch: (async (url) => {
      requests.push(new URL(String(url)))
      return Response.json({ status: '1', pois: [] })
    }) as typeof fetch,
    ...overrides
  })
  const call = (path = '/v3/place/text?key=public-js-key', options: RequestInit = {}) =>
    handler(
      new Request(`https://proxy.invalid/functions/v1/amap-js/_AMapService${path}`, {
        headers: { Origin: 'http://localhost:5179' },
        ...options
      })
    )
  return { call, requests, reservations: () => reservations }
}
test('JS map proxy uses fixed provider, server code, no-store and specific CORS', async () => {
  const f = fixture()
  const r = await f.call('/v3/place/text?key=public-js-key&keywords=湖&platform=JS')
  assert.equal(r.status, 200)
  assert.equal(f.requests[0].origin, 'https://restapi.amap.com')
  assert.equal(f.requests[0].searchParams.get('jscode'), 'server-only-security-code')
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5179')
  assert.equal(r.headers.get('Cache-Control'), 'no-store')
  assert.ok(!(await r.text()).includes('server-only'))
  assert.equal(f.reservations(), 1)
})
test('JS map proxy refuses unknown origins, missing provenance, methods and routes before spending', async () => {
  const f = fixture()
  for (const origin of ['https://evil.invalid', 'http://localhost:5179.evil.invalid', 'null'])
    assert.equal((await f.call(undefined, { headers: { Origin: origin } })).status, 403)
  assert.equal((await f.call(undefined, { headers: {} })).status, 403)
  assert.equal((await f.call(undefined, { method: 'POST' })).status, 405)
  for (const path of [
    '/v3/staticmap?key=public-js-key',
    '/v3/direction/driving?key=public-js-key',
    '//evil.invalid/?key=public-js-key'
  ])
    assert.equal((await f.call(path)).status, 404)
  assert.equal(f.reservations(), 0)
  assert.equal(f.requests.length, 0)
})
test('JS map proxy rejects substituted/duplicate keys, code injection, oversized queries and unsafe JSONP', async () => {
  const f = fixture()
  for (const query of [
    'key=other-key',
    'key=public-js-key&key=other-key',
    'key=public-js-key&jscode=evil',
    'key=public-js-key&callback=alert(1)',
    'key=public-js-key&callback=safe&callback=alert(1)',
    `key=public-js-key&q=${'x'.repeat(4100)}`
  ])
    assert.equal((await f.call(`/v3/place/text?${query}`)).status, 400)
  assert.equal(f.requests.length, 0)
  assert.equal(f.reservations(), 0)
})
test('JS SDK Geocoder identical duplicate key is canonicalized, not rejected', async () => {
  const f = fixture()
  assert.equal(
    (await f.call('/v3/geocode/regeo?key=public-js-key&key=public-js-key&location=120,31')).status,
    200
  )
  assert.deepEqual(f.requests[0].searchParams.getAll('key'), ['public-js-key'])
  assert.equal(f.requests[0].searchParams.getAll('jscode').length, 1)
})
test('JS autocomplete has one allowlisted route and retains origin/key/quota guards', async () => {
  const f = fixture()
  const path = '/v3/assistant/inputtips?key=public-js-key&keywords=湖&datatype=all'
  assert.equal((await f.call(path)).status, 200)
  assert.equal(f.requests[0].pathname, '/v3/assistant/inputtips')
  assert.equal(f.requests[0].hostname, 'restapi.amap.com')
  assert.equal(f.requests[0].searchParams.get('keywords'), '湖')
  assert.equal(f.reservations(), 1)
  assert.equal((await f.call(path, { headers: { Origin: 'https://evil.invalid' } })).status, 403)
  assert.equal((await f.call(path.replace('public-js-key', 'other'))).status, 400)
  assert.equal(f.requests.length, 1)
})
test('JS map proxy supports SDK JSONP referer and Capacitor without broad CORS', async () => {
  const f = fixture()
  const r = await f.call('/v3/log/init?key=public-js-key&callback=AMap.__test', {
    headers: { Referer: 'http://localhost:5179/' }
  })
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('Content-Type'), 'application/javascript; charset=utf-8')
  assert.equal(
    (await f.call(undefined, { headers: { Origin: 'capacitor://localhost' } })).status,
    200
  )
  assert.equal((await f.call(undefined, { method: 'OPTIONS' })).status, 204)
  assert.equal(f.requests.length, 2)
})
test('JS weather permits one six-digit region and supported modes only, before quota spending', async () => {
  const f = fixture()
  for (const mode of ['', '&extensions=base', '&extensions=all']) {
    assert.equal(
      (await f.call(`/v3/weather/weatherInfo?key=public-js-key&city=320500${mode}`)).status,
      200
    )
  }
  assert.equal(f.requests[0].hostname, 'restapi.amap.com')
  assert.equal(f.requests[0].pathname, '/v3/weather/weatherInfo')
  assert.equal(f.requests[0].searchParams.get('city'), '320500')
  for (const query of [
    '',
    'city=',
    'city=000000',
    'city=苏州',
    'city=320500,110000',
    'city=320500&city=110000',
    'city=320500&extensions=full',
    'city=320500&extensions=',
    'city=320500&extensions=base&extensions=all'
  ])
    assert.equal((await f.call(`/v3/weather/weatherInfo?key=public-js-key&${query}`)).status, 400)
  assert.equal(f.reservations(), 3)
  assert.equal(f.requests.length, 3)
})
test('JS map proxy fails closed for missing config and quota outage/limit', async () => {
  for (const [overrides, status] of [
    [{ securityCode: '' }, 503],
    [{ reserve: async () => false }, 429],
    [
      {
        reserve: async () => {
          throw new Error('db unavailable')
        }
      },
      502
    ]
  ] as const) {
    const f = fixture(overrides)
    assert.equal((await f.call()).status, status)
    assert.equal(f.requests.length, 0)
  }
})
test('JS map proxy rejects redirect, oversized, HTML and credential-reflecting provider responses', async () => {
  for (const response of [
    new Response(null, { status: 302, headers: { Location: 'https://evil.invalid' } }),
    new Response('x'.repeat(1024 * 1024 + 1)),
    new Response('<html>error</html>', { headers: { 'Content-Type': 'text/html' } }),
    Response.json({ error: 'server-only-security-code' })
  ]) {
    const f = fixture({
      fetch: (async (_url, options) => {
        assert.equal(options?.redirect, 'error')
        return response
      }) as typeof fetch
    })
    const r = await f.call()
    assert.equal(r.status, 502)
    assert.ok(!(await r.text()).includes('server-only'))
  }
})
