// Isolated SDK/API fixtures. This proves UI state transitions, NOT real GPS/provider delivery.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5179'
const output = resolve('artifacts/map-interactions')
await mkdir(output, { recursive: true })
const checks = [],
  escaped = [],
  errors = []
const browser = await chromium.launch({ channel: 'chrome', headless: true })
let page
let activePage
function pass(name) {
  checks.push(name)
}
async function setup({ insecure = false, denied = false, pick = true, signedIn = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    locale: 'zh-CN',
    permissions: ['geolocation'],
    geolocation: { latitude: 31.12, longitude: 120.12 },
    reducedMotion: 'reduce'
  })
  const writes = []
  const mapReads = []
  const zoneReads = []
  await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.origin === base) return route.continue()
    if (url.origin === 'https://jupuypvmgjpnpntfetqv.supabase.co') {
      if (url.pathname.endsWith('fishing_map_spots') && route.request().method() === 'POST')
        mapReads.push(route.request().postDataJSON())
      if (url.pathname.endsWith('fishing_zones_write')) writes.push(route.request().postDataJSON())
      if (url.pathname.endsWith('fishing_zones_read') && route.request().method() === 'POST')
        zoneReads.push(route.request().postDataJSON())
      return route.fulfill({
        json: { items: [], next: null },
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*'
        }
      })
    }
    escaped.push(url.origin)
    return route.abort()
  })
  await context.addInitScript(
    ({ insecure, denied, signedIn }) => {
      if (signedIn)
        localStorage.setItem(
          'dyj.auth.v1',
          JSON.stringify({
            type: 'object',
            data: {
              access_token: 'isolated-ui-fixture-not-a-jwt',
              refresh_token: 'isolated-ui-fixture-not-a-token',
              expires_at: Date.now() / 1000 + 3600,
              user: { id: '11111111-1111-4111-8111-111111111111' }
            }
          })
        )
      // Satisfy the app entry check, then isolate the map's own location fallback.
      if (insecure) Object.defineProperty(window, 'isSecureContext', { get: () => !window.mapFixture?.map })
      Object.defineProperty(navigator, 'permissions', {
        value: { query: async () => ({ state: denied && window.mapFixture?.map ? 'denied' : 'granted' }) }
      })
      const point = (x, y) => ({ getLng: () => x, getLat: () => y })
      class Pixel {
        constructor(x, y) {
          this.x = x
          this.y = y
        }
        getX() {
          return this.x
        }
        getY() {
          return this.y
        }
      }
      const state = (window.mapFixture = {
        centers: [],
        zooms: [],
        queries: [],
        pending: {},
        geo: [],
        bounds: { west: 119.9, south: 30.9, east: 120.1, north: 31.1 },
        overlays: [],
        map: null
      })
      class Map {
        constructor(id, options) {
          state.options = options
          state.map = this
          this.events = {}
          const el = this.root = document.getElementById(id)
          el.textContent = '交互测试占位（不是真实地图）'
          el.style.display = 'grid'
          el.style.placeItems = 'center'
          el.addEventListener('click', () => this.events.click?.({ lnglat: point(120.5, 31.5) }))
          queueMicrotask(() => this.events.complete?.())
        }
        on(name, callback) {
          const previous = this.events[name]
          this.events[name] = (...args) => {
            previous?.(...args)
            callback(...args)
          }
        }
        setCenter(value) {
          state.centers.push(value)
          state.bounds = {
            west: value[0] - 0.1,
            east: value[0] + 0.1,
            south: value[1] - 0.1,
            north: value[1] + 0.1
          }
        }
        setZoom(value) {
          state.zooms.push(value)
        }
        getCenter() {
          return point(120, 31)
        }
        getZoom() {
          return state.zooms.at(-1) || state.options.zoom
        }
        lngLatToContainer([lng, lat]) {
          const scale = 10000 * 2 ** (this.getZoom() - 10)
          return new Pixel((lng - state.bounds.west) * scale, (state.bounds.north - lat) * scale)
        }
        getBounds() {
          return {
            getSouthWest: () => point(state.bounds.west, state.bounds.south),
            getNorthEast: () => point(state.bounds.east, state.bounds.north)
          }
        }
        add(values) {
          for (const overlay of [values].flat()) {
            state.overlays.push(overlay)
            const content = overlay.options?.content
            if (content instanceof HTMLElement) this.root.append(content)
          }
        }
        remove(values) {
          for (const overlay of [values].flat()) overlay.options?.content?.remove?.()
          state.overlays = state.overlays.filter((item) => ![values].flat().includes(item))
        }
        destroy() {}
      }
      class Marker {
        constructor(options) {
          this.options = options
          this.events = {}
        }
        setPosition() {}
        on(name, callback) {
          this.events[name] = callback
        }
      }
      class Polygon {
        constructor(options) {
          this.options = options
          this.events = {}
        }
        on(name, callback) {
          this.events[name] = callback
        }
        setOptions(options) {
          Object.assign(this.options, options)
        }
      }
      class AutoComplete {
        search(query, callback) {
          state.queries.push(query)
          state.pending[query] = callback
        }
      }
      class PlaceSearch {
        search(query, callback) {
          callback('complete', {
            poiList: {
              pois: [
                { id: 'resolved', name: query, address: '交互测试地址', location: point(121, 32) }
              ]
            }
          })
        }
      }
      class Geolocation {
        constructor(options) {
          state.geoOptions = options
        }
        getCurrentPosition(callback) {
          state.geo.push(callback)
        }
      }
      class Geocoder {
        getAddress(p, callback) {
          callback('complete', { regeocode: { formattedAddress: '交互测试选点' } })
        }
      }
      window.AMap = { Map, Marker, Polygon, Pixel, AutoComplete, PlaceSearch, Geolocation, Geocoder }
      state.resolveSearch = (query, name, coordinates = true) =>
        state.pending[query]?.('complete', {
          tips: [
            {
              id: query,
              name,
              district: '测试城市',
              address: '测试地址',
              location: coordinates ? point(121, 32) : []
            }
          ]
        })
      state.resolveGeo = (index = 0) =>
        state.geo[index]?.('complete', { position: point(119.5, 30.5), location_type: 'h5' })
      state.pan = (bounds) => {
        document
          .querySelector('.mobile-map__canvas')
          .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        state.bounds = bounds
        state.map.events.moveend?.()
        state.map.events.dragend?.()
      }
      state.settle = (bounds) => {
        state.bounds = bounds
        state.map.events.moveend?.()
      }
    },
    { insecure, denied, signedIn }
  )
  const tab = await context.newPage()
  activePage = tab
  tab.on('pageerror', (error) => errors.push(error.message))
  tab.setDefaultTimeout(12000)
  await tab.goto(`${base}/#/pages/map/index${pick ? '?pick=1&requestId=fixture-map' : ''}`, {
    waitUntil: 'domcontentloaded'
  })
  await tab.locator('input[aria-label="搜索高德地点"]').waitFor()
  await tab.locator('.mobile-map__loading').waitFor({ state: 'hidden' })
  await tab.waitForFunction(() => window.mapFixture.map)
  tab.fixtureWrites = writes
  tab.fixtureMapReads = mapReads
  tab.fixtureZoneReads = zoneReads
  return tab
}
async function visibility(tab, visible) {
  await tab.evaluate((visible) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: visible ? 'visible' : 'hidden'
    })
    document.dispatchEvent(new Event('visibilitychange'))
  }, visible)
}
try {
  page = await setup()
  await page.waitForFunction(() => mapFixture.geo.length === 1)
  const overview = await page.evaluate(() => ({
    center: mapFixture.options.center,
    zoom: mapFixture.options.zoom
  }))
  assert.deepEqual(overview, { center: [104, 34], zoom: 4 })
  await page.evaluate(() => mapFixture.resolveGeo())
  await page.getByText('已定位到附近。请选点确认，不会自动保存或公开位置。').waitFor()
  assert.deepEqual(await page.evaluate(() => mapFixture.centers), [[119.5, 30.5]])
  assert.equal(await page.getByRole('button', { name: '确认这个位置', exact: true }).isVisible(), false)
  const geoOptions = await page.evaluate(() => mapFixture.geoOptions)
  assert.equal(geoOptions.noIpLocate, 3)
  assert.equal(geoOptions.panToLocation, false)
  pass(
    'map starts at the national overview and locates nearby without IP fallback or selecting the point'
  )
  const input = page.locator('input[aria-label="搜索高德地点"]')
  assert.equal(await page.getByRole('button', { name: '搜索', exact: true }).count(), 0)
  await input.fill('慢湖')
  await page.waitForFunction(() => mapFixture.pending['慢湖'])
  await input.fill('新湖')
  await page.waitForFunction(() => mapFixture.pending['新湖'])
  await page.evaluate(() => {
    mapFixture.resolveSearch('新湖', '新湖结果')
    mapFixture.resolveSearch('慢湖', '旧湖结果')
  })
  await page.getByRole('option', { name: /新湖结果/ }).waitFor()
  assert.equal(await page.getByText('旧湖结果', { exact: true }).count(), 0)
  const confirmPoint = page.getByRole('button', { name: '确认这个位置', exact: true })
  await input.press('ArrowDown')
  assert.ok(await input.getAttribute('aria-activedescendant'))
  assert.equal(await confirmPoint.count(), 0)
  assert.deepEqual(await page.evaluate(() => mapFixture.centers), [[119.5, 30.5]])
  await input.press('Enter')
  await confirmPoint.waitFor()
  assert.equal(await confirmPoint.isEnabled(), true)
  pass(
    'debounced autocomplete uses the latest results; arrows highlight and Enter selects the point'
  )
  await input.fill('清空中')
  await confirmPoint.waitFor({ state: 'detached' })
  await page.waitForFunction(() => mapFixture.pending['清空中'])
  await page.getByRole('button', { name: '清除搜索', exact: true }).click()
  await page.evaluate(() => mapFixture.resolveSearch('清空中', '迟到结果'))
  assert.equal(await page.getByRole('option').count(), 0)
  assert.equal(await input.inputValue(), '')
  pass('clear cancels delayed results and preserves an empty input')
  await input.evaluate((el) => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    el.value = 'pinyin'
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'pinyin', isComposing: true }))
  })
  await page.waitForTimeout(500)
  assert.equal(await page.evaluate(() => mapFixture.queries.includes('pinyin')), false)
  await input.evaluate((el) => {
    el.value = '中文湖'
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文湖' }))
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: '中文湖' }))
  })
  await page.waitForFunction(() => mapFixture.pending['中文湖'])
  await input.press('Escape')
  await page.evaluate(() => mapFixture.resolveSearch('中文湖', '应取消结果'))
  assert.equal(await page.getByRole('option').count(), 0)
  pass('IME candidates never issue premature searches; Escape dismisses pending suggestions')
  await input.fill('新湖')
  await page.waitForFunction(() => mapFixture.queries.filter((q) => q === '新湖').length === 2)
  await page.evaluate(() => mapFixture.resolveSearch('新湖', '再次搜索结果'))
  await page.getByRole('option', { name: /再次搜索结果/ }).waitFor()
  pass('revisiting an earlier keyword searches again after clear and dismissed suggestions')
  await input.fill('无坐标')
  await page.waitForFunction(() => mapFixture.pending['无坐标'])
  await page.evaluate(() => mapFixture.resolveSearch('无坐标', '区域词', false))
  await page.getByRole('option', { name: /区域词/ }).click()
  await page.getByRole('option', { name: /区域词.*交互测试地址/ }).waitFor()
  await page.getByRole('option', { name: /区域词.*交互测试地址/ }).click()
  pass(
    'coordinate-less autocomplete terms resolve into selectable places, not invalid map coordinates'
  )
  const race = await setup()
  await race.waitForFunction(() => mapFixture.geo.length === 1)
  await race.locator('.mobile-map__canvas').click()
  await race.evaluate(() => mapFixture.resolveGeo())
  assert.deepEqual(await race.evaluate(() => mapFixture.centers), [])
  await race.getByText('交互测试选点', { exact: true }).waitFor()
  await race.context().close()
  pass('late automatic location cannot overwrite a user-selected point or move the map')
  const wheelRace = await setup()
  await wheelRace.waitForFunction(() => mapFixture.geo.length === 1)
  await wheelRace.locator('.mobile-map__canvas').dispatchEvent('wheel', { deltaY: 100 })
  await wheelRace.evaluate(() => mapFixture.resolveGeo())
  assert.deepEqual(await wheelRace.evaluate(() => mapFixture.centers), [])
  const backgroundRace = await setup({ signedIn: true, pick: false })
  await backgroundRace.waitForFunction(() => mapFixture.geo.length === 1)
  await backgroundRace.getByRole('button', { name: '返回上一页', exact: true }).click()
  await backgroundRace.waitForURL((url) => url.hash === '#/' || url.hash.startsWith('#/pages/home/'))
  await backgroundRace.evaluate(() => mapFixture.resolveGeo())
  assert.deepEqual(await backgroundRace.evaluate(() => mapFixture.centers), [])
  await wheelRace.context().close()
  await backgroundRace.context().close()
  pass(
    'wheel interaction and navigating away prevent late GPS from moving or changing the hidden map'
  )
  const http = await setup({ insecure: true })
  await http.getByText('局域网 HTTP 无法获取当前位置。请使用 HTTPS，或搜索地点。').waitFor()
  assert.equal(await http.evaluate(() => mapFixture.geo.length), 0)
  assert.equal(await http.locator('.mobile-map__canvas').isVisible(), true)
  const denied = await setup({ denied: true })
  await denied.getByText('定位权限已关闭。可在浏览器或系统设置中开启，也可以搜索地点。').waitFor()
  assert.equal(await denied.evaluate(() => mapFixture.geo.length), 0)
  await http.context().close()
  await denied.context().close()
  pass(
    'HTTP and denied permission explain recovery without replacing the usable map with an error page'
  )
  const zonePage = await setup({ pick: false, signedIn: true })
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*'
  }
  const zoneDate = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const fixtureZone = {
    id: '33333333-3333-4333-8333-333333333333',
    title: '交互样例 · 非真实禁钓区域',
    description: '此标注用于隔离界面验收。',
    location_label: '隔离测试水域',
    longitude: 120,
    latitude: 31,
    radius_m: 0,
    boundary: { type: 'Polygon', coordinates: [[[119.99, 30.99], [120.01, 30.99], [120.01, 31.01], [119.99, 30.99]]] },
    crs: 'GCJ-02',
    source: 'community',
    status: 'published',
    revision: 1,
    observed_on: zoneDate,
    expires_on: zoneDate,
    source_url: '',
    created_at: new Date().toISOString()
  }
  const zonePayload = (items) => ({ items, truncated: false, zoom_in: false })
  const zoneCalls = []
  const oldBounds = { west: 121, east: 122, south: 31, north: 32 }
  const newBounds = { west: 122, east: 123, south: 32, north: 33 }
  const noZones = '暂未收录此范围的禁钓区域，请核对现场标识和最新公告。'
  let returnedZones = [fixtureZone]
  let reportedPoints = []
  let failRead = true
  let holdWest
  let heldRead
  await zonePage.context().route('**/rest/v1/rpc/fishing_zones_read', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ headers, status: 204 })
    const { action, payload } = route.request().postDataJSON()
    if (action !== 'nearby') return route.fulfill({ headers, json: { items: [], next: null } })
    zoneCalls.push(payload)
    if (payload.west === holdWest) {
      heldRead = route
      return
    }
    if (failRead) return route.fulfill({ headers, status: 503, json: { code: 'TEMPORARILY_UNAVAILABLE' } })
    return route.fulfill({ headers, json: { ...zonePayload(returnedZones), spot_points: reportedPoints } })
  })
  await zonePage.context().route('**/rest/v1/rpc/fishing_zone_feedback', (route) =>
    route.fulfill({
      headers,
      json: {
        version: 'isolated-fixture', total: 0, can_fish: 0, cannot_fish: 0, percent: 0, mine: null,
        note: '', released: false, changed_at: null, minimum: 10, threshold: 60
      }
    })
  )
  const listTrigger = zonePage.getByRole('button', { name: '地图内禁钓区域', exact: true })
  const list = zonePage.getByRole('dialog', { name: '地图内禁钓区域', exact: true })
  const details = zonePage.getByRole('dialog', { name: '禁钓提醒', exact: true })
  const zoneRow = list.getByRole('button', { name: /交互样例 · 非真实禁钓区域/ })
  const listError = list.getByRole('alert').filter({ hasText: '禁钓区域未加载' })
  await listTrigger.click()
  await listError.waitFor()
  assert.equal(await list.getByText(noZones, { exact: true }).count(), 0)
  await zonePage.setViewportSize({ width: 320, height: 720 })
  await zonePage.emulateMedia({ colorScheme: 'dark' })
  const largeText = await zonePage.addStyleTag({ content: 'html { font-size: 32px !important; }' })
  const retry = list.getByRole('button', { name: '重试', exact: true })
  await retry.focus()
  await zonePage.waitForFunction(() => {
    const button = document.activeElement
    const copy = button?.previousElementSibling
    if (!button?.matches('.mobile-load-error__retry') || !copy) return false
    const retryBounds = button.getBoundingClientRect()
    return retryBounds.height >= 44 && retryBounds.top >= copy.getBoundingClientRect().bottom - 1
  })
  await zonePage.screenshot({ path: resolve(output, 'zone-read-retry-dark-320.png') })
  failRead = false
  await retry.press('Enter')
  await zoneRow.waitFor()
  await listError.waitFor({ state: 'hidden' })
  assert.ok(await zonePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  pass('the zone list explains read failures and retries inside the sheet at 320px and 200% text')
  await largeText.evaluate((node) => node.remove())
  await zonePage.emulateMedia({ colorScheme: 'light' })
  await zonePage.setViewportSize({ width: 375, height: 812 })

  await zoneRow.focus()
  await zoneRow.press('Enter')
  await details.getByText('钓友上报', { exact: true }).waitFor()
  assert.equal(await zonePage.evaluate(() => document.body.style.overflow), 'hidden')
  const backToList = details.getByRole('button', { name: '返回区域列表', exact: true })
  await zonePage.waitForFunction(() => document.activeElement?.textContent?.includes('返回区域列表'))
  assert.equal(await zonePage.getByRole('dialog').count(), 1)
  await zonePage.screenshot({ path: resolve(output, 'zone-details-375.png') })
  await backToList.press('Enter')
  await zoneRow.waitFor()
  assert.equal(await zoneRow.evaluate((row) => document.activeElement === row), true)
  await zonePage.keyboard.press('Escape')
  await list.waitFor({ state: 'hidden' })
  assert.equal(await listTrigger.evaluate((button) => document.activeElement === button), true)
  assert.equal(await zonePage.evaluate(() => document.body.style.overflow), '')
  pass('the list and its detail share one sheet; Back restores the selected row and Escape restores the map control')

  const fence = zonePage.getByRole('button', {
    name: '查看禁钓区域：交互样例 · 非真实禁钓区域，钓友上报', exact: true
  })
  await fence.waitFor()
  const pinImage = await fence.locator('img').evaluate(async img => { await img.decode(); return img.currentSrc })
  assert.equal((await fence.textContent()).trim(), '')
  const fenceNode = await fence.elementHandle()
  await fence.evaluate((node) => {
    window.mapFixture.fenceEvents = []
    for (const type of ['focus', 'keydown', 'keyup', 'click'])
      node.addEventListener(type, (event) => window.mapFixture.fenceEvents.push([event.type, event.key]))
  })
  await fence.focus()
  await zonePage.keyboard.down('Enter')
  await zonePage.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '关闭区域详情')
  await zonePage.keyboard.up('Enter')
  await details.getByText(fixtureZone.title, { exact: true }).waitFor()
  assert.equal(await details.getByRole('button', { name: '返回区域列表', exact: true }).count(), 0)
  assert.equal(await fence.getAttribute('aria-pressed'), 'true')
  assert.equal(await fenceNode.evaluate((node) => node.isConnected), true)
  assert.equal(await zonePage.evaluate(() => mapFixture.overlays.find((p) => p.options?.path)?.options?.strokeWeight), 4)
  await zonePage.keyboard.press('Escape')
  await details.waitFor({ state: 'hidden' })
  assert.equal(await fenceNode.evaluate((node) => document.activeElement === node), true)
  await zonePage.emulateMedia({ reducedMotion: 'no-preference' })
  await fence.press('Enter')
  await details.getByText(fixtureZone.title, { exact: true }).waitFor()
  await zonePage.keyboard.press('Escape')
  await fence.press('Enter')
  await details.getByText(fixtureZone.title, { exact: true }).waitFor()
  const surfaceSelector = '.wd-popup--bottom:has([aria-label="禁钓提醒"])'
  await zonePage.waitForFunction((selector) => {
    const surface = document.querySelector(selector)
    if (!surface) return false
    return Math.abs(new DOMMatrixReadOnly(getComputedStyle(surface).transform).m42) < 1
  }, surfaceSelector)
  await zonePage.keyboard.press('Escape')
  await zonePage.waitForFunction((selector) => {
    const surface = document.querySelector(selector)
    if (!surface) return false
    const offset = new DOMMatrixReadOnly(getComputedStyle(surface).transform).m42
    return offset > 1 && offset < surface.offsetHeight - 1
  }, surfaceSelector)
  await fence.press('Enter')
  await details.getByText(fixtureZone.title, { exact: true }).waitFor()
  assert.equal(await zonePage.getByRole('dialog').count(), 1)
  await details.getByRole('button', { name: '关闭区域详情', exact: true }).click()
  await details.waitFor({ state: 'hidden' })
  await zonePage.emulateMedia({ reducedMotion: 'reduce' })
  pass('the fence retains focus, the Enter release cannot close the new sheet, and the exit animation reverses on reopening')

  const pointReport = {
    id: 'a4444444-4444-4444-8444-444444444444',
    name: '点位样例 · 非真实禁钓点位',
    city: '隔离测试地点',
    longitude: 120.02,
    latitude: 31.02,
    observed_on: zoneDate,
    review_revision: 1,
    created_at: fixtureZone.created_at
  }
  reportedPoints = [pointReport]
  await listTrigger.click()
  await list.getByRole('button', { name: /点位样例 · 非真实禁钓点位/ }).waitFor()
  await zonePage.keyboard.press('Escape')
  const pointPin = zonePage.getByRole('button', { name: `查看禁钓点位：${pointReport.name}`, exact: true })
  await pointPin.waitFor()
  assert.equal(await pointPin.locator('img').evaluate(async img => { await img.decode(); return img.currentSrc }), pinImage)
  assert.equal((await pointPin.textContent()).trim(), '')
  const pinBox = await pointPin.boundingBox()
  assert.ok(pinBox.width >= 44 && pinBox.height >= 44)
  await pointPin.press('Enter')
  await details.getByText('钓位上报', { exact: true }).waitFor()
  await details.getByText('钓友将这个公开钓位标记为禁钓。', { exact: true }).waitFor()
  assert.equal(await details.getByRole('button', { name: '查看上报钓位', exact: true }).isVisible(), true)
  await zonePage.screenshot({ path: resolve(output, 'reported-point-details-375.png') })
  await zonePage.keyboard.press('Escape')
  await details.waitFor({ state: 'hidden' })
  assert.equal(await pointPin.evaluate(node => document.activeElement === node), true)
  reportedPoints = []
  pass('a reported spot has its own 44px target and provenance; closing its detail restores focus to the spot pin')

  holdWest = oldBounds.west
  await zonePage.evaluate((bounds) => mapFixture.pan(bounds), oldBounds)
  await zonePage.waitForRequest((req) => req.postData()?.includes('"west":121'))
  returnedZones = []
  await zonePage.evaluate((bounds) => mapFixture.pan(bounds), newBounds)
  await listTrigger.click()
  await list.getByText(noZones, { exact: true }).waitFor()
  assert.deepEqual(zoneCalls.at(-1), newBounds)
  const priorResponse = zonePage.waitForResponse((res) => res.request().postData()?.includes('"west":121'))
  await heldRead.fulfill({ headers, json: zonePayload([fixtureZone]) })
  await priorResponse
  assert.equal(await fence.count(), 0)
  assert.equal(await zoneRow.count(), 0)
  await list.getByRole('button', { name: '关闭区域列表', exact: true }).click()
  pass('a late preceding viewport response cannot restore outdated fences or list rows')

  returnedZones = [fixtureZone]
  await visibility(zonePage, false)
  const readsWhileHidden = zoneCalls.length
  await zonePage.evaluate((bounds) => mapFixture.settle(bounds), newBounds)
  await zonePage.waitForTimeout(350)
  assert.equal(zoneCalls.length, readsWhileHidden)
  await visibility(zonePage, true)
  await fence.waitFor()
  await visibility(zonePage, false)
  await fence.waitFor({ state: 'detached' })
  returnedZones = []
  await visibility(zonePage, true)
  await listTrigger.click()
  await list.getByText(noZones, { exact: true }).waitFor()
  assert.ok(zoneCalls.length > readsWhileHidden)
  assert.equal(await zoneRow.count(), 0)
  assert.equal(zonePage.fixtureMapReads.length, 0, 'No saved fishing spots are queried by the water map')
  assert.equal(zonePage.fixtureWrites.length, 0)
  pass('background and foreground handle the current zone viewport without fetching retired spot overlays or writing data')
  for (const [width, height, dark] of [
    [320, 720, true],
    [375, 812, false],
    [440, 956, false],
    [812, 375, false],
    [1280, 900, false]
  ]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' })
    await page.addStyleTag({ content: 'html { font-size: 24px !important; }' })
    await input.fill(`长地点${width}`)
    await page.waitForFunction((q) => mapFixture.pending[q], `长地点${width}`)
    await page.evaluate(
      (q) => mapFixture.resolveSearch(q, '这是一个名称很长的测试水域与附近桥梁区域'),
      `长地点${width}`
    )
    await page.getByRole('option').waitFor()
    assert.equal(await confirmPoint.count(), 0)
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.documentElement).fontSize),
      '24px'
    )
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    assert.ok((await page.getByRole('option').boundingBox()).height >= 44)
    await page.screenshot({ path: resolve(output, `fixture-map-${width}.png`), fullPage: true })
  }
  pass(
    'suggestions fit 320/375/440/landscape/wide, dark mode and 150% text; targets remain at least 44px'
  )
  assert.equal(escaped.length, 0)
  assert.deepEqual(errors, [])
  pass('zero external provider requests; fixture evidence is separate from real-map acceptance')
  console.log(JSON.stringify({ passed: true, checks }, null, 2))
} catch (error) {
  const failedPage = activePage && !activePage.isClosed() ? activePage : page
  await failedPage
    ?.screenshot({ path: resolve(output, 'fixture-failed.png'), fullPage: true })
    .catch(() => {})
  console.log(
    JSON.stringify(
      {
        passed: false,
        checks,
        error: String(error.stack || error).replace(/https?:\/\/\S+/g, '[URL]'),
        errors,
        ui: await failedPage?.locator('body').innerText().catch(() => ''),
        focus: await failedPage?.evaluate(() => ({
          active: document.activeElement?.getAttribute('aria-label'),
          events: window.mapFixture?.fenceEvents,
          fencePressed: document.querySelector('.mobile-map__fence-label')?.getAttribute('aria-pressed'),
          sheet: Array.from(document.querySelectorAll('.mobile-sheet-frame'), (node) => ({
            title: node.querySelector('[role="dialog"]')?.getAttribute('aria-label'),
            display: getComputedStyle(node).display,
            inert: node.hasAttribute('inert'),
            raised: node.classList.contains('mobile-sheet-frame--raised')
          }))
        })).catch(() => null)
      },
      null,
      2
    )
  )
  process.exitCode = 1
} finally {
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify({ checks, passed: !process.exitCode, escaped }, null, 2)
  )
  await browser.close()
}
