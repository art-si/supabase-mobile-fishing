// Real SDK, geocoder and weather responses; no real GPS, login or business mutations.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setH5TextScale } from './h5-text-scale.mjs'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5179'
const cloud = process.env.FISHING_AMAP_CLOUD === '1'
const output = resolve('artifacts/weather', cloud ? 'live-hosted' : 'live-local')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'zh-CN' })
await context.addInitScript(
  ({ cloud }) => {
    Object.defineProperty(navigator.permissions, 'query', {
      value: async () => ({ state: 'denied' })
    })
    window.__weatherGpsRequests = 0
    Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {
      value: () => {
        window.__weatherGpsRequests++
        throw new Error('Unexpected GPS request')
      }
    })
    if (cloud) {
      let configuration
      Object.defineProperty(window, '_AMapSecurityConfig', {
        configurable: true,
        get: () => configuration,
        set: (value) => {
          configuration = {
            ...value,
            serviceHost:
              'https://jupuypvmgjpnpntfetqv.supabase.co/functions/v1/amap-js/_AMapService'
          }
        }
      })
    }
  },
  { cloud }
)
const page = await context.newPage()
page.setDefaultTimeout(30000)
const responses = [],
  errors = [],
  writes = [],
  checks = []
page.on('pageerror', (error) => errors.push(error.name))
page.on('request', (request) => {
  const url = new URL(request.url())
  if (url.pathname.includes('_write') || url.pathname.includes('/auth/')) writes.push(url.pathname)
})
page.on('response', (response) => {
  const url = new URL(response.url())
  if (
    url.pathname.endsWith('/v3/weather/weatherInfo') ||
    url.pathname.endsWith('/v3/geocode/regeo')
  )
    responses.push({ host: url.host, path: url.pathname, status: response.status() })
})
const button = (name) => page.getByRole('button', { name, exact: true })
const weather = page.locator('.map-weather')
try {
  await page.goto(`${base}/#/pages/map/index`, { waitUntil: 'domcontentloaded' })
  const input = page.locator('input[aria-label="搜索高德地点"]')
  await input.waitFor()
  await input.fill('苏州金鸡湖')
  await page.getByRole('option').first().click()
  // Address-only suggestions may produce a second choice with coordinates.
  if (await page.getByRole('option').count()) await page.getByRole('option').first().click()
  // Browse mode centers the map without fabricating a fishing-point marker.
  await page.waitForFunction(
    () =>
      document.querySelector('#amap-canvas .amap-layers') &&
      !document.querySelector('[role="option"]')
  )
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
  assert.equal(
    responses.some((r) => r.path.endsWith('/weatherInfo')),
    false
  )
  await button('查看天气').click()
  await weather.locator('.weather-temperature').waitFor()
  const realCity = await weather.locator('.weather-region').innerText()
  assert.ok(realCity && realCity.length <= 80)
  assert.match(await weather.locator('.weather-temperature').innerText(), /^-?\d+(\.\d+)?°C$/)
  assert.match(await weather.locator('.weather-time').innerText(), /高德天气.*北京时间/)
  const provider = responses.find((r) => r.path.endsWith('/weatherInfo'))
  assert.equal(provider?.status, 200)
  if (cloud) assert.equal(provider.host, 'jupuypvmgjpnpntfetqv.supabase.co')
  checks.push(
    'real search → coordinate selection → district geocoder → actual weather through configured proxy'
  )
  await button('刷新天气').click()
  await weather.locator('.weather-details[aria-busy="false"]').waitFor()
  assert.equal(await weather.getByText('天气未能更新', { exact: true }).count(), 0)
  assert.equal(await weather.locator('.weather-region').innerText(), realCity)
  checks.push('explicit refresh succeeds without GPS or business writes')
  for (const [name, width, height, dark, font] of [
    ['375', 375, 812, false, 16],
    ['320-dark-large', 320, 812, true, 24],
    ['440', 440, 956, false, 16],
    ['landscape', 812, 375, false, 16],
    ['wide', 1280, 900, false, 16]
  ]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' })
    await setH5TextScale(page, font)
    // A viewport change is allowed to invalidate the target; reopen explicitly, never auto-fetch.
    if (await button('查看天气').count()) await button('查看天气').click()
    await weather.locator('.weather-temperature').waitFor()
    await weather.scrollIntoViewIfNeeded()
    await page.screenshot({ path: resolve(output, `${name}-visible.png`) })
    await weather.screenshot({ path: resolve(output, `${name}-weather.png`) })
    assert.equal(await weather.locator('.weather-region').innerText(), realCity)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    assert.equal(
      await weather
        .locator('.weather-facts')
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      font
    )
  }
  checks.push(
    'actual weather UI captured at 375/320 dark large/440/landscape/wide with measured text size'
  )
  assert.equal(await page.evaluate(() => window.__weatherGpsRequests), 0)
  assert.deepEqual(errors, [])
  assert.deepEqual(writes, [])
  const report = {
    passed: true,
    evidence: cloud ? 'real AMap via hosted Supabase JS proxy' : 'real AMap via local JS proxy',
    checkedAt: new Date().toISOString(),
    realCity,
    checks,
    responses
  }
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ passed: checks.length, realCity, output }))
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png') })
  await writeFile(
    resolve(output, 'failure-report.json'),
    JSON.stringify({ passed: false, responses, errors, writes, error: error.name }, null, 2)
  )
  throw error
} finally {
  await browser.close()
}
