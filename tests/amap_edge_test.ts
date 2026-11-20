import {
  createMapHandler,
  MapError,
  type Dependencies
} from '../supabase/functions/amap/handler.ts'
const user = { id: '11111111-1111-4111-8111-111111111111', token: 'test-user-session' }
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])
function check(value: unknown, message: string) {
  if (!value) throw new Error(message)
}
function fixture(overrides: Partial<Dependencies> = {}) {
  const urls: URL[] = []
  let reservations = 0
  const handler = createMapHandler({
    authenticate: async () => user,
    apiKey: () => 'server-key-test-only',
    reserve: async () => {
      reservations++
    },
    readSpot: async () => ({ precision: 'exact', longitude: 120.123456, latitude: 31.123456 }),
    fetch: ((url: string | URL | Request) => {
      urls.push(new URL(String(url)))
      return Promise.resolve(new Response(png, { headers: { 'content-type': 'image/png' } }))
    }) as typeof fetch,
    ...overrides
  })
  const call = (data: unknown) =>
    handler(
      new Request('https://test.invalid/amap', { method: 'POST', body: JSON.stringify(data) })
    )
  return { handler, call, urls, reservations: () => reservations }
}
Deno.test('AMap rejects anonymous before quota or external calls', async () => {
  const f = fixture({ authenticate: async () => null })
  const response = await f.call({ action: 'search', query: '河' })
  check(response.status === 401 && !f.urls.length && !f.reservations(), 'anonymous is denied')
})
Deno.test(
  'AMap rejects arbitrary proxy URLs, oversized input and invalid coordinates',
  async () => {
    const f = fixture()
    for (const body of [
      { action: 'search', query: '河', url: 'https://evil.invalid' },
      { action: 'search', query: '河', page: 6 },
      { action: 'search', query: 'x'.repeat(3000) },
      { action: 'preview', longitude: 999, latitude: 31 },
      { action: 'preview', longitude: 120, latitude: null },
      { action: 'preview', longitude: 120, latitude: 31, zoom: 18 },
      { action: 'preview', spotId: user.id, longitude: 120, latitude: 31 }
    ])
      check((await f.call(body)).status === 400, 'invalid input rejected')
    check(!f.urls.length && !f.reservations(), 'invalid requests cost no upstream quota')
  }
)
Deno.test('AMap missing secret returns configuration error, not fabricated search', async () => {
  const f = fixture({ apiKey: () => '' })
  const response = await f.call({ action: 'search', query: '河' })
  check(
    response.status === 503 &&
      (await response.json()).error === 'MAP_NOT_CONFIGURED' &&
      !f.reservations(),
    'configuration missing'
  )
})
Deno.test(
  'AMap search fixes host, city filter, page size, and projects only validated POIs',
  async () => {
    let target: URL | undefined
    const f = fixture({
      fetch: ((url: string | URL | Request) => {
        target = new URL(String(url))
        return Promise.resolve(
          Response.json({
            status: '1',
            count: '24',
            pois: [
              {
                id: 'poi-a',
                name: '测试水域',
                location: '120.1,31.2',
                address: [],
                // Match the real V3 contract: base searches omit region codes.
                ...(target.searchParams.get('extensions') === 'all' ? { adcode: '320506' } : {}),
                tel: 'provider-business-contact',
                photos: [{ url: 'https://provider.invalid/not-for-the-client' }],
                key: 'must-not-leak'
              },
              { id: 'bad', name: '错误坐标', location: ',31.2' }
            ]
          })
        )
      }) as typeof fetch
    })
    const response = await f.call({ action: 'search', query: ' 河 ', city: ' 苏州 ', page: 2 })
    const body = await response.json()
    check(
      target?.origin === 'https://restapi.amap.com' && target.pathname === '/v3/place/text',
      'allowlisted upstream'
    )
    check(
      target?.searchParams.get('citylimit') === 'true' &&
        target.searchParams.get('city') === '苏州' &&
        target.searchParams.get('offset') === '10',
      'bounded city search'
    )
    check(
      body.items.length === 1 && body.items[0].crs === 'GCJ-02' && body.hasMore,
      'valid projection and pagination'
    )
    check(
      body.items[0].adcode === '320506',
      'provider region retained for weather without coordinates'
    )
    check(
      !JSON.stringify(body).includes('key') && !JSON.stringify(body).includes('must-not-leak'),
      'secrets omitted'
    )
    check(!('photos' in body.items[0]) && !('tel' in body.items[0]), 'extended provider fields remain outside the client projection')
  }
)
Deno.test(
  'AMap weather rejects unauthenticated, malformed region and injected fields before spending',
  async () => {
    const anonymous = fixture({ authenticate: async () => null })
    check(
      (await anonymous.call({ action: 'weather', adcode: '320506' })).status === 401,
      'auth required'
    )
    check(!anonymous.reservations() && !anonymous.urls.length, 'anonymous costs no quota')
    const f = fixture()
    for (const body of [
      { action: 'weather', adcode: '32050' },
      { action: 'weather', adcode: '000000' },
      { action: 'weather', adcode: 320506 },
      { action: 'weather', adcode: '苏州' },
      { action: 'weather', adcode: '320506', url: 'https://evil.invalid' },
      { action: 'weather', adcode: '320506', key: 'client-chosen' },
      { action: 'weather', adcode: '320506', extensions: 'all' },
      { action: 'weather', adcode: '320506', longitude: 120.7 }
    ])
      check((await f.call(body)).status === 400, 'strict weather input')
    check(!f.reservations() && !f.urls.length, 'invalid input costs no quota')
  }
)
const weatherLive = {
  adcode: '320506',
  city: '吴中区',
  province: '江苏省',
  reporttime: '2020-01-01 08:00:00',
  weather: '多云',
  temperature: '7',
  winddirection: '西北',
  windpower: '3-4',
  humidity: '52'
}
Deno.test(
  'AMap weather reserves one ticket, fixes upstream, and projects live weather only',
  async () => {
    let target: URL | undefined
    const f = fixture({
      fetch: (async (url, options) => {
        target = new URL(String(url))
        check(options?.redirect === 'error', 'no provider redirects')
        return Response.json({ status: '1', lives: [{ ...weatherLive, extra: 'must-not-leak' }] })
      }) as typeof fetch
    })
    const response = await f.call({ action: 'weather', adcode: '320506' })
    const body = await response.json()
    check(response.status === 200 && f.reservations() === 1, 'one request, one ticket')
    check(
      target?.origin === 'https://restapi.amap.com' &&
        target.pathname === '/v3/weather/weatherInfo',
      'fixed provider'
    )
    check(
      target?.searchParams.get('city') === '320506' &&
        target.searchParams.get('extensions') === 'base',
      'one region live weather'
    )
    check(
      target?.searchParams.get('key') === 'server-key-test-only' &&
        !target.searchParams.has('location'),
      'server credential, no precise coordinates'
    )
    check(
      body.temperature === 7 &&
        body.windPower === '3-4' &&
        body.reportedAt === '2020-01-01T00:00:00.000Z',
      'normalized fields and China timezone'
    )
    check(
      body.source === 'amap' &&
        !JSON.stringify(body).includes('must-not-leak') &&
        !JSON.stringify(body).includes('key'),
      'minimal projection'
    )
    check(response.headers.get('cache-control') === 'no-store', 'no public cache')
  }
)
Deno.test('AMap weather missing config and quota outage fail closed', async () => {
  const missing = fixture({ apiKey: () => '' })
  check(
    (await missing.call({ action: 'weather', adcode: '320506' })).status === 503 &&
      !missing.reservations(),
    'no fake weather without key'
  )
  const denied = fixture({
    reserve: async () => {
      throw new MapError('MAP_QUOTA_EXCEEDED', 429)
    }
  })
  check(
    (await denied.call({ action: 'weather', adcode: '320506' })).status === 429 &&
      !denied.urls.length,
    'quota fail closed'
  )
})
Deno.test(
  'AMap weather rejects other regions, missing time, corrupt payloads and reflected secrets',
  async () => {
    for (const response of [
      Response.json({ status: '1', lives: [{ ...weatherLive, adcode: '110101' }] }),
      Response.json({ status: '1', lives: [{ ...weatherLive, reporttime: '' }] }),
      Response.json({ status: '1', lives: [] }),
      Response.json({ status: '1', lives: [weatherLive, weatherLive] }),
      Response.json({ status: '1', lives: [{ ...weatherLive, city: 'server-key-test-only' }] }),
      new Response('not-json'),
      new Response('x'.repeat(512 * 1024 + 1)),
      new Response(null, { status: 302, headers: { location: 'https://evil.invalid' } })
    ]) {
      const f = fixture({ fetch: (() => Promise.resolve(response)) as typeof fetch })
      const result = await f.call({ action: 'weather', adcode: '320506' })
      check(
        result.status === 502 && !(await result.text()).includes('server-key'),
        'invalid provider result safely rejected'
      )
    }
  }
)
Deno.test(
  'AMap weather distinguishes quota failures from valid but incomplete observations',
  async () => {
    const limited = fixture({
      fetch: (() =>
        Promise.resolve(Response.json({ status: '0', infocode: '10003' }))) as typeof fetch
    })
    check(
      (await limited.call({ action: 'weather', adcode: '320506' })).status === 429,
      'provider quota'
    )
    const partial = fixture({
      fetch: (() =>
        Promise.resolve(
          Response.json({
            status: '1',
            lives: [{ ...weatherLive, temperature: '', humidity: [], windpower: null }]
          })
        )) as typeof fetch
    })
    const result = await partial.call({ action: 'weather', adcode: '320506' })
    const data = await result.json()
    check(
      result.status === 200 &&
        data.temperature === null &&
        data.humidity === null &&
        data.windPower === null,
      'missing measurements are not zero'
    )
  }
)
Deno.test('AMap durable quota fails closed before sending upstream request', async () => {
  const f = fixture({
    reserve: async () => {
      throw new MapError('MAP_QUOTA_EXCEEDED', 429)
    }
  })
  check(
    (await f.call({ action: 'search', query: '河' })).status === 429 && !f.urls.length,
    'quota denied'
  )
})
Deno.test(
  'AMap static response keeps image in no-store JSON and never exposes key URL',
  async () => {
    const f = fixture()
    const response = await f.call({
      action: 'preview',
      longitude: 120.12345678,
      latitude: 31.12,
      zoom: 14
    })
    const body = await response.json()
    check(
      body.image.startsWith('data:image/png;base64,') &&
        response.headers.get('cache-control') === 'no-store',
      'private image'
    )
    check(
      !JSON.stringify(body).includes('server-key') && !JSON.stringify(body).includes('https://'),
      'no key URLs'
    )
    check(
      f.urls[0].searchParams.get('location') === '120.123457,31.120000' &&
        f.urls[0].searchParams.get('size') === '640*360',
      'bounded precision and size'
    )
  }
)
Deno.test(
  'AMap uses caller-scoped spot read, rounds area even for owner, and never creates exact area pin',
  async () => {
    let authorized = false
    const f = fixture({
      readSpot: async (caller, id) => {
        authorized = caller.token === user.token && id === user.id
        return { precision: 'area', longitude: 120.123456, latitude: 31.123456 }
      }
    })
    const response = await f.call({ action: 'preview', spotId: user.id, zoom: 17 })
    check(authorized && (await response.json()).precision === 'area', 'caller scope')
    check(
      f.urls[0].searchParams.get('location') === '120.120000,31.120000' &&
        f.urls[0].searchParams.get('zoom') === '11' &&
        !f.urls[0].searchParams.has('markers'),
      'area remains coarse'
    )
  }
)
Deno.test('AMap hidden or inaccessible spots do not cause upstream requests', async () => {
  for (const readSpot of [
    async () => ({ precision: 'hidden', longitude: 120, latitude: 31 }),
    () => Promise.reject(new MapError('NOT_FOUND', 404))
  ]) {
    const f = fixture({ readSpot })
    check(
      (await f.call({ action: 'preview', spotId: user.id })).status >= 400 &&
        !f.urls.length &&
        !f.reservations(),
      'no inaccessible preview'
    )
  }
})
Deno.test('AMap rejects image responses containing HTML and sanitizes quota errors', async () => {
  const html = fixture({
    fetch: (() =>
      Promise.resolve(
        new Response('<script>secret-key</script>', { headers: { 'content-type': 'image/png' } })
      )) as typeof fetch
  })
  const invalid = await html.call({ action: 'preview', longitude: 120, latitude: 31 })
  check(
    invalid.status === 502 && !(await invalid.text()).includes('secret-key'),
    'untrusted upstream content not reflected'
  )
  const quota = fixture({
    fetch: (() =>
      Promise.resolve(
        Response.json({ status: '0', infocode: '10003', info: 'secret' })
      )) as typeof fetch
  })
  check(
    (await quota.call({ action: 'search', query: '河' })).status === 429,
    'provider quota correctly surfaced'
  )
})
Deno.test(
  'circle preview is bounded, closed, fits viewport and cannot reveal a hidden spot',
  async () => {
    const f = fixture()
    const response = await f.call({
      action: 'preview',
      longitude: 120.5,
      latitude: 31.5,
      radiusM: 5000,
      zoom: 17
    })
    check(response.status === 200, 'circle preview accepted')
    const path = f.urls[0].searchParams.get('paths')!.split(':')[1].split(';')
    check(path.length === 33 && path[0] === path.at(-1), 'closed bounded ring')
    check(Number(f.urls[0].searchParams.get('zoom')) <= 12, 'circle fits without clipping')
    for (const body of [
      { action: 'preview', longitude: 120, latitude: 31, radiusM: 5001 },
      { action: 'preview', longitude: 120, latitude: 31, radiusM: -1 },
      { action: 'preview', longitude: 120, latitude: 89, radiusM: 300 },
      { action: 'preview', spotId: user.id, radiusM: 300 }
    ])
      check((await f.call(body)).status === 400, 'invalid circle denied')
    check(f.urls.length === 1, 'invalid circles spend no provider quota')
  }
)
Deno.test(
  'AMap does not follow redirects, hides upstream exceptions and caps streamed image bytes',
  async () => {
    const redirected = fixture({
      fetch: ((_url: unknown, options?: RequestInit) => {
        check(
          options?.redirect === 'error' && options.signal,
          'no redirect and bounded request timeout'
        )
        return Promise.reject(new Error('https://upstream/?key=secret'))
      }) as typeof fetch
    })
    const response = await redirected.call({ action: 'search', query: '河' })
    check(
      response.status === 502 && !(await response.text()).includes('secret'),
      'no upstream URLs leak'
    )
    let cancelled = false
    const f = fixture({
      fetch: (() =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              pull(controller) {
                controller.enqueue(new Uint8Array(100000))
              },
              cancel() {
                cancelled = true
              }
            }),
            { headers: { 'content-type': 'image/png' } }
          )
        )) as typeof fetch
    })
    check(
      (await f.call({ action: 'preview', longitude: 120, latitude: 31 })).status === 502 &&
        cancelled,
      'bounded stream'
    )
  }
)
