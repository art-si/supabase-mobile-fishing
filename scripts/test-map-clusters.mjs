// Real AMap rendering, isolated synthetic fishing pins; no auth, GPS or remote writes.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setH5TextScale } from './h5-text-scale.mjs'

const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
const output = resolve('artifacts/map-clusters')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width: 375, height: 812 },
  locale: 'zh-CN',
  reducedMotion: 'reduce'
})
const checks = [],
  errors = [],
  writes = [],
  reads = []
const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*'
}
let page,
  spots,
  dense = false,
  hidePins = false
await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
await context.route('**/rest/v1/rpc/*', (route) => {
  const request = route.request()
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  const name = new URL(request.url()).pathname.split('/').at(-1)
  if (name === 'fishing_map_spots') {
    const bounds = request.postDataJSON().payload
    reads.push(bounds)
    if (!spots) {
      const lng = (bounds.west + bounds.east) / 2
      const lat = (bounds.south + bounds.north) / 2
      const dx = (bounds.east - bounds.west) * 0.25
      spots = [
        ['a', lng - dx, lat, 'area'],
        ['b', lng - dx, lat, 'area'],
        ['c', lng + dx, lat, 'exact'],
        ['d', lng + dx + 0.001, lat, 'exact']
      ].map(([id, longitude, latitude, precision]) => ({
        id: `${id}1111111-1111-4111-8111-111111111111`,
        name: `验收样例 ${id.toUpperCase()} · 非真实钓位`,
        city: '隔离测试',
        water_type: '测试水域',
        longitude,
        latitude,
        precision,
        own: false,
        crs: 'GCJ-02'
      }))
      if (dense)
        spots = Array.from({ length: 100 }, (_, i) => ({
          ...spots[0],
          id: `isolated-dense-pin-${i}`,
          name: `密集验收样例 ${i + 1} · 非真实钓位`,
          longitude: lng,
          latitude: lat
        }))
    }
    return route.fulfill({
      headers,
      json: {
        items: hidePins
          ? []
          : spots.filter(
              (s) =>
                s.longitude >= bounds.west &&
                s.longitude <= bounds.east &&
                s.latitude >= bounds.south &&
                s.latitude <= bounds.north
            ),
        truncated: false,
        zoom_in: false
      }
    })
  }
  if (name === 'fishing_zones_read')
    return route.fulfill({
      headers,
      json: { items: [], next: null, truncated: false, zoom_in: false }
    })
  if (name === 'fishing_moderation') return route.fulfill({ headers, json: { allowed: false } })
  writes.push(name)
  return route.abort()
})
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'permissions', {
    value: { query: async () => ({ state: 'denied' }) }
  })
})
const pass = (name) => checks.push(name)
const capture = async (name) => {
  // AMap tiles finish after the DOM markers; capture the visible WebGL viewport.
  await page.waitForTimeout(page.viewportSize().width > page.viewportSize().height ? 5000 : 1200)
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  })
  await page.screenshot({ path: resolve(output, `${name}.png`) })
}
try {
  page = await context.newPage()
  page.setDefaultTimeout(20000)
  page.on('pageerror', (error) => errors.push(String(error).replace(/https?:\/\/\S+/g, '[URL]')))
  await page.goto(`${base}/#/pages/map/index`, { waitUntil: 'domcontentloaded' })
  const same = page.getByRole('button', { name: '选择这组 2 个钓位', exact: true })
  const expand = page.getByRole('button', { name: '放大查看这组 2 个钓位', exact: true })
  await same.waitFor()
  await expand.waitFor()
  assert.equal(await page.locator('.map-spot-pin').count(), 2)
  assert.equal(await page.getByRole('button', { name: '搜索', exact: true }).count(), 0)
  assert.equal(await same.innerText(), '2')
  await capture('real-map-fixture-pins-375')
  pass(
    'real SDK renders four isolated authorized pins as two 48px quantity buttons, no search action'
  )

  await same.focus()
  await same.press('Enter')
  await page.getByText('这组 2 个钓位', { exact: true }).waitFor()
  assert.equal(await page.locator('.map-spot-row').count(), 2)
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'map-spot-group')
  await page.locator('.map-spot-row').filter({ hasText: '样例 B' }).click()
  await page.getByText('大致水域，不是精确钓点', { exact: true }).waitFor()
  assert.equal(await same.getAttribute('aria-pressed'), 'true')
  pass(
    'co-located approximate points open a keyboard-accessible list and retain the precision label'
  )
  await page.getByRole('button', { name: '钓位列表 · 4', exact: true }).click()
  assert.equal(await page.locator('.map-spot-row').count(), 4)
  await page.getByRole('button', { name: '收起钓位列表', exact: true }).click()
  pass('individual selection and the complete authorized list remain available')

  for (const [width, height, dark, textSize] of [
    [320, 720, true, 24],
    [375, 812, false, 16],
    [440, 956, false, 16],
    [812, 375, false, 16],
    [1280, 900, true, 24]
  ]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' })
    await setH5TextScale(page, textSize)
    // Resize settles asynchronously in the real SDK. Explicit refresh can appear.
    await page.waitForTimeout(500)
    const refresh = page.getByRole('button', { name: '查看这片水域', exact: true })
    if (await refresh.isVisible()) await refresh.click()
    await same.waitFor()
    await page.locator('#amap-canvas').scrollIntoViewIfNeeded()
    const box = await same.boundingBox()
    assert.ok(box.width >= 48 && box.height >= 48)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await same.focus()
    const contrast = await same.evaluate((el) => {
      const s = getComputedStyle(el)
      const lum = (color) =>
        color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((n) => {
            n /= 255
            return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
          })
          .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0)
      const a = lum(s.color),
        b = lum(s.backgroundColor)
      return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), outline: s.outlineStyle }
    })
    assert.ok(contrast.ratio >= 4.5)
    assert.notEqual(contrast.outline, 'none')
    await capture(`real-map-fixture-${width}${dark ? '-dark' : ''}`)
  }
  pass(
    '320/375/440/landscape/wide: 48px targets, dark and large text, visible keyboard focus, text contrast >=4.5'
  )

  await page.setViewportSize({ width: 375, height: 812 })
  await setH5TextScale(page, 16)
  await page.waitForTimeout(500)
  if (await page.getByRole('button', { name: '查看这片水域', exact: true }).isVisible())
    await page.getByRole('button', { name: '查看这片水域', exact: true }).click()
  await expand.waitFor()
  const before = reads.at(-1)
  await expand.focus()
  await expand.press('Enter')
  await page.waitForFunction(() => document.activeElement?.id === 'map-spots-status')
  assert.ok(reads.at(-1).east - reads.at(-1).west < before.east - before.west)
  pass(
    'keyboard cluster activation zooms and fetches narrower bounds, returning focus to the result status'
  )

  // Zoom progressively until close distinct pins become individually selectable.
  for (let i = 0; i < 12; i++) {
    await page.locator('.map-spot-pin').first().waitFor()
    if (!(await expand.count())) break
    await expand.click()
    await page.waitForTimeout(700)
  }
  const single = page.getByRole('button', { name: /^查看钓位：验收样例 C/ })
  await single.waitFor()
  await page.getByRole('button', { name: /^查看钓位：验收样例 D/ }).waitFor()
  await single.click()
  await page.getByText('钓友分享的精确位置', { exact: true }).waitFor()
  await capture('real-map-fixture-expanded')
  pass(
    'progressive zoom separates nearby exact pins and a native map-button click selects the matching card'
  )

  // A viewport move must clear the selected card and prevent removed data returning.
  hidePins = true
  const canvas = await page.locator('#amap-canvas').boundingBox()
  await page.mouse.move(canvas.x + 30, canvas.y + 80)
  await page.mouse.down()
  await page.mouse.move(canvas.x + 110, canvas.y + 90, { steps: 12 })
  await page.mouse.up()
  await page.getByRole('button', { name: '查看这片水域', exact: true }).click()
  await page.getByText('这片水域还没有可见钓位，可以移动地图再找找。', { exact: true }).waitFor()
  assert.equal(await page.locator('.map-spot-pin').count(), 0)
  assert.equal(await page.getByRole('button', { name: '查看钓位详情', exact: true }).count(), 0)
  hidePins = false
  dense = true
  for (const skin of ['ocean', 'stone'])
    for (const dark of [false, true]) {
      spots = undefined
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' })
      await page.evaluate(
        (skin) =>
          localStorage.setItem(
            'dyj.appearance.skin.v1',
            JSON.stringify({ type: 'string', data: skin })
          ),
        skin
      )
      await page.reload({ waitUntil: 'domcontentloaded' })
      const hundred = page.getByRole('button', { name: '选择这组 100 个钓位', exact: true })
      await hundred.waitFor()
      await setH5TextScale(page, 32)
      assert.ok(
        await hundred.evaluate((el) => {
          const text = el.firstElementChild.getBoundingClientRect()
          const box = el.getBoundingClientRect()
          return text.width <= box.width - 4 && text.height <= box.height - 4
        })
      )
      await hundred.focus()
      await capture(`dense-100-${skin}-${dark ? 'dark' : 'light'}`)
      await hundred.press('Enter')
      assert.equal(await page.locator('.map-spot-row').count(), 20)
      await page.getByRole('button', { name: '再看 20 个', exact: true }).click()
      assert.equal(await page.locator('.map-spot-row').count(), 40)
    }
  pass(
    'ocean/stone light and dark skins: 100-point quantity fits at 200% text; group list loads 20 at a time'
  )
  assert.deepEqual(writes, [])
  assert.deepEqual(errors, [])
  pass('refresh removes unavailable clusters, cards and lists; no remote write or page errors')
} catch (error) {
  process.exitCode = 1
  errors.push(String(error).replace(/https?:\/\/\S+/g, '[URL]'))
  await page?.screenshot({ path: resolve(output, 'failed.png') }).catch(() => {})
} finally {
  const result = {
    passed: !process.exitCode,
    scope: 'real AMap, isolated synthetic pin responses; no GPS/auth/writes',
    checks,
    errors,
    writes,
    reads: reads.length
  }
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  await browser.close()
}
