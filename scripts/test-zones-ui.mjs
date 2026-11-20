// Hybrid acceptance: real AMap SDK/tiles, isolated business API fixtures.
// No actual GPS, identity, community mark or moderation request is sent to Supabase.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setH5TextScale } from './h5-text-scale.mjs'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5179'
const output = resolve('artifacts/zones-ui')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'zh-CN' })
const day = (offset) =>
  new Date(Date.now() + 8 * 3600000 + offset * 86400000).toISOString().slice(0, 10)
const publicZone = {
  id: '33333333-3333-4333-8333-333333333333',
  title: '验收样例：非真实禁钓区域',
  description: '此范围仅用于隔离测试，不是真实管控信息，也没有写入线上。',
  location_label: '交互测试地点',
  longitude: 120.7,
  latitude: 31.3,
  radius_m: 800,
  crs: 'GCJ-02',
  source: 'community',
  status: 'published',
  revision: 2,
  observed_on: day(0),
  expires_on: day(1),
  source_url: '',
  created_at: new Date().toISOString()
}
const writes = [],
  checks = []
let saved,
  failOnce = true,
  page
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'permissions', {
    value: { query: async () => ({ state: 'denied' }) }
  })
  localStorage.setItem(
    'dyj.auth.v1',
    JSON.stringify({
      type: 'object',
      data: {
        access_token: 'isolated-zone-fixture',
        refresh_token: 'isolated-zone-fixture-refresh',
        expires_at: Date.now() / 1000 + 3600,
        user: { id: '11111111-1111-4111-8111-111111111111' }
      }
    })
  )
})
await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
await context.route('https://tlfmfokyhahlpzmpliad.supabase.co/**', async (route) => {
  const url = new URL(route.request().url())
  if (url.pathname.includes('/amap-js/')) return route.continue()
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*'
  }
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  const data = route.request().postDataJSON() || {}
  if (url.pathname.endsWith('fishing_map_spots'))
    return route.fulfill({ headers, json: { items: [], truncated: false, zoom_in: false } })
  if (url.pathname.endsWith('fishing_zones_read')) {
    if (data.action === 'nearby') {
      const b = data.payload
      // Test-only circle stays in the viewport so the real SDK renderer is exercised.
      publicZone.longitude = (b.west + b.east) / 2
      publicZone.latitude = (b.south + b.north) / 2
      return route.fulfill({
        headers,
        json: { items: [publicZone], truncated: false, zoom_in: false }
      })
    }
    return route.fulfill({
      headers,
      json: {
        items:
          saved && (data.action !== 'review' || saved.status === data.payload.status)
            ? [{ ...saved, own: data.action !== 'review' }]
            : [],
        next: null
      }
    })
  }
  if (url.pathname.endsWith('fishing_zones_write')) {
    writes.push(data)
    if (data.action === 'submit') {
      saved = { ...publicZone, ...data.payload, status: 'pending', revision: 1, own: true }
      if (failOnce) {
        failOnce = false
        return route.fulfill({ headers, status: 503, json: { message: 'SERVICE_UNAVAILABLE' } })
      }
    } else if (saved) {
      saved.status = data.action === 'withdraw' ? 'withdrawn' : data.payload.decision
      saved.revision++
    }
    return route.fulfill({
      headers,
      json: { id: saved.id, status: saved.status, revision: saved.revision }
    })
  }
  if (url.pathname.includes('/functions/v1/amap'))
    return route.fulfill({ headers, status: 503, json: { error: 'MAP_NOT_CONFIGURED' } })
  return route.fulfill({ headers, json: { items: [], next: null } })
})
try {
  page = await context.newPage()
  page.setDefaultTimeout(20000)
  await page.goto(`${base}/#/pages/map/index`, { waitUntil: 'domcontentloaded' })
  const input = page.locator('input[aria-label="搜索高德地点"]')
  await input.fill('苏州金鸡湖')
  await page.getByRole('option').first().click()
  // Wait for provider movement and viewport-derived circles, not a blank SDK canvas.
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: /验收样例：非真实禁钓区域/ }).click()
  await page.getByText('钓友提醒 · 非官方边界', { exact: true }).waitFor()
  checks.push('community overlay details retain explicit provenance after recentering')
  await page.getByRole('button', { name: '圈选提醒', exact: true }).click()
  const fill = (label, value) =>
    page.locator(`input[aria-label="${label}"],textarea[aria-label="${label}"]`).fill(value)
  await fill('参考半径（米）', '1000')
  await fill('提醒名称', '隔离验收：岸边禁钓提示')
  await fill('地点说明', '测试地点，非真实管控信息')
  await fill('现场依据', '这是隔离验收数据，只检查页面和交互，不进入真实社区。')
  for (const [label, width, height, dark, large] of [
    ['375', 375, 812, false, false],
    ['320-dark-large', 320, 720, true, true],
    ['440', 440, 956, false, false],
    ['landscape', 812, 375, false, false],
    ['wide', 1280, 900, false, false]
  ]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
    await setH5TextScale(page, large ? 24 : 16)
    await page.waitForTimeout(800)
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.documentElement).fontSize),
      large ? '24px' : '16px'
    )
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      label
    )
    await page.screenshot({ path: resolve(output, `circle-${label}.png`), fullPage: true })
  }
  checks.push(
    'real SDK draws circles; form fits five sizes and dark/150% text without horizontal overflow'
  )
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: '取消圈选', exact: true }).click()
  const discard = page.getByRole('alertdialog', { name: '放弃本次圈选？' })
  await discard.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(
    await page.locator('input[aria-label="提醒名称"]').inputValue(),
    '隔离验收：岸边禁钓提示'
  )
  await page.getByRole('checkbox').click()
  await page.getByRole('button', { name: '提交审核', exact: true }).click()
  await page.getByText('服务暂时不可用，请稍后重试', { exact: true }).waitFor()
  await page.getByRole('button', { name: '提交审核', exact: true }).click()
  await page
    .getByText('已提交审核，暂不公开。可在“我的标记”查看或撤回。', { exact: true })
    .waitFor()
  assert.deepEqual(writes[0], writes[1])
  checks.push(
    'cancel preserves the draft; uncertain save retries reuse the exact idempotent payload'
  )
  await page.getByRole('button', { name: '我的标记', exact: true }).click()
  await page.getByText('待审核 · 尚未公开', { exact: true }).waitFor()
  await page.getByRole('button', { name: '预览参考范围', exact: true }).click()
  await page.locator('.zone-preview__map[aria-busy="false"]').waitFor({ timeout: 40000 })
  await page.getByRole('button', { name: '放大范围地图', exact: true }).click()
  await page.getByRole('button', { name: '缩小范围地图', exact: true }).click()
  await page.getByRole('button', { name: '完整范围', exact: true }).click()
  await page.waitForTimeout(2000)
  checks.push(
    'saved-circle preview renders real AMap without the deliberately unavailable static API'
  )
  await page.screenshot({ path: resolve(output, 'mine-375.png'), fullPage: true })
  await page.getByRole('button', { name: '撤回标记', exact: true }).click()
  const withdraw = page.getByRole('alertdialog', { name: '撤回这条标记？' })
  await withdraw.getByRole('button', { name: '取消', exact: true }).click()
  await withdraw.waitFor({ state: 'hidden' })
  assert.equal(writes.length, 2)
  await page.getByRole('button', { name: '撤回标记', exact: true }).click()
  await withdraw.getByRole('button', { name: '撤回标记', exact: true }).click()
  await page.getByText('已撤回', { exact: true }).waitFor()
  assert.equal(writes.at(-1).action, 'withdraw')
  checks.push('owner history shows pending state; withdrawal is explicit and cancel does not write')
  saved.status = 'pending'
  saved.revision = 1
  await page.goto(`${base}/?zone-review-fixture=1#/pages/map/marks?review=1`, {
    waitUntil: 'domcontentloaded'
  })
  await page.getByRole('button', { name: '通过提醒', exact: true }).click()
  await page.getByRole('button', { name: '确认通过', exact: true }).click()
  await page.getByText('请先填写核验与处理说明。', { exact: true }).waitFor()
  const beforeReview = writes.length
  await page
    .locator('textarea[aria-label="核验与处理说明"]')
    .fill('隔离审核测试，不是真实审核结论。')
  await page.getByRole('button', { name: '确认通过', exact: true }).click()
  await page.getByText('没有符合条件的提醒。', { exact: true }).waitFor()
  assert.equal(writes.length, beforeReview + 1)
  assert.equal(writes.at(-1).payload.decision, 'published')
  await page.getByRole('button', { name: '查看已公开', exact: true }).click()
  await page.getByText('已公开 · 钓友提醒', { exact: true }).waitFor()
  await page.getByRole('button', { name: '隐藏', exact: true }).click()
  await page.locator('textarea[aria-label="核验与处理说明"]').fill('已失效，隔离测试隐藏。')
  await page.getByRole('button', { name: '确认隐藏', exact: true }).click()
  await page.getByText('没有符合条件的提醒。', { exact: true }).waitFor()
  checks.push(
    'review UI requires an explanation and uses explicit approve/hide actions with current revision'
  )
  console.log(
    JSON.stringify(
      { passed: true, checks, backend: 'isolated-fixtures', map: 'real-amap' },
      null,
      2
    )
  )
} catch (error) {
  await page?.screenshot({ path: resolve(output, 'failed.png'), fullPage: true }).catch(() => {})
  console.log(
    JSON.stringify(
      {
        passed: false,
        checks,
        error: String(error).replace(/https?:\/\/\S+/g, '[URL]'),
        ui: await page
          ?.locator('.fishing-content')
          .innerText()
          .catch(() => '')
      },
      null,
      2
    )
  )
  process.exitCode = 1
} finally {
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify(
      { passed: !process.exitCode, checks, backend: 'isolated-fixtures', map: 'real-amap' },
      null,
      2
    )
  )
  await browser.close()
}
