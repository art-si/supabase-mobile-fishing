// Public JS SDK proxy: does not read fishing data or accept a client-selected host/key.
// The SDK uses JSONP/XHR and cannot attach a Supabase user JWT to these requests.
export interface JsMapDependencies {
  key: string
  securityCode: string
  allowedOrigins: string[]
  reserve: () => Promise<boolean>
  fetch: typeof fetch
}
// Public deployment origin, not a credential. Merge it in code so publishing
// Pages never replaces the existing local, native or custom-domain allowlist.
export function jsMapAllowedOrigins(configured: string) {
  return [
    ...new Set([
      ...configured
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      'https://art-si.github.io'
    ])
  ]
}
const routes = new Map([
  ['/v3/log/init', 'restapi.amap.com'],
  ['/v3/place/text', 'restapi.amap.com'],
  ['/v3/place/around', 'restapi.amap.com'],
  ['/v3/assistant/inputtips', 'restapi.amap.com'],
  ['/v3/geocode/regeo', 'restapi.amap.com'],
  ['/v3/weather/weatherInfo', 'restapi.amap.com'],
  ['/v3/ip', 'restapi.amap.com'],
  ['/v4/ip', 'restapi.amap.com'],
  ['/v3/assistant/coordinate/convert', 'restapi.amap.com'],
  ['/v4/map/styles', 'webapi.amap.com']
])
function originOf(value: string) {
  try {
    const url = new URL(value)
    // URL.origin is "null" for Capacitor's registered custom scheme.
    return `${url.protocol}//${url.host}`
  } catch {
    return ''
  }
}
export function createJsMapHandler(deps: JsMapDependencies) {
  return async (request: Request): Promise<Response> => {
    const origin = originOf(request.headers.get('origin') || request.headers.get('referer') || '')
    const allowed = Boolean(origin && deps.allowedOrigins.includes(origin))
    const headers: Record<string, string> = {
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'X-Content-Type-Options': 'nosniff',
      ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {})
    }
    const fail = (error: string, status: number) => Response.json({ error }, { status, headers })
    if (!allowed) return fail('MAP_ORIGIN_DENIED', 403)
    if (request.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS' }
      })
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 405)
    const url = new URL(request.url)
    const marker = '/_AMapService/'
    const start = url.pathname.indexOf(marker)
    const path = start < 0 ? '' : url.pathname.slice(start + marker.length - 1)
    const host = routes.get(path)
    if (!host) return fail('MAP_ROUTE_DENIED', 404)
    if (!deps.key || !deps.securityCode) return fail('MAP_NOT_CONFIGURED', 503)
    if (url.search.length > 4096 || url.searchParams.get('key') !== deps.key)
      return fail('MAP_REQUEST_INVALID', 400)
    // Geocoder in the real JS SDK repeats the same key twice. Accept that exact case,
    // then canonicalize it; never accept a conflicting key (parameter pollution).
    const keys = url.searchParams.getAll('key')
    if (keys.length > 2 || keys.some((key) => key !== deps.key) || url.searchParams.has('jscode'))
      return fail('MAP_REQUEST_INVALID', 400)
    const callback = url.searchParams.get('callback')
    if (
      url.searchParams.getAll('callback').length > 1 ||
      (callback && !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(callback))
    )
      return fail('MAP_REQUEST_INVALID', 400)
    // Weather is deliberately limited to one administrative region, not a general proxy.
    // The real JS SDK omits extensions for live weather; both that and base are valid.
    if (
      path === '/v3/weather/weatherInfo' &&
      (url.searchParams.getAll('city').length !== 1 ||
        !/^[1-9]\d{5}$/.test(url.searchParams.get('city') || '') ||
        url.searchParams.getAll('extensions').length > 1 ||
        !['base', 'all'].includes(url.searchParams.get('extensions') ?? 'base'))
    )
      return fail('MAP_REQUEST_INVALID', 400)
    const upstream = new URL(path, `https://${host}`)
    upstream.search = url.search
    upstream.searchParams.set('key', deps.key)
    upstream.searchParams.set('jscode', deps.securityCode)
    try {
      if (!(await deps.reserve())) return fail('MAP_QUOTA_EXCEEDED', 429)
      const result = await deps.fetch(upstream, {
        signal: AbortSignal.timeout(8000),
        redirect: 'error'
      })
      if (!result.ok || !result.body) return fail('MAP_PROVIDER_FAILED', 502)
      const reader = result.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 1024 * 1024) {
            await reader.cancel()
            return fail('MAP_RESPONSE_INVALID', 502)
          }
          chunks.push(value)
        }
      } finally {
        reader.releaseLock()
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      // Upstream response or error pages must never reflect our server-only credential.
      if (new TextDecoder().decode(bytes).includes(deps.securityCode))
        return fail('MAP_RESPONSE_INVALID', 502)
      const mime = result.headers.get('content-type')?.split(';')[0].toLowerCase() || ''
      if (
        ![
          'application/json',
          'application/javascript',
          'text/javascript',
          'text/plain',
          'application/octet-stream'
        ].includes(mime)
      )
        return fail('MAP_RESPONSE_INVALID', 502)
      headers['Content-Type'] = callback ? 'application/javascript; charset=utf-8' : mime
      return new Response(bytes, { headers })
    } catch {
      // Never log fetch exceptions; their messages may contain the credential-bearing URL.
      return fail('MAP_PROVIDER_FAILED', 502)
    }
  }
}
