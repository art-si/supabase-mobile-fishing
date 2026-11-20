// Pure provider contract shared with the client. No credentials, storage or network access.
export interface CurrentWeather {
  source: 'amap'
  adcode: string
  province: string
  city: string
  weather: string | null
  temperature: number | null
  windDirection: string | null
  windPower: string | null
  humidity: number | null
  reportedAt: string
}
export const validAdcode = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d{5}$/.test(value)

function label(value: unknown, max: number) {
  if (typeof value !== 'string') return null
  const result = value.trim()
  return result &&
    !['--', '暂无', '未知', 'null', 'N/A'].includes(result) &&
    result.length <= max &&
    !/[<>\u0000-\u001f\u007f]/.test(result)
    ? result
    : null
}
function numeric(value: unknown, min: number, max: number) {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return null
  const number = Number(value)
  return Number.isFinite(number) && number >= min && number <= max ? number : null
}
function power(value: unknown) {
  const text =
    typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : null
  if (!text || !/^(?:[<≤])?\d{1,2}(?:[-~]\d{1,2})?$/.test(text)) return null
  const parts = text.match(/\d+/g)!.map(Number)
  if (parts.some((part) => part > 17) || (parts.length === 2 && parts[0]! > parts[1]!)) return null
  return text
}
export function weatherReportTime(value: unknown): string | null {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))
    return null
  const [year, month, day, hour, minute, second] = value.match(/\d+/g)!.map(Number)
  const local = Date.UTC(year!, month! - 1, day, hour, minute, second)
  // Reject calendar rollover and do not interpret China provider time in the device timezone.
  if (new Date(local).toISOString().slice(0, 19).replace('T', ' ') !== value) return null
  return new Date(local - 8 * 3600000).toISOString()
}
export function normalizeAmapWeather(
  value: unknown,
  expectedAdcode: string,
  now = Date.now()
): CurrentWeather | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !validAdcode(expectedAdcode))
    return null
  const data = value as Record<string, unknown>
  const city = label(data.city, 80)
  const reportedAt = weatherReportTime(data.reportTime ?? data.reporttime)
  if (
    data.adcode !== expectedAdcode ||
    !city ||
    !reportedAt ||
    Date.parse(reportedAt) > now + 5 * 60000
  )
    return null
  const weather = label(data.weather, 40)
  return {
    source: 'amap',
    adcode: expectedAdcode,
    province: label(data.province, 80) || '',
    city,
    weather: weather === '暂无' || weather === '未知' ? null : weather,
    temperature: numeric(data.temperature, -90, 65),
    windDirection: label(data.windDirection ?? data.winddirection, 24),
    windPower: power(data.windPower ?? data.windpower),
    humidity: numeric(data.humidity, 0, 100),
    reportedAt
  }
}
