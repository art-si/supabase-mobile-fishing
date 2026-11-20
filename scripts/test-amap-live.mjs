// Real provider smoke check. No user location, phone, login or fishing data is submitted.
// Do not log request URLs/query strings: map SDK URLs contain a public API key.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5179'
const cloud = process.env.FISHING_AMAP_CLOUD === '1'
const output = resolve(
  cloud ? 'artifacts/amap-cloud-live' : 'artifacts/amap-live',
  new Date().toISOString().replace(/[:.]/g, '-')
)
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'zh-CN' })
// Do not obtain this computer's actual location during automation.
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: async () => ({ state: 'denied' }) }
  })
})
if (cloud) {
  // Exercise the real SDK against the deployed proxy, including browser CORS.
  // Only the proxy destination changes; no provider response or SDK is mocked.
  await context.addInitScript(() => {
    let configuration
    Object.defineProperty(window, '_AMapSecurityConfig', {
      configurable: true,
      get: () => configuration,
      set: (value) => {
        configuration = {
          ...value,
          serviceHost: 'https://tlfmfokyhahlpzmpliad.supabase.co/functions/v1/amap-js/_AMapService'
        }
      }
    })
  })
}
const page = await context.newPage()
const searchInput = page.locator('input[aria-label="搜索高德地点"]')
page.setDefaultTimeout(20000)
const responses = [],
  failures = [],
  issued = []
page.on('request', (request) => {
  const url = new URL(request.url())
  if (url.hostname.endsWith('.supabase.co') || url.pathname.includes('_AMapService'))
    issued.push({ host: url.hostname, path: url.pathname, method: request.method() })
})
page.on('response', (response) => {
  const url = new URL(response.url())
  if (url.pathname.includes('_AMapService') || /amap\.com$/.test(url.hostname))
    responses.push({ host: url.hostname, path: url.pathname, status: response.status() })
})
page.on('requestfailed', (request) => {
  const url = new URL(request.url())
  if (url.pathname.includes('_AMapService') || /amap\.com$/.test(url.hostname))
    failures.push({
      host: url.hostname,
      path: url.pathname,
      method: request.method(),
      error: request.failure()?.errorText?.replace(/https?:\/\/\S+/g, '[URL withheld]')
    })
})
try {
  await page.goto(`${base}/#/pages/map/index?pick=1`, { waitUntil: 'domcontentloaded' })
  await searchInput.waitFor({ state: 'visible' })
  // Wait for the map container and shared Uni native-input binding, not placeholder markup.
  await page.waitForFunction(
    () => window.AMap && !document.body.innerText.includes('正在加载高德地图')
  )
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
  await searchInput.fill('苏州金鸡湖')
  assert.equal(await searchInput.inputValue(), '苏州金鸡湖')
  assert.equal(await page.getByRole('button', { name: '搜索', exact: true }).count(), 0)
  await page.getByRole('option').first().waitFor({ state: 'visible', timeout: 25000 })
  const count = await page.getByRole('option').count()
  await page.getByRole('option').first().click()
  // Address-only tips lead to a second, coordinate-bearing place search.
  if (!(await page.getByRole('button', { name: '确认这个位置', exact: true }).isEnabled())) {
    await page.getByRole('option').first().waitFor({ state: 'visible' })
    await page.getByRole('option').first().click()
  }
  const ready = await page.getByRole('button', { name: '确认这个位置', exact: true }).isEnabled()
  assert.ok(count && ready)
  // The SDK animates search selection. Wait until the selected pin is centered before
  // testing a second, manual selection; clicking during movement cancels that movement.
  await page.waitForFunction(() => {
    const map = document.querySelector('#amap-canvas')?.getBoundingClientRect()
    const pin = document.querySelector('#amap-canvas .amap-marker')?.getBoundingClientRect()
    return (
      map &&
      pin &&
      Math.abs(pin.x + pin.width / 2 - (map.x + map.width / 2)) < 8 &&
      Math.abs(pin.bottom - (map.y + map.height / 2)) < 12
    )
  })
  // SDK data requests can finish after geocoding and marker movement; a pin on
  // an empty WebGL canvas is not a verified rendered basemap.
  await page
    .waitForResponse(
      (response) =>
        /jsapi-data\d+\.amap\.com/.test(new URL(response.url()).hostname) &&
        response.status() === 200
    )
    .catch(() => {})
  await page.waitForTimeout(1800)
  const geocode = page.waitForResponse(
    (response) =>
      response.url().includes('/_AMapService/v3/geocode/regeo') && response.status() === 200
  )
  await page.locator('#amap-canvas').click({ position: { x: 145, y: 170 } })
  await geocode
  await page.waitForFunction(() => {
    const heading = document.querySelector('.panel .heading')?.textContent || ''
    return heading && heading !== '已选位置'
  })
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.screenshot({ path: resolve(output, 'map-375.png'), fullPage: true })
  for (const [label, width, height, colorScheme] of [
    ['320-dark', 320, 720, 'dark'],
    ['440', 440, 956, 'light'],
    ['landscape', 812, 375, 'light'],
    ['wide', 1280, 900, 'light']
  ]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme })
    await page.waitForTimeout(1000)
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `${label} overflow`
    )
    await page.screenshot({ path: resolve(output, `map-${label}.png`), fullPage: true })
  }
  const secured = await page.evaluate(
    () =>
      Boolean(window._AMapSecurityConfig?.serviceHost) &&
      !window._AMapSecurityConfig?.securityJsCode
  )
  assert.ok(secured)
  if (cloud)
    assert.ok(
      await page.evaluate(() =>
        window._AMapSecurityConfig.serviceHost.startsWith(
          'https://tlfmfokyhahlpzmpliad.supabase.co/'
        )
      )
    )
  const proxyResponses = responses.filter((r) => r.path.includes('_AMapService'))
  assert.ok(
    proxyResponses.some((r) => r.path.endsWith('/v3/assistant/inputtips') && r.status === 200)
  )
  console.log(
    JSON.stringify({
      check: 'live-amap-search-select-geocode-layout',
      proxy: cloud ? 'deployed-supabase' : 'configured',
      artifacts: output,
      count,
      ready,
      secured,
      proxyResponses,
      failureCount: failures.length,
      abortedTileRequests: failures.filter((f) => f.error === 'net::ERR_ABORTED').length
    })
  )
} catch {
  await page.screenshot({ path: resolve(output, 'map-failed.png'), fullPage: true }).catch(() => {})
  // Only app-owned messages, never SDK console errors that might contain keys.
  console.log(
    JSON.stringify({
      check: 'live-amap-search-select',
      passed: false,
      messages: await page.locator('.fishing-content').innerText(),
      issued,
      responses,
      failures
    })
  )
  process.exitCode = 1
} finally {
  writeFileSync(resolve(output, 'network.json'), JSON.stringify({ responses, failures }, null, 2))
  await browser.close()
}
