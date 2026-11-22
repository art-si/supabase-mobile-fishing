// Isolated SDK/session fixtures prove UI/race behavior, never device GPS or a real login.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setH5TextScale } from './h5-text-scale.mjs'

const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
const output = resolve('artifacts/post-location')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const owner = '11111111-1111-4111-8111-111111111111'
const checks = [],
  errors = [],
  escaped = [],
  contexts = []
const draftKey = `dyj.live.draft.${owner}.post`
const pass = (name) => {
  checks.push(name)
  console.log('PASS', name)
}
async function setup(options = {}) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    locale: 'zh-CN',
    reducedMotion: 'reduce'
  })
  contexts.push(context)
  await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
  await context.route('**/*', (route) => {
    const request = route.request(),
      url = new URL(request.url())
    if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
    if (url.origin !== 'https://jupuypvmgjpnpntfetqv.supabase.co') {
      escaped.push(url.origin)
      return route.abort()
    }
    const reply = (json) =>
      route.fulfill({
        json,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*'
        }
      })
    if (request.method() === 'OPTIONS') return reply({})
    if (url.pathname.startsWith('/functions/') || url.pathname === '/auth/v1/otp') {
      escaped.push(url.pathname)
      return route.abort()
    }
    if (url.pathname === '/auth/v1/user') return reply({ id: owner })
    if (url.pathname.endsWith('fishing_moderation')) return reply({ allowed: false })
    if (url.pathname.endsWith('fishing_read')) {
      const body = request.postDataJSON() || {}
      if (body.action === 'profile')
        return reply({ profile: { id: owner, nickname: '定位验收' }, posts: [] })
      return reply({ items: [], next: null })
    }
    return reply([])
  })
  await context.addInitScript(
    ({ owner, draftKey, options }) => {
      if (!options.guest)
        localStorage.setItem(
          'dyj.auth.v1',
          JSON.stringify({
            type: 'object',
            data: {
              access_token: 'post-location-fixture',
              refresh_token: 'fixture',
              expires_at: Date.now() / 1000 + 3600,
              user: { id: owner }
            }
          })
        )
      if (options.saved)
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            type: 'object',
            data: {
              id: '22222222-2222-4222-8222-222222222222',
              title: '',
              body: '保留正文',
              species: '',
              method: '台钓',
              bait: '',
              additives: '',
              weight: '',
              weight_unit: 'kg',
              count: '',
              length: '',
              occurred_on: '2026-11-20',
              occurred_time: '09:00',
              topic: '',
              audience: 'private',
              media: [],
              location_label: '以前选好的水库',
              location_longitude: 120.6,
              location_latitude: 31.32
            }
          })
        )
      if (options.insecure) Object.defineProperty(window, 'isSecureContext', { value: false })
      Object.defineProperty(navigator, 'permissions', {
        configurable: true,
        value: { query: async () => ({ state: options.denied ? 'denied' : 'granted' }) }
      })
      const state = (window.postLocationFixture = {
        geo: [],
        queries: [],
        nearby: [],
        geocodes: []
      })
      const point = (x = 120.612345, y = 31.321234) => ({ getLng: () => x, getLat: () => y })
      class Geolocation {
        getCurrentPosition(callback) {
          state.geo.push(callback)
          if (!options.delayed)
            setTimeout(
              () => callback('complete', { position: point(), location_type: 'h5', accuracy: 20 }),
              20
            )
        }
      }
      class Geocoder {
        getAddress(p, callback) {
          state.geocodes.push(p)
          callback('complete', {
            regeocode: {
              formattedAddress: '不得自动公开的家庭门牌号',
              addressComponent: { province: '江苏省', city: '苏州市', district: '吴中区' }
            }
          })
        }
      }
      const poi = (name) => ({
        id: name,
        name,
        address: '湖边步道',
        cityname: '苏州市',
        adname: '吴中区',
        location: point(),
        adcode: '320506'
      })
      class PlaceSearch {
        constructor(options) {
          this.options = options
        }
        search(keyword, callback) {
          state.queries.push({ keyword, options: this.options })
          setTimeout(
            () => callback('complete', { poiList: { pois: [poi(keyword)], count: 1 } }),
            keyword === '旧水库' ? 900 : 20
          )
        }
        searchNearBy(keyword, center, radius, callback) {
          state.nearby.push({ center, radius })
          callback('complete', {
            poiList: {
              pois: [poi('附近湖岸步道'), poi('附近长名称水域公共垂钓步道与生态公园入口')],
              count: 2
            }
          })
        }
      }
      window.AMap = { Geolocation, Geocoder, PlaceSearch }
    },
    { owner, draftKey, options }
  )
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', (error) => errors.push(error.message))
  return page
}
const button = (page, name) => page.getByRole('button', { name, exact: true })
const input = (page) => page.locator('input[aria-label="搜索所在位置"]')
async function shot(page, name) {
  await page.evaluate(() => document.fonts.ready)
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `${name} horizontal overflow`
  )
  await page.screenshot({ path: resolve(output, `${name}.png`) })
}
try {
  const page = await setup()
  await page.goto(`${base}/#/pages/post/compose`, { waitUntil: 'domcontentloaded' })
  const trigger = button(page, '选择所在位置')
  await trigger.getByText('苏州市 · 吴中区', { exact: true }).filter({ visible: true }).waitFor()
  assert.equal(await page.evaluate(() => window.postLocationFixture.geo.length), 1)
  assert.ok(!(await page.locator('body').innerText()).includes('家庭门牌'))
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).data, draftKey)
  assert.equal(stored.location_longitude, 120.62)
  assert.equal(stored.location_latitude, 31.32)
  pass('新动态自动定位一次，仅回填城市区县及降低精度的坐标')
  await trigger.scrollIntoViewIfNeeded()
  await shot(page, 'compose-auto-375')
  await trigger.click()
  await page.getByRole('button', { name: /附近湖岸步道/ }).waitFor()
  assert.equal(await button(page, '搜索').count(), 0)
  assert.equal(await page.getByText('先找到那片水', { exact: true }).count(), 0)
  for (const [width, height, scale, theme] of [
    [320, 740, 16, 'light'],
    [375, 812, 16, 'light'],
    [440, 956, 16, 'light'],
    [812, 375, 16, 'light'],
    [1280, 800, 16, 'dark'],
    [320, 740, 24, 'dark'],
    [375, 812, 32, 'dark']
  ]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: theme })
    await setH5TextScale(page, scale)
    await shot(page, `picker-${width}-${height}-${scale}-${theme}`)
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await setH5TextScale(page, 16)
  await page.emulateMedia({ colorScheme: 'light' })
  await input(page).fill('旧水库')
  await page.waitForFunction(() =>
    window.postLocationFixture.queries.some((q) => q.keyword === '旧水库')
  )
  await input(page).fill('新的河湾')
  await page.getByRole('option', { name: /新的河湾/ }).waitFor()
  await page.waitForTimeout(1000)
  assert.equal(await page.getByRole('option', { name: /旧水库/ }).count(), 0)
  await input(page).focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await trigger.getByText('新的河湾', { exact: true }).filter({ visible: true }).waitFor()
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(() => window.postLocationFixture.geo.length), 2)
  pass('附近列表、即时搜索、旧请求作废、键盘点选与返回回填通过；H5不请求登录地图接口')

  const saved = await setup({ saved: true })
  await saved.goto(`${base}/#/pages/post/compose`)
  await button(saved, '选择所在位置')
    .getByText('以前选好的水库')
    .filter({ visible: true })
    .waitFor()
  await saved.waitForTimeout(250)
  assert.equal(await saved.evaluate(() => window.postLocationFixture.geo.length), 0)
  pass('恢复已选位置的草稿不重新定位覆盖')

  const slow = await setup({ delayed: true })
  await slow.goto(`${base}/#/pages/post/compose`)
  await slow.waitForFunction(() => window.postLocationFixture.geo.length === 1)
  await button(slow, '选择所在位置').click()
  await input(slow).fill('手动选择的湖泊')
  await slow.getByRole('option', { name: /手动选择的湖泊/ }).click()
  await button(slow, '选择所在位置').getByText('手动选择的湖泊').filter({ visible: true }).waitFor()
  await slow.evaluate(() =>
    window.postLocationFixture.geo.forEach((callback) =>
      callback('complete', {
        position: { getLng: () => 121, getLat: () => 32 },
        location_type: 'h5'
      })
    )
  )
  await slow.waitForTimeout(200)
  await button(slow, '选择所在位置').getByText('手动选择的湖泊').filter({ visible: true }).waitFor()
  pass('迟到定位不能覆盖手动选择，选点已离开后的回调不写入')

  for (const mode of ['denied', 'insecure']) {
    const failed = await setup({ [mode]: true })
    await failed.goto(`${base}/#/pages/post/compose`)
    await button(failed, '选择所在位置').click()
    await failed
      .getByText(mode === 'denied' ? /定位权限已关闭/ : /局域网 HTTP 无法获取当前位置/)
      .waitFor()
    assert.equal(await failed.evaluate(() => window.postLocationFixture.geo.length), 0)
    await input(failed).fill('金鸡湖')
    await failed.getByRole('option', { name: /金鸡湖/ }).waitFor()
    await shot(failed, `picker-${mode}-search`)
  }
  pass('拒绝定位及局域网HTTP明确提示，仍可搜索，不伪造GPS')

  const guest = await setup({ guest: true, denied: true })
  await guest.goto(`${base}/#/pages/map/search?pick=1&context=post&requestId=guest-fixture`)
  await input(guest).fill('公开地点查询')
  await guest.getByRole('option', { name: /公开地点查询/ }).waitFor()
  assert.ok(!guest.url().includes('/pages/login'))
  pass('H5公开地点搜索无须登录且输入不会跳登录页')
  assert.deepEqual(escaped, [])
  assert.deepEqual(errors, [])
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        checks,
        errors,
        escaped,
        boundary:
          'Isolated browser SDK/session fixtures only; not device GPS, real Auth, or Mini Program acceptance.'
      },
      null,
      2
    )
  )
} finally {
  for (const context of contexts) await context.close()
  await browser.close()
}
