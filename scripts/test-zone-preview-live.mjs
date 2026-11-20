// Real AMap renderer + isolated pending owner rows. No GPS, credentials or business writes.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setH5TextScale } from './h5-text-scale.mjs'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5179'
const output = resolve('artifacts/zones-ui/preview-real-amap')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'zh-CN' })
const checks = [],
  pageErrors = [],
  unexpected = []
const zone = {
  id: '33333333-3333-4333-8333-333333333333',
  title: '隔离样例：非真实禁钓信息',
  description: '只用于检查高德范围预览，不进入真实社区。',
  location_label: '验收地点',
  longitude: 120.66662,
  latitude: 31.31432,
  radius_m: 1000,
  crs: 'GCJ-02',
  source: 'community',
  status: 'pending',
  revision: 1,
  own: true,
  source_url: '',
  created_at: '2026-11-20T00:00:00Z',
  observed_on: '2026-11-20',
  expires_on: '2026-12-20'
}
await context.addInitScript(() => {
  localStorage.setItem(
    'dyj.auth.v1',
    JSON.stringify({
      type: 'object',
      data: {
        access_token: 'isolated-range-fixture',
        refresh_token: 'isolated-range-fixture',
        expires_at: Date.now() / 1000 + 3600,
        user: { id: '11111111-1111-4111-8111-111111111111' }
      }
    })
  )
})
await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
await context.route('https://tlfmfokyhahlpzmpliad.supabase.co/**', (route) => {
  const path = new URL(route.request().url()).pathname
  if (path.includes('/amap-js/')) return route.continue()
  if (path.includes('_write') || path.includes('/functions/v1/amap')) unexpected.push(path)
  return route.fulfill({
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*'
    },
    json: path.endsWith('fishing_zones_read')
      ? { items: [zone], next: null }
      : { items: [], next: null }
  })
})
const page = await context.newPage()
page.setDefaultTimeout(30000)
page.on('pageerror', (error) => pageErrors.push(error.name))
const button = (name) => page.getByRole('button', { name, exact: true })
try {
  await page.goto(`${base}/#/pages/map/marks`)
  await button('预览参考范围').waitFor()
  // Observe the genuine SDK instance. No SDK methods or results are replaced.
  await page.evaluate(async () => {
    const { loadAmap } = await import('/src/platforms/amap.ts')
    const sdk = await loadAmap()
    sdk.Map = new Proxy(sdk.Map, {
      construct(Type, args) {
        const instance = new Type(...args)
        window.__acceptanceRangeMap = instance
        return instance
      }
    })
  })
  await button('预览参考范围').click()
  await page.locator('.zone-preview__map[aria-busy="false"]').waitFor()
  async function extent() {
    // The SDK suspends drawing when its map is below the visible viewport. A
    // full-page capture alone doesn't simulate the user scrolling to that map.
    await page.locator('.zone-preview__map').scrollIntoViewIfNeeded()
    await page.waitForFunction(() => {
      const m = window.__acceptanceRangeMap,
        c = m.getAllOverlays('circle')[0]
      if (!c) return false
      const b = m.getBounds(),
        cb = c.getBounds()
      return (
        b.getSouthWest().getLng() <= cb.getSouthWest().getLng() &&
        b.getSouthWest().getLat() <= cb.getSouthWest().getLat() &&
        b.getNorthEast().getLng() >= cb.getNorthEast().getLng() &&
        b.getNorthEast().getLat() >= cb.getNorthEast().getLat() &&
        m.getZoom() > 8
      )
    })
    // A complete event precedes fetching tiles at the fitted zoom. Give the genuine
    // provider time to paint; screenshots are inspected, not called GPS evidence.
    await page.waitForTimeout(1600)
  }
  await extent()
  for (const [name, width, height, dark, large] of [
    ['375', 375, 812, false, false],
    ['320-dark-large', 320, 720, true, true],
    ['440', 440, 956, false, false],
    ['landscape', 812, 375, false, false],
    ['wide', 1280, 900, false, false]
  ]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
    await setH5TextScale(page, large ? 24 : 16)
    await button('完整范围').click()
    await extent()
    assert.ok(
      await page.evaluate(() => {
        const m = window.__acceptanceRangeMap,
          c = m.getAllOverlays('circle')[0],
          b = c.getBounds(),
          sw = m.lngLatToContainer(b.getSouthWest()),
          ne = m.lngLatToContainer(b.getNorthEast())
        return ne.getX() - sw.getX() > Math.min(m.getSize().width, m.getSize().height) * 0.6
      }),
      `${name}: the circle must be legible, not a tiny dot in a city-wide viewport`
    )
    // Capture the visible viewport. Full-page stitching changes offscreen WebGL
    // painting and is unsuitable evidence for a live map.
    await page
      .locator('.zone-preview__map')
      .screenshot({ path: resolve(output, `map-${name}.png`) })
    await page.screenshot({ path: resolve(output, `visible-${name}.png`) })
    assert.equal(
      await page.locator('.zone-description').evaluate((el) => getComputedStyle(el).fontSize),
      large ? '24px' : '16px'
    )
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    checks.push(
      `real AMap fits complete 1000m circle at ${name}; actual text scale and width verified`
    )
  }
  for (const radius of [50, 5000]) {
    zone.radius_m = radius
    await button('刷新').click()
    await page.waitForFunction(
      (radius) => window.__acceptanceRangeMap.getAllOverlays('circle')[0]?.getRadius() === radius,
      radius
    )
    await page.locator('.zone-preview__map[aria-busy="false"]').waitFor()
    await extent()
    assert.ok(
      await page.evaluate((radius) => {
        const map = window.__acceptanceRangeMap,
          circle = map.getAllOverlays('circle')[0],
          bounds = circle.getBounds()
        const width =
          map.lngLatToContainer(bounds.getNorthEast()).getX() -
          map.lngLatToContainer(bounds.getSouthWest()).getX()
        return (
          width > Math.min(map.getSize().width, map.getSize().height) * (radius === 50 ? 0.25 : 0.6)
        )
      }, radius),
      `${radius}m radius must remain legible after fitting`
    )
    await page
      .locator('.zone-preview__map')
      .screenshot({ path: resolve(output, `radius-map-${radius}.png`) })
    await page.screenshot({ path: resolve(output, `radius-visible-${radius}.png`) })
    checks.push(`real AMap auto-fits the ${radius}m supported radius after row refresh`)
  }
  assert.deepEqual(unexpected, [])
  assert.deepEqual(pageErrors, [])
  console.log(JSON.stringify({ passed: true, checks }))
} catch (error) {
  process.exitCode = 1
  console.log(
    JSON.stringify({
      passed: false,
      checks,
      error: String(error).replace(/https?:\/\/\S+/g, '[URL]'),
      geometry: await page
        .evaluate(() => ({
          zoom: window.__acceptanceRangeMap?.getZoom(),
          circles: window.__acceptanceRangeMap?.getAllOverlays('circle').length
        }))
        .catch(() => null)
    })
  )
  await page.screenshot({ path: resolve(output, 'failed.png') }).catch(() => {})
} finally {
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify(
      { passed: !process.exitCode, checks, map: 'real-amap', backend: 'isolated-fixtures' },
      null,
      2
    )
  )
  await browser.close()
}
