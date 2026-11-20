// Browser-only adapter. Mirrors art-supabase-pro's single-flight loader,
// timeout/reset lifecycle and cancel-safe location selection, without its Web-only dependencies.
import { config, isDemo } from '@/config'
import { serviceErrorMessage } from '@/domain/user-errors'
import { Capacitor } from '@capacitor/core'
import { captureCapacitorGcj02 } from '@mobile-core/location'
import { normalizeAmapWeather, validAdcode, type WeatherTarget } from '@/domain/weather'
import type { MobileMapInstance, MobileMapSdk } from '@mobile-core/map'
import { validCoordinates } from '@/domain/rules'
import type { MapPlace } from '@/domain/map'
export interface LngLat {
  getLng(): number
  getLat(): number
}
export type AmapMap = MobileMapInstance
interface Marker {
  setPosition(point: [number, number]): void
  on(name: string, callback: () => void): void
}
export interface POI {
  id: string
  name: string
  address: string
  location: LngLat
  adcode?: string
  cityname?: string
  adname?: string
}
export interface PlaceSuggestion {
  id: string
  name: string
  address: string
  longitude?: number
  latitude?: number
}
interface AmapNamespace extends MobileMapSdk {
  Pixel: new (x: number, y: number) => { getX(): number; getY(): number }
  plugin(name: string, callback: () => void): void
  Weather: new () => {
    getLive(adcode: string, callback: (error: unknown, result?: unknown) => void): void
  }
  Map: new (element: string, options: Record<string, unknown>) => AmapMap
  Marker: new (options: Record<string, unknown>) => Marker
  Circle: new (options: Record<string, unknown>) => { on(name: string, callback: () => void): void }
  PlaceSearch: new (options: Record<string, unknown>) => {
    search(
      keyword: string,
      callback: (status: string, result: { poiList?: { pois: POI[] } }) => void
    ): void
    searchNearBy(
      keyword: string,
      center: [number, number],
      radius: number,
      callback: (status: string, result: { poiList?: { pois: POI[]; count?: number } }) => void
    ): void
  }
  AutoComplete: new (options: Record<string, unknown>) => {
    search(
      keyword: string,
      callback: (
        status: string,
        result: {
          tips?: {
            id?: string
            name?: string
            district?: string
            address?: string | []
            location?: LngLat | []
          }[]
        }
      ) => void
    ): void
  }
  Geolocation: new (options: Record<string, unknown>) => {
    getCurrentPosition(
      callback: (
        status: string,
        result: { position?: LngLat; location_type?: string; accuracy?: number }
      ) => void
    ): void
  }
  Geocoder: new (options: Record<string, unknown>) => {
    getAddress(
      point: [number, number],
      callback: (
        status: string,
        result: {
          regeocode?: {
            formattedAddress: string
            addressComponent?: {
              adcode?: string
              province?: string
              city?: string | []
              district?: string
            }
          }
        }
      ) => void
    ): void
  }
}
declare global {
  interface Window {
    AMap?: AmapNamespace
    _AMapSecurityConfig?: { serviceHost: string }
  }
}
let pending: Promise<AmapNamespace> | undefined
export function loadAmap(): Promise<AmapNamespace> {
  if (isDemo) return Promise.reject(new Error(serviceErrorMessage('MAP_DEMO_UNAVAILABLE')))
  if (!config.amapKey) return Promise.reject(new Error(serviceErrorMessage('MAP_NOT_CONFIGURED')))
  if (!config.amapServiceHost)
    return Promise.reject(new Error(serviceErrorMessage('MAP_NOT_CONFIGURED')))
  if (window.AMap) return Promise.resolve(window.AMap)
  if (pending) return pending
  pending = new Promise<AmapNamespace>((resolve, reject) => {
    let proxy: URL
    try {
      // iOS Capacitor can report an opaque ("null") origin; its href is still a valid base.
      proxy = new URL(config.amapServiceHost, window.location.href)
      const sameOrigin = proxy.origin === window.location.origin
      if (proxy.protocol !== 'https:' && !(sameOrigin && proxy.protocol === 'http:'))
        throw new Error()
      if (
        !proxy.pathname.endsWith('/_AMapService') ||
        proxy.search ||
        proxy.hash ||
        proxy.username ||
        proxy.password
      )
        throw new Error()
    } catch {
      return reject(new Error(serviceErrorMessage('MAP_NOT_CONFIGURED')))
    }
    window._AMapSecurityConfig = { serviceHost: proxy.href }
    const script = document.createElement('script')
    let settled = false
    const fail = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      script.remove()
      reject(new Error(serviceErrorMessage('MAP_LOAD_FAILED')))
    }
    const timer = setTimeout(fail, 12000)
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.amapKey)}&plugin=AMap.AutoComplete,AMap.PlaceSearch,AMap.Geolocation,AMap.Geocoder`
    script.async = true
    script.onload = () => {
      if (settled) return
      if (!window.AMap) return fail()
      settled = true
      clearTimeout(timer)
      resolve(window.AMap)
    }
    script.onerror = fail
    document.head.append(script)
  }).catch((error) => {
    pending = undefined
    throw error
  })
  return pending
}
export function timed<T>(operation: Promise<T>, label: string, ms = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时，请稍后重试`)), ms)
    operation.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}
