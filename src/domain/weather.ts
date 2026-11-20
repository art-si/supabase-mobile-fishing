import { normalizeAmapWeather, type CurrentWeather } from '../../supabase/functions/_shared/weather'
export {
  normalizeAmapWeather,
  validAdcode,
  type CurrentWeather
} from '../../supabase/functions/_shared/weather'
export type WeatherTarget = { adcode: string } | { longitude: number; latitude: number }
export const WEATHER_STALE_MS = 3 * 60 * 60 * 1000
export function weatherIsStale(weather: CurrentWeather, now = Date.now()) {
  const age = now - Date.parse(weather.reportedAt)
  return !Number.isFinite(age) || age > WEATHER_STALE_MS || age < -5 * 60000
}
export function weatherTimeLabel(weather: CurrentWeather) {
  return new Date(Date.parse(weather.reportedAt) + 8 * 3600000)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ')
}
// Validate the Edge projection too, instead of trusting a client-cast JSON object.
export function readWeatherResponse(value: unknown, expectedAdcode: string): CurrentWeather | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  if (
    data.source !== 'amap' ||
    typeof data.reportedAt !== 'string' ||
    !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(data.reportedAt)
  )
    return null
  const millis = Date.parse(data.reportedAt)
  if (!Number.isFinite(millis)) return null
  return normalizeAmapWeather(
    {
      ...data,
      reportTime: new Date(millis + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ')
    },
    expectedAdcode
  )
}
