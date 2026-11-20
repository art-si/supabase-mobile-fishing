// Isolated lifecycle faults; no provider, GPS, real account or remote business writes.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setH5TextScale } from './h5-text-scale.mjs'

const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5179'
const output = resolve('artifacts/zones-ui/preview-contract')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'zh-CN' })
const checks = [],
  external = [],
  writes = []
const zone = {
  id: '33333333-3333-4333-8333-333333333333',
  title: '隔离预览样例：非真实禁钓信息',
  description: '仅用于范围预览交互验收，不写入线上。',
  location_label: '验收地点',
  longitude: 120.7,
  latitude: 31.3,
  radius_m: 1000,
  source_url: '',
  created_at: '2026-11-20T00:00:00Z',
  crs: 'GCJ-02',
  source: 'community',
  status: 'pending',
  revision: 1,
  own: true,
  observed_on: '2026-11-20',
  expires_on: '2026-12-20'
}
await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
await context.route('**/*', (route) => {
  const url = new URL(route.request().url())
  if (url.origin === base) return route.continue()
  if (url.origin === 'https://tlfmfokyhahlpzmpliad.supabase.co') {
    if (url.pathname.includes('_write')) writes.push(url.pathname)
    return route.fulfill({
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': '*'
      },
      json: url.pathname.endsWith('fishing_zones_read')
        ? { items: [zone], next: null }
        : { items: [], next: null }
    })
  }
  external.push(url.origin)
  return route.abort()
})
await context.addInitScript(() => {
  localStorage.setItem(
    'dyj.auth.v1',
    JSON.stringify({
      type: 'object',
      data: {
        access_token: 'isolated-preview-fixture',
        refresh_token: 'isolated-preview-fixture',
        expires_at: Date.now() / 1000 + 3600,
        user: { id: '11111111-1111-4111-8111-111111111111' }
      }
    })
  )
  const state = (window.zonePreviewFixture = { fail: true, maps: [], gps: 0 })
  class Map {
    constructor(id, options) {
      if (state.fail) {
        state.fail = false
        throw new Error('isolated-provider-failure')
      }
      this.root = document.getElementById(id)
      this.root.textContent = '隔离交互测试占位，不是真实地图'
      this.options = options
      this.zoom = 14
      this.events = {}
      this.fits = []
      this.overlays = []
      state.maps.push(this)
    }
    on(name, callback) {
      this.events[name] = callback
    }
    add(value) {
      this.overlays.push(value)
    }
    setFitView(...args) {
      this.fits.push(args)
      this.zoom = 13
    }
    getZoom() {
      return this.zoom
    }
    setZoom(value) {
      this.zoom = value
      this.events.zoomend?.()
    }
    destroy() {
      this.destroyed = true
      this.root.textContent = ''
    }
  }
  window.AMap = {
    Map,
    Circle: class {
      constructor(options) {
        this.options = options
      }
    },
    Geolocation: class {
      getCurrentPosition() {
        state.gps++
      }
    }
  }
})
const page = await context.newPage()
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', (error) => errors.push(error.name))
const button = (name) => page.getByRole('button', { name, exact: true })
const open = () => button('预览参考范围').click()
const close = () => button('收起范围预览').click()
const complete = () => page.evaluate(() => window.zonePreviewFixture.maps.at(-1).events.complete())
const ready = () => page.locator('.zone-preview__map[aria-busy="false"]').waitFor()
try {
  await page.goto(`${base}/#/pages/map/marks`)
  await open()
  await page.getByText('范围地图未加载', { exact: true }).waitFor()
  assert.equal(await page.getByText('待审核 · 尚未公开', { exact: true }).count(), 1)
  await button('重试').click()
  await page.waitForFunction(() => window.zonePreviewFixture.maps.length === 1)
  await complete()
  await ready()
  assert.deepEqual(
    await page.evaluate(() => {
      const m = window.zonePreviewFixture.maps[0]
      return {
        center: m.options.center,
        circle: m.overlays[0].options,
        fits: m.fits.length,
        maxZoom: m.fits[0][3]
      }
    }),
    {
      center: [120.7, 31.3],
      circle: {
        center: [120.7, 31.3],
        radius: 1000,
        strokeColor: '#9C512F',
        strokeWeight: 2,
        strokeStyle: 'dashed',
        fillColor: '#9C512F',
        fillOpacity: 0.12,
        zIndex: 40,
        bubble: true
      },
      fits: 1,
      maxZoom: 17
    }
  )
  checks.push('provider failure preserves the saved row; retry fits the exact authorized circle')
  await complete()
  assert.equal(await page.evaluate(() => window.zonePreviewFixture.maps[0].fits.length), 1)
  await button('放大范围地图').click()
  assert.equal(await page.evaluate(() => window.zonePreviewFixture.maps[0].zoom), 14)
  await button('缩小范围地图').focus()
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => window.zonePreviewFixture.maps[0].zoom), 13)
  await button('完整范围').focus()
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => window.zonePreviewFixture.maps[0].fits.length), 2)
  await page.evaluate(() => {
    const m = window.zonePreviewFixture.maps[0]
    m.zoom = 19
    m.events.zoomend()
  })
  assert.equal(await button('放大范围地图').getAttribute('aria-disabled'), 'true')
  checks.push(
    'repeat completion does not recenter; zoom and full extent support the keyboard with bounded zoom'
  )

  await page.setViewportSize({ width: 320, height: 720 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await setH5TextScale(page, 24)
  await page.screenshot({ path: resolve(output, 'preview-320-dark-large.png'), fullPage: true })
  assert.equal(
    await page.locator('.zone-description').evaluate((el) => getComputedStyle(el).fontSize),
    '24px'
  )
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  checks.push('320px dark layout retains 150% actual body text without horizontal overflow')

  await close()
  assert.equal(await page.evaluate(() => window.zonePreviewFixture.maps[0].destroyed), true)
  await open()
  await page.waitForFunction(() => window.zonePreviewFixture.maps.length === 2)
  await close()
  await complete()
  assert.equal(await page.locator('.zone-preview').count(), 0)
  assert.deepEqual(
    await page.evaluate(() => {
      const m = window.zonePreviewFixture.maps[1]
      return { destroyed: m.destroyed, fits: m.fits.length }
    }),
    { destroyed: true, fits: 0 }
  )
  checks.push('closing during loading destroys the map and ignores a late completion')

  await open()
  await page.waitForFunction(() => window.zonePreviewFixture.maps.length === 3)
  await complete()
  await ready()
  // Dev-only test entrypoint, with every backend/WS call already isolated above.
  await page.evaluate(async () => {
    const { signOut } = await import('/src/services/session.ts')
    await signOut()
  })
  await page.getByText('登录后查看自己提交的禁钓提醒。', { exact: true }).waitFor()
  assert.equal(await page.locator('.zone-preview').count(), 0)
  assert.equal(await page.evaluate(() => window.zonePreviewFixture.maps[2].destroyed), true)
  assert.equal(await page.evaluate(() => window.zonePreviewFixture.gps), 0)
  assert.deepEqual(external, [])
  assert.deepEqual(writes, [])
  assert.deepEqual(errors, [])
  checks.push('session loss clears the private map; preview never requests GPS or business writes')
  console.log(JSON.stringify({ passed: true, checks }))
} catch (error) {
  process.exitCode = 1
  console.log(
    JSON.stringify({
      passed: false,
      checks,
      error: String(error).replace(/https?:\/\/\S+/g, '[URL]')
    })
  )
  await page.screenshot({ path: resolve(output, 'failed.png'), fullPage: true }).catch(() => {})
} finally {
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify(
      { passed: !process.exitCode, checks, map: 'isolated-sdk', backend: 'isolated-fixtures' },
      null,
      2
    )
  )
  await browser.close()
}
