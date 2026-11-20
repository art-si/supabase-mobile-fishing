// Real read-only AMap + hosted RPC flow. No fake pins, no login, no GPS, no writes.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5181'
const output = resolve(
  'artifacts/map-viewport-live',
  new Date().toISOString().replace(/[:.]/g, '-')
)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'zh-CN' })
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'permissions', {
    value: { query: async () => ({ state: 'denied' }) }
  })
})
const page = await context.newPage()
page.setDefaultTimeout(25000)
const reads = [],
  failures = []
page.on('requestfailed', (request) => {
  const url = new URL(request.url())
  if (url.hostname === 'tlfmfokyhahlpzmpliad.supabase.co')
    failures.push({
      path: url.pathname,
      error: request.failure()?.errorText?.replace(/https?:\/\/\S+/g, '[URL]')
    })
})
page.on('response', async (response) => {
  const url = new URL(response.url())
  if (url.pathname === '/rest/v1/rpc/fishing_map_spots' && response.request().method() === 'POST') {
    const body = await response.json().catch(() => ({}))
    // Count/status only; never write returned locations, keys or session data to logs.
    reads.push({
      status: response.status(),
      items: Array.isArray(body.items) ? body.items.length : null,
      truncated: body.truncated,
      zoom_in: body.zoom_in
    })
  }
})
try {
  await page.goto(`${base}/#/pages/map/index`, { waitUntil: 'domcontentloaded' })
  const search = page.locator('input[aria-label="搜索高德地点"]')
  await search.waitFor()
  await page.getByText(/这片水域还没有可见钓位|这片水域有|已显示这片水域最新/).waitFor()
  await search.fill('苏州金鸡湖')
  await page.getByRole('option').first().waitFor()
  const nextRead = page.waitForResponse(
    (r) =>
      r.url().includes('/rest/v1/rpc/fishing_map_spots') &&
      r.request().method() === 'POST' &&
      r.status() === 200
  )
  await page.getByRole('option').first().click()
  const response = await nextRead
  const bounds = response.request().postDataJSON().payload
  assert.ok(
    Object.keys(bounds).length === 4 && bounds.west < bounds.east && bounds.south < bounds.north
  )
  await page.getByText(/这片水域还没有可见钓位|这片水域有|已显示这片水域最新/).waitFor()
  assert.equal(await page.getByText('钓位未能加载', { exact: true }).count(), 0)
  const canvas = page.locator('#amap-canvas')
  await canvas.scrollIntoViewIfNeeded()
  const rect = await canvas.boundingBox()
  await page.mouse.move(rect.x + rect.width * 0.6, rect.y + rect.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(rect.x + rect.width * 0.3, rect.y + rect.height * 0.6, { steps: 15 })
  await page.mouse.up()
  await page.getByRole('button', { name: '查看这片水域', exact: true }).waitFor()
  const movedRead = page.waitForResponse(
    (r) =>
      r.url().includes('/rest/v1/rpc/fishing_map_spots') &&
      r.request().method() === 'POST' &&
      r.status() === 200
  )
  await page.getByRole('button', { name: '查看这片水域', exact: true }).click()
  const moved = await movedRead
  assert.notDeepEqual(moved.request().postDataJSON().payload, bounds)
  await page.getByText(/这片水域还没有可见钓位|这片水域有|已显示这片水域最新/).waitFor()
  await page.screenshot({ path: resolve(output, 'map-375.png'), fullPage: true })
  await page.setViewportSize({ width: 320, height: 720 })
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await page.addStyleTag({ content: 'html { font-size: 24px !important; }' })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await page.screenshot({ path: resolve(output, 'map-320-dark-large.png'), fullPage: true })
  console.log(
    JSON.stringify({
      passed: true,
      scope: 'real SDK + hosted viewport RPC; no GPS/auth/writes',
      reads,
      failures,
      artifacts: output
    })
  )
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failed.png'), fullPage: true }).catch(() => {})
  console.log(
    JSON.stringify({
      passed: false,
      error: String(error).replace(/https?:\/\/\S+/g, '[URL]'),
      reads,
      failures,
      artifacts: output
    })
  )
  process.exitCode = 1
} finally {
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify({ passed: !process.exitCode, reads, failures }, null, 2)
  )
  await browser.close()
}