export async function searchPlaces(query: string) {
  if (!query.trim()) return []
  const amap = await loadAmap()
  return timed(
    new Promise<POI[]>((resolve, reject) =>
      new amap.PlaceSearch({ pageSize: 10 }).search(query, (status, result) => {
        if (status === 'complete') resolve(result.poiList?.pois || [])
        else if (status === 'no_data') resolve([])
        else reject(new Error('地点搜索失败，请稍后重试'))
      })
    ),
    '地点搜索'
  )
}
export async function suggestPlaces(query: string): Promise<PlaceSuggestion[]> {
  if (!query.trim()) return []
  const amap = await loadAmap()
  return timed(
    new Promise((resolve, reject) => {
      new amap.AutoComplete({ city: '全国', datatype: 'all' }).search(
        query.trim(),
        (status, result) => {
          if (status === 'no_data') return resolve([])
          if (status !== 'complete') return reject(new Error('地点联想暂不可用，请稍后重试'))
          const seen = new Set<string>()
          const items: PlaceSuggestion[] = []
          for (const [index, tip] of (result.tips || []).entries()) {
            if (typeof tip.name !== 'string' || !tip.name.trim()) continue
            const location = tip.location && !Array.isArray(tip.location) ? tip.location : undefined
            const item: PlaceSuggestion = {
              id: `${tip.id || 'keyword'}-${index}`,
              name: tip.name,
              address: [tip.district, typeof tip.address === 'string' ? tip.address : '']
                .filter(Boolean)
                .join(' · '),
              longitude: location?.getLng(),
              latitude: location?.getLat()
            }
            const identity = `${item.name}|${item.address}`
            if (seen.has(identity)) continue
            seen.add(identity)
            items.push(item)
          }
          resolve(items.slice(0, 8))
        }
      )
    }),
    '地点联想'
  )
}
export async function locate(): Promise<{ point: [number, number]; accuracyM?: number }> {
  if (Capacitor.isNativePlatform()) {
    try {
      if (!Capacitor.isPluginAvailable('Geolocation')) throw new Error('MAP_LOCATION_UNAVAILABLE')
      const { Geolocation } = await import('@capacitor/geolocation')
      const location = await captureCapacitorGcj02(Geolocation)
      return { point: [location.longitude, location.latitude], accuracyM: location.accuracyM }
    } catch (error) {
      if (
        (error as { code?: string })?.code === 'OS-PLUG-GLOC-0003' ||
        (error as Error)?.message === '定位权限未开启，请在应用设置中允许访问位置后重试'
      )
        throw new Error('定位权限已关闭。可在浏览器或系统设置中开启，也可以搜索地点。')
      throw new Error(serviceErrorMessage('MAP_LOCATION_UNAVAILABLE'))
    }
  }
  if (!window.isSecureContext)
    throw new Error('局域网 HTTP 无法获取当前位置。请使用 HTTPS，或搜索地点。')
  const permission = await navigator.permissions
    ?.query({ name: 'geolocation' })
    .catch(() => undefined)
  if (permission?.state === 'denied')
    throw new Error('定位权限已关闭。可在浏览器或系统设置中开启，也可以搜索地点。')
  const amap = await loadAmap()
  return timed(
    new Promise<{ point: [number, number]; accuracyM?: number }>((resolve, reject) =>
      new amap.Geolocation({
        enableHighAccuracy: true,
        timeout: 10000,
        convert: true,
        noIpLocate: 3,
        getCityWhenFail: false,
        panToLocation: false,
        zoomToAccuracy: false,
        showMarker: false,
        showCircle: false
      }).getCurrentPosition((status, result) => {
        if (
          status === 'complete' &&
          result.position &&
          !['ip', 'ipcity'].includes(result.location_type || '')
        )
          resolve({
            point: [result.position.getLng(), result.position.getLat()],
            accuracyM: result.accuracy
          })
        else reject(new Error(serviceErrorMessage('MAP_LOCATION_UNAVAILABLE')))
      })
    ),
    '定位',
    12000
  )
}
export async function reverseGeocode(point: [number, number]) {
  const amap = await loadAmap()
  return timed(
    new Promise<string>((resolve) =>
      new amap.Geocoder({}).getAddress(point, (status, result) =>
        resolve(
          status === 'complete' ? result.regeocode?.formattedAddress || '已选位置' : '已选位置'
        )
      )
    ),
    '地址识别'
  )
}
/** A new post defaults to an area name, never an automatically disclosed street address. */
export async function reverseAreaName(point: [number, number]) {
  const amap = await loadAmap()
  return timed(
    new Promise<string>((resolve, reject) =>
      new amap.Geocoder({ extensions: 'base' }).getAddress(point, (status, result) => {
        const address = result.regeocode?.addressComponent
        const city =
          typeof address?.city === 'string' && address.city ? address.city : address?.province
        const area = [
          ...new Set(
            [city, address?.district].filter(
              (v): v is string => typeof v === 'string' && !!v.trim()
            )
          )
        ].join(' · ')
        if (status === 'complete' && area) resolve(area.slice(0, 80))
        else reject(new Error(serviceErrorMessage('MAP_LOCATION_UNAVAILABLE')))
      })
    ),
    '地址识别'
  )
}
/** Public place information via the existing JS key/proxy; no account session is needed. */
export async function searchPlacePage(
  query: string,
  city = '',
  page = 1,
  nearby?: [number, number]
) {
  if (!query.trim() && !nearby) return { items: [] as MapPlace[], hasMore: false }
  const amap = await loadAmap()
  return timed(
    new Promise<{ items: MapPlace[]; hasMore: boolean }>((resolve, reject) => {
      const search = new amap.PlaceSearch({
        pageSize: 20,
        pageIndex: Math.max(1, Math.min(10, page)),
        city: city.trim() || '全国',
        citylimit: Boolean(city.trim()),
        extensions: 'base'
      })
      const complete = (status: string, result: { poiList?: { pois: POI[]; count?: number } }) => {
        if (status === 'no_data') return resolve({ items: [], hasMore: false })
        if (status !== 'complete') return reject(new Error('地点搜索失败，请稍后重试'))
        const items: MapPlace[] = []
        for (const poi of result.poiList?.pois || []) {
          const longitude = poi.location?.getLng?.(),
            latitude = poi.location?.getLat?.()
          if (!poi.name?.trim() || !validCoordinates(longitude, latitude)) continue
          const id = poi.id || `${longitude},${latitude}:${poi.name}`
          if (items.some((item) => item.id === id)) continue
          items.push({
            id,
            name: poi.name.trim().slice(0, 120),
            address: [poi.cityname, poi.adname, typeof poi.address === 'string' ? poi.address : '']
              .filter(Boolean)
              .join(' · ')
              .slice(0, 240),
            longitude,
            latitude,
            crs: 'GCJ-02',
            ...(validAdcode(poi.adcode) ? { adcode: poi.adcode } : {})
          })
        }
        resolve({ items, hasMore: (result.poiList?.count || 0) > page * 20 && page < 10 })
      }
      if (nearby) search.searchNearBy(query.trim(), nearby, 3000, complete)
      else search.search(query.trim(), complete)
    }),
    '地点搜索'
  )
}
export async function currentWeatherAt(target: WeatherTarget) {
  const amap = await loadAmap()
  const adcode =
    'adcode' in target
      ? target.adcode
      : await timed(
          new Promise<string>((resolve, reject) => {
            new amap.Geocoder({ extensions: 'base' }).getAddress(
              [target.longitude, target.latitude],
              (status, result) => {
                const code = result.regeocode?.addressComponent?.adcode
                if (status === 'complete' && validAdcode(code)) resolve(code)
                else reject(new Error('WEATHER_REGION_UNAVAILABLE'))
              }
            )
          }),
          '天气区域识别'
        )
  if (!validAdcode(adcode)) throw new Error('WEATHER_REGION_UNAVAILABLE')
  await timed(new Promise<void>((resolve) => amap.plugin('AMap.Weather', resolve)), '天气加载')
  return timed(
    new Promise<NonNullable<ReturnType<typeof normalizeAmapWeather>>>((resolve, reject) => {
      new amap.Weather().getLive(adcode, (error, result) => {
        if (error) return reject(new Error('WEATHER_UNAVAILABLE'))
        const weather = normalizeAmapWeather(result, adcode)
        if (!weather) return reject(new Error('WEATHER_RESPONSE_INVALID'))
        resolve(weather)
      })
    }),
    '天气查询'
  )
}
