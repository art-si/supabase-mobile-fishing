import { cors, json } from '../_shared/http.ts'
import { normalizeAmapWeather, validAdcode } from '../_shared/weather.ts'

type Caller = { id: string; token: string }
type Point = { longitude: number; latitude: number }
type Input =
  | { action: 'search'; query: string; city: string; page: number }
  | { action: 'weather'; adcode: string }
  | { action: 'preview'; spotId?: string; point?: Point; zoom: number; radiusM?: number }
export interface Dependencies {
  authenticate: (request: Request) => Promise<Caller | null>
  reserve: (caller: Caller) => Promise<void>
  readSpot: (caller: Caller, id: string) => Promise<Record<string, unknown>>
  apiKey: () => string
  fetch: typeof fetch
}
export class MapError extends Error {
  constructor(
    public code: string,
    public status = 400
  ) {
    super(code)
  }
}
const coordinates = (longitude: unknown, latitude: unknown): longitude is number =>
  typeof longitude === 'number' &&
  typeof latitude === 'number' &&
  Number.isFinite(longitude) &&
  Number.isFinite(latitude) &&
  Math.abs(longitude) <= 180 &&
  Math.abs(latitude) <= 90

async function limitedBytes(body: Request | Response, limit: number) {
  if (Number(body.headers.get('content-length') || 0) > limit)
    throw new MapError('MAP_RESPONSE_INVALID', 502)
  const reader = body.body?.getReader()
  if (!reader) throw new MapError('MAP_RESPONSE_INVALID', 502)
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.length
      if (size > limit) {
        await reader.cancel()
        throw new MapError('MAP_RESPONSE_INVALID', 502)
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}
async function input(request: Request): Promise<Input> {
  let body: Record<string, unknown>
  try {
    body = JSON.parse(new TextDecoder().decode(await limitedBytes(request, 2048)))
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error()
  } catch {
    throw new MapError('INVALID_INPUT')
  }
  if (body.action === 'weather') {
    if (
      Object.keys(body).some((k) => !['action', 'adcode'].includes(k)) ||
      !validAdcode(body.adcode)
    )
      throw new MapError('INVALID_INPUT')
    return { action: 'weather', adcode: body.adcode }
  }
  if (body.action === 'search') {
    if (Object.keys(body).some((k) => !['action', 'query', 'city', 'page'].includes(k)))
      throw new MapError('INVALID_INPUT')
    const query = typeof body.query === 'string' ? body.query.trim() : ''
    const city = typeof body.city === 'string' ? body.city.trim() : ''
    const page = body.page ?? 1
    if (
      !query ||
      query.length > 80 ||
      city.length > 40 ||
      !Number.isInteger(page) ||
      Number(page) < 1 ||
      Number(page) > 5
    )
      throw new MapError('INVALID_INPUT')
    return { action: 'search', query, city, page: Number(page) }
  }
  if (
    body.action !== 'preview' ||
    Object.keys(body).some(
      (k) => !['action', 'spotId', 'longitude', 'latitude', 'zoom', 'radiusM'].includes(k)
    )
  )
    throw new MapError('INVALID_INPUT')
  const zoom = body.zoom ?? 14
  if (!Number.isInteger(zoom) || Number(zoom) < 8 || Number(zoom) > 17)
    throw new MapError('INVALID_INPUT')
  if (
    typeof body.spotId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.spotId)
  ) {
    if ('longitude' in body || 'latitude' in body || 'radiusM' in body)
      throw new MapError('INVALID_INPUT')
    return { action: 'preview', spotId: body.spotId, zoom: Number(zoom) }
  }
  if ('spotId' in body || !coordinates(body.longitude, body.latitude))
    throw new MapError('INVALID_INPUT')
  if (
    'radiusM' in body &&
    (!Number.isInteger(body.radiusM) ||
      Number(body.radiusM) < 50 ||
      Number(body.radiusM) > 5000 ||
      Math.abs(Number(body.latitude)) > 85 ||
      Math.abs(Number(body.longitude)) > 179)
  )
    throw new MapError('INVALID_INPUT')
  return {
    action: 'preview',
    point: { longitude: body.longitude, latitude: body.latitude as number },
    zoom: Number(zoom),
    ...(body.radiusM !== undefined ? { radiusM: Number(body.radiusM) } : {})
  }
}
function text(value: unknown, length = 120) {
  return typeof value === 'string' ? value.slice(0, length) : ''
}
function providerError(code: unknown) {
  if (['10003', '10004', '10010', '10019', '10020', '10021', '10044'].includes(String(code)))
    return new MapError('MAP_QUOTA_EXCEEDED', 429)
  return new MapError('MAP_PROVIDER_FAILED', 502)
}
function base64(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}
export function createMapHandler(deps: Dependencies) {
  return async (request: Request) => {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors })
    if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
    try {
      const caller = await deps.authenticate(request)
      if (!caller) return json({ error: 'NOT_AUTHENTICATED' }, 401)
      const data = await input(request)
      const key = deps.apiKey().trim()
      if (!key) throw new MapError('MAP_NOT_CONFIGURED', 503)
      let point: Point | undefined,
        zoom = 14,
        precision = 'exact'
      if (data.action === 'preview') {
        point = data.point
        zoom = data.zoom
        if (data.spotId) {
          // Caller-scoped RPC, never service_role: private/coarse locations stay private/coarse.
          const spot = await deps.readSpot(caller, data.spotId)
          if (
            !['area', 'exact'].includes(String(spot.precision)) ||
            !coordinates(spot.longitude, spot.latitude)
          )
            throw new MapError('MAP_LOCATION_HIDDEN', 403)
          precision = String(spot.precision)
          point = { longitude: spot.longitude, latitude: spot.latitude as number }
          if (precision === 'area') {
            point = {
              longitude: Math.round(point.longitude / 0.02) * 0.02,
              latitude: Math.round(point.latitude / 0.02) * 0.02
            }
            zoom = Math.min(zoom, 11)
          }
        }
      }
      // Durable transaction quota is reserved before every upstream request. Failure is fail-closed.
      await deps.reserve(caller)
      const url = new URL(
        data.action === 'search'
          ? 'https://restapi.amap.com/v3/place/text'
          : data.action === 'weather'
            ? 'https://restapi.amap.com/v3/weather/weatherInfo'
            : 'https://restapi.amap.com/v3/staticmap'
      )
      url.searchParams.set('key', key)
      if (data.action === 'weather') {
        url.searchParams.set('city', data.adcode)
        url.searchParams.set('extensions', 'base')
        url.searchParams.set('output', 'JSON')
      } else if (data.action === 'search') {
        url.searchParams.set('keywords', data.query)
        url.searchParams.set('offset', '10')
        url.searchParams.set('page', String(data.page))
        // V3 includes adcode only with extensions=all. The selected place needs
        // that region for weather; keep the client projection bounded below.
        url.searchParams.set('extensions', 'all')
        url.searchParams.set('output', 'JSON')
        if (data.city) {
          url.searchParams.set('city', data.city)
          url.searchParams.set('citylimit', 'true')
        }
      } else {
        const location = `${point!.longitude.toFixed(6)},${point!.latitude.toFixed(6)}`
        url.searchParams.set('location', location)
        if (data.radiusM) {
          const cosine = Math.cos((point!.latitude * Math.PI) / 180)
          zoom = Math.max(
            8,
            Math.min(zoom, Math.floor(Math.log2((156543.03392 * cosine * 140) / data.radiusM)))
          )
          const ring = Array.from({ length: 33 }, (_, i) => {
            const angle = (2 * Math.PI * (i % 32)) / 32
            return `${(point!.longitude + (Math.cos(angle) * data.radiusM!) / (111320 * cosine)).toFixed(6)},${(point!.latitude + (Math.sin(angle) * data.radiusM!) / 111320).toFixed(6)}`
          })
          url.searchParams.set('paths', `2,0x9C512F,1,0x9C512F,0.12:${ring.join(';')}`)
        }
        url.searchParams.set('zoom', String(zoom))
        url.searchParams.set('size', '640*360')
        url.searchParams.set('scale', '1')
        // An area preview is not an exact fishing-point pin.
        if (precision === 'exact') url.searchParams.set('markers', `mid,0x0f766e,A:${location}`)
      }
      const response = await deps.fetch(url, {
        signal: AbortSignal.timeout(8000),
        redirect: 'error'
      })
      if (!response.ok) throw new MapError('MAP_PROVIDER_FAILED', 502)
      const bytes = await limitedBytes(response, 512 * 1024)
      if (data.action === 'weather') {
        const raw = new TextDecoder().decode(bytes)
        if (raw.includes(key)) throw new MapError('MAP_RESPONSE_INVALID', 502)
        const body = JSON.parse(raw)
        if (body.status !== '1') throw providerError(body.infocode)
        if (!Array.isArray(body.lives) || body.lives.length !== 1)
          throw new MapError('WEATHER_RESPONSE_INVALID', 502)
        const weather = normalizeAmapWeather(body.lives[0], data.adcode)
        if (!weather) throw new MapError('WEATHER_RESPONSE_INVALID', 502)
        return json(weather)
      }
      if (data.action === 'search') {
        const body = JSON.parse(new TextDecoder().decode(bytes))
        if (body.status !== '1') throw providerError(body.infocode)
        if (!Array.isArray(body.pois)) throw new MapError('MAP_RESPONSE_INVALID', 502)
        const items = body.pois.slice(0, 10).flatMap((poi: Record<string, unknown>) => {
          const location = text(poi.location).split(',')
          if (location.length !== 2 || location.some((part) => !part.trim())) return []
          const [longitude, latitude] = location.map(Number)
          if (!coordinates(longitude, latitude) || !text(poi.id) || !text(poi.name)) return []
          return [
            {
              id: text(poi.id),
              name: text(poi.name),
              address: [poi.pname, poi.cityname, poi.adname, poi.address]
                .map((x) => text(x))
                .filter(Boolean)
                .join(' '),
              longitude,
              latitude,
              crs: 'GCJ-02',
              ...(validAdcode(poi.adcode) ? { adcode: poi.adcode } : {})
            }
          ]
        })
        return json({
          items,
          hasMore: data.page < 5 && Number(body.count) > data.page * 10,
          source: 'amap'
        })
      }
      const mime = response.headers.get('content-type')?.split(';')[0].trim()
      const png =
        bytes.length > 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => bytes[i] === x)
      const jpeg = bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      if (!(mime === 'image/png' && png) && !(mime === 'image/jpeg' && jpeg)) {
        try {
          throw providerError(JSON.parse(new TextDecoder().decode(bytes)).infocode)
        } catch (e) {
          if (e instanceof MapError) throw e
          throw new MapError('MAP_RESPONSE_INVALID', 502)
        }
      }
      // No URL/key or user coordinates in a GET query; no persistent image storage or cropping.
      return json({
        image: `data:${mime};base64,${base64(bytes)}`,
        width: 640,
        height: 360,
        precision,
        zoom,
        source: 'amap'
      })
    } catch (error) {
      if (error instanceof MapError) return json({ error: error.code }, error.status)
      return json({ error: 'MAP_PROVIDER_FAILED' }, 502)
    }
  }
}
