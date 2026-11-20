// Anonymous, read-only hosted verification. No GPS, accounts, ballots or hosted writes.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { setH5TextScale } from './h5-text-scale.mjs'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178',
  out = 'artifacts/mine-reports'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname))
const source = JSON.parse(await readFile('data/official-zones/verified.json', 'utf8'))
const zone = source.records.find((row) => row.published)
assert.ok(zone, 'a verified water surface is required')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width: 375, height: 812 },
  locale: 'zh-CN',
  reducedMotion: 'reduce'
})
const errors = [],
  reads = [],
  blocked = []
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'permissions', {
    value: { query: async () => ({ state: 'denied' }) }
  })
  let sdk
  Object.defineProperty(window, 'AMap', {
    configurable: true,
    get: () => sdk,
    set(value) {
      if (value.Map)
        value.Map = new Proxy(value.Map, {
          construct(Target, args) {
            const map = Reflect.construct(Target, args)
            window.liveSourceMap = map
            map.on('complete', () => (window.liveSourceMapReady = true))
            return map
          }
        })
      sdk = value
    }
  })
})
await context.route('https://tlfmfokyhahlpzmpliad.supabase.co/rest/v1/rpc/**', async (route) => {
  const request = route.request(),
    path = new URL(request.url()).pathname,
    body = request.postDataJSON() || {}
  if (
    path.endsWith('fishing_write') ||
    path.endsWith('fishing_zones_write') ||
    (path.endsWith('fishing_zone_feedback') && body.action !== 'state')
  ) {
    blocked.push(path)
    return route.abort()
  }
  return route.continue()
})
const page = await context.newPage()
page.setDefaultTimeout(60000)
page.on('pageerror', (e) => errors.push(e.message))
page.on('response', (response) => {
  const url = new URL(response.url())
  if (url.hostname === 'tlfmfokyhahlpzmpliad.supabase.co' && url.pathname.includes('/rest/v1/rpc/'))
    reads.push({ path: url.pathname, status: response.status() })
})
try {
  await page.goto(`${base}/#/pages/map/index`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.liveSourceMapReady === true)
  await page.evaluate((zone) => {
    window.liveSourceMap.setCenter([zone.longitude, zone.latitude])
    window.liveSourceMap.setZoom(15)
  }, zone)
  const fence = page.getByRole('button', {
    name: new RegExp(zone.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  })
  await fence.waitFor()
  await page.locator('.mobile-map__loading').waitFor({ state: 'hidden' })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}/verified-live-375.png` })
  await fence.click()
  await page.getByText('这里能垂钓吗？', { exact: true }).waitFor()
  await page.getByText('水面边界：© OpenStreetMap contributors', { exact: true }).waitFor()
  await page.getByText('0 / 0 位钓友认为可以垂钓', { exact: true }).waitFor()
  await page.screenshot({ path: `${out}/verified-live-detail-375.png` })
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 320, height: 812 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await setH5TextScale(page, 24)
  await page.waitForTimeout(500)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await page.screenshot({ path: `${out}/verified-live-dark-large.png` })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'light' })
  await setH5TextScale(page, 16)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${out}/verified-live-375.png` })
  assert.ok(reads.some((read) => read.path.endsWith('fishing_zones_read') && read.status === 200))
  assert.ok(
    reads.some((read) => read.path.endsWith('fishing_zone_feedback') && read.status === 200)
  )
  assert.deepEqual(blocked, [])
  assert.deepEqual(errors, [])
  await writeFile(
    `${out}/live-result.json`,
    JSON.stringify(
      {
        passed: true,
        id: zone.id,
        reads,
        blocked,
        errors,
        boundary:
          'Anonymous hosted reads and real AMap rendering only; no real ballots, GPS, accounts or writes.'
      },
      null,
      2
    )
  )
  console.log(
    'PASS anonymous hosted fence/tally reads are 200, actual verified water polygon renders with source attribution; no writes'
  )
} catch (error) {
  await page.screenshot({ path: `${out}/live-failure.png` }).catch(() => {})
  await writeFile(
    `${out}/live-result.json`,
    JSON.stringify({ passed: false, error: error.message, reads, blocked, errors }, null, 2)
  )
  throw error
} finally {
  await context.close()
  await browser.close()
}
