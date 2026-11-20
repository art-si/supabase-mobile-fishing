import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeAmapWeather,
  weatherReportTime,
  validAdcode
} from '../supabase/functions/_shared/weather'
import {
  readWeatherResponse,
  weatherIsStale,
  weatherTimeLabel,
  WEATHER_STALE_MS
} from '../src/domain/weather'

const now = Date.parse('2026-11-20T00:30:00.000Z')
const live = {
  adcode: '320506',
  province: '江苏省',
  city: '吴中区',
  weather: '多云',
  temperature: '7',
  winddirection: '西北',
  windpower: '3-4',
  humidity: '52',
  reporttime: '2026-11-20 08:04:14'
}
test('weather projects REST and SDK data into the same bounded, credential-free contract', () => {
  const result = normalizeAmapWeather(
    { ...live, key: 'must-not-leak', unknown: 'omit' },
    '320506',
    now
  )!
  assert.equal(result.source, 'amap')
  assert.equal(result.reportedAt, '2026-11-20T00:04:14.000Z')
  assert.equal(result.temperature, 7)
  assert.equal(result.humidity, 52)
  assert.equal(result.windPower, '3-4')
  assert.equal(result.windDirection, '西北')
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false)
  assert.deepEqual(
    normalizeAmapWeather(
      {
        ...live,
        temperature: 7,
        windDirection: '西北',
        windPower: '3-4',
        reportTime: live.reporttime,
        winddirection: undefined,
        windpower: undefined,
        reporttime: undefined
      },
      '320506',
      now
    ),
    result
  )
})
test('weather never turns missing measurements into zero, and bounds provider values', () => {
  for (const bad of [null, undefined, '', ' ', [], {}, true, NaN, Infinity, '--', '12abc']) {
    const result = normalizeAmapWeather(
      { ...live, temperature: bad, humidity: bad, windpower: bad },
      '320506',
      now
    )!
    assert.equal(result.temperature, null)
    assert.equal(result.humidity, null)
    assert.equal(result.windPower, null)
  }
  assert.equal(
    normalizeAmapWeather({ ...live, temperature: '0', humidity: '0', windpower: 0 }, '320506', now)!
      .temperature,
    0
  )
  for (const temperature of [-91, 66, 9999])
    assert.equal(normalizeAmapWeather({ ...live, temperature }, '320506', now)!.temperature, null)
  for (const humidity of [-1, 101])
    assert.equal(normalizeAmapWeather({ ...live, humidity }, '320506', now)!.humidity, null)
  for (const windpower of ['4-3', '18', '999', '3级', '<script>'])
    assert.equal(normalizeAmapWeather({ ...live, windpower }, '320506', now)!.windPower, null)
  for (const windpower of ['<3', '≤3', '3~4', '17'])
    assert.equal(normalizeAmapWeather({ ...live, windpower }, '320506', now)!.windPower, windpower)
})
test('weather requires the requested region and an actual valid provider publication time', () => {
  for (const value of [
    null,
    [],
    {},
    { ...live, adcode: '110101' },
    { ...live, city: '' },
    { ...live, city: '<script>' },
    { ...live, reporttime: undefined },
    { ...live, reporttime: '2026-11-21 08:04:14' }
  ])
    assert.equal(normalizeAmapWeather(value, '320506', now), null)
  for (const code of ['', '苏州', '32050', 320506, '000000', '320506,110000'])
    assert.equal(validAdcode(code), false)
  assert.equal(validAdcode('320506'), true)
  for (const value of [
    '2026-02-29 08:00:00',
    '2026-11-31 08:00:00',
    '2026-11-20 25:00:00',
    '2026-11-20 08:60:00',
    '2026-11-20T08:00:00Z',
    'invalid'
  ])
    assert.equal(weatherReportTime(value), null)
  assert.equal(weatherReportTime('2024-02-29 08:00:00'), '2024-02-29T00:00:00.000Z')
})
test('weather stale status uses publication time, never fetch time or device timezone', () => {
  const result = normalizeAmapWeather(live, '320506', now)!
  const published = Date.parse(result.reportedAt)
  assert.equal(weatherIsStale(result, published + WEATHER_STALE_MS), false)
  assert.equal(weatherIsStale(result, published + WEATHER_STALE_MS + 1), true)
  assert.equal(weatherIsStale(result, published - 6 * 60000), true)
  assert.equal(weatherTimeLabel(result), '2026-11-20 08:04')
  assert.equal(weatherIsStale({ ...result, reportedAt: 'invalid' }, now), true)
})
test('client validates the Edge projection and cannot accept another region or source', () => {
  const result = normalizeAmapWeather(
    { ...live, reporttime: '2020-01-01 08:00:00' },
    '320506',
    now
  )!
  assert.deepEqual(readWeatherResponse(result, '320506'), result)
  for (const bad of [
    null,
    {},
    { ...result, source: 'mock' },
    { ...result, adcode: '110101' },
    { ...result, reportedAt: 'junk' },
    { ...result, reportedAt: '+275760-09-13T00:00:00.000Z' }
  ])
    assert.equal(readWeatherResponse(bad, '320506'), null)
})
