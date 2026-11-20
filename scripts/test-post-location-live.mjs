// Real AMap public landmark queries. This never obtains device GPS or writes user content.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
const output = resolve('artifacts/post-location-live')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'zh-CN' })
const blocked = [],
  failures = []
await context.addInitScript(() =>
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: async () => ({ state: 'denied' }) }
  })
)
await context.route('**/*', (route) => {
  const path = new URL(route.request().url()).pathname
  if (
    /\/auth\/v1\/(otp|verify|token)|\/functions\/v1\/(amap$|media-upload)|\/rpc\/.*write/.test(path)
  ) {
    blocked.push(path)
    return route.abort()
  }
  return route.continue()
})
const page = await context.newPage()
page.setDefaultTimeout(30000)
page.on('pageerror', (error) =>
  failures.push(error.message.replace(/https?:\/\/\S+/g, '[URL omitted]'))
)
try {
  await page.goto(`${base}/#/pages/map/search?pick=1&context=post&requestId=public-smoke`, {
    waitUntil: 'domcontentloaded'
  })
  const field = page.locator('input[aria-label="搜索所在位置"]')
  await field.fill('苏州金鸡湖')
  await page.getByRole('option').first().waitFor()
  const count = await page.getByRole('option').count()
  assert.ok(count > 0)
  assert.ok(!page.url().includes('/pages/login'))
  assert.equal(await page.getByText('请先登录，原账号草稿会保留').count(), 0)
  await page.screenshot({ path: resolve(output, 'real-search-375.png') })
  const result = await page.evaluate(async () => {
    const { reverseAreaName, searchPlacePage } = await import('/src/platforms/amap.ts')
    const landmark = [120.7043, 31.3171] // Public Jinji Lake, not a user's location.
    const area = await reverseAreaName(landmark)
    const nearby = await searchPlacePage('', '', 1, landmark)
    return {
      area,
      nearbyCount: nearby.items.length,
      validCoordinates: nearby.items.every(
        (item) =>
          Number.isFinite(item.longitude) && Number.isFinite(item.latitude) && item.crs === 'GCJ-02'
      )
    }
  })
  assert.ok(result.area.includes('苏州'))
  assert.ok(result.nearbyCount > 0 && result.validCoordinates)
  assert.deepEqual(blocked, [])
  assert.deepEqual(failures, [])
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        count,
        ...result,
        blocked,
        failures,
        boundary:
          'Real AMap SDK/proxy and public POI data. No actual device location, account login, publication, or Mini Program validation.'
      },
      null,
      2
    )
  )
  console.log(JSON.stringify({ passed: true, count, ...result }))
} finally {
  await context.close()
  await browser.close()
}
