// Isolated SDK/API fixtures. This proves UI state transitions, NOT real GPS/provider delivery.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5179'
const output = resolve('artifacts/map-interactions')
await mkdir(output, { recursive: true })
const checks = [],
  escaped = []
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
    reducedMotion: 'reduce'
  })
  const writes = []
  const mapReads = []
  const zoneReads = []
  await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.origin === base) return route.continue()
    if (url.origin === 'https://tlfmfokyhahlpzmpliad.supabase.co') {
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
      if (insecure) Object.defineProperty(window, 'isSecureContext', { value: false })
      Object.defineProperty(navigator, 'permissions', {
        value: { query: async () => ({ state: denied ? 'denied' : 'granted' }) }
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
        markers: [],
        circles: [],
        bounds: { west: 119.9, south: 30.9, east: 120.1, north: 31.1 },
        overlays: [],
        map: null
      })
      class Map {
        constructor(id, options) {
          state.options = options
          state.map = this
          this.events = {}
          const el = document.getElementById(id)
          el.textContent = '交互测试占位（不是真实地图）'
          el.style.display = 'grid'
          el.style.placeItems = 'center'
          el.addEventListener('click', () => this.events.click?.({ lnglat: point(120.5, 31.5) }))
        }
        on(name, callback) {
          this.events[name] = callback
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
          state.overlays.push(...(Array.isArray(values) ? values : [values]))
        }
        remove(values) {
          state.overlays = state.overlays.filter(
            (item) => !(Array.isArray(values) ? values : [values]).includes(item)
          )
        }
        destroy() {}
      }
      class Marker {
        constructor(options) {
          this.options = options
          this.events = {}
          state.markers.push(options)
        }
        setPosition() {}
        on(name, callback) {
          this.events[name] = callback
        }
      }
      class Circle {
        constructor(options) {
          this.options = options
          this.events = {}
          state.circles.push(options)
        }
        on(name, callback) {
          this.events[name] = callback
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
      window.AMap = { Map, Marker, Circle, Pixel, AutoComplete, PlaceSearch, Geolocation, Geocoder }
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
          .getElementById('amap-canvas')
          .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        state.bounds = bounds
        state.map.events.moveend?.()
        state.map.events.dragend?.()
      }
      state.settle = (bounds) => {
        state.bounds = bounds
        state.map.events.moveend?.()
      }
      state.clickZone = () => {
        state.overlays
          .find((overlay) => overlay instanceof Circle && overlay.options.strokeStyle === 'dashed')
          ?.events.click?.()
      }
    },
    { insecure, denied, signedIn }
  )
  const tab = await context.newPage()
  tab.setDefaultTimeout(12000)
  await tab.goto(`${base}/#/pages/map/index${pick ? '?pick=1&requestId=fixture-map' : ''}`, {
    waitUntil: 'domcontentloaded'
  })
  await tab.locator('input[aria-label="搜索高德地点"]').waitFor()
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
  assert.equal(await page.evaluate(() => Object.hasOwn(mapFixture.options, 'center')), false)
  await page.evaluate(() => mapFixture.resolveGeo())
  await page.getByText('已定位到附近。请选点确认，不会自动保存或公开位置。').waitFor()
  assert.deepEqual(await page.evaluate(() => mapFixture.centers), [[119.5, 30.5]])
  assert.equal(
    await page.getByRole('button', { name: '确认这个位置', exact: true }).isEnabled(),
    false
  )
  const geoOptions = await page.evaluate(() => mapFixture.geoOptions)
  assert.equal(geoOptions.noIpLocate, 3)
  assert.equal(geoOptions.panToLocation, false)
  pass(
    'opening map automatically requests precise location; no fixed Suzhou, IP fallback or implicit saved selection'
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
  await input.press('ArrowDown')
  assert.ok(await input.getAttribute('aria-activedescendant'))
  await input.press('Enter')
  await page.getByRole('button', { name: '确认这个位置', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: '确认这个位置', exact: true }).isEnabled(),
    true
  )
  pass(
    'debounced autocomplete is latest-wins and supports arrow/Enter selection without a Search button'
  )
  await input.fill('清空中')
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
  await race.locator('#amap-canvas').click()
  await race.evaluate(() => mapFixture.resolveGeo())
  assert.deepEqual(await race.evaluate(() => mapFixture.centers), [])
  await race.getByText('交互测试选点', { exact: true }).waitFor()
  pass('late automatic location cannot overwrite a user-selected point or move the map')
  const wheelRace = await setup()
  await wheelRace.waitForFunction(() => mapFixture.geo.length === 1)
  await wheelRace.locator('#amap-canvas').dispatchEvent('wheel', { deltaY: 100 })
  await wheelRace.evaluate(() => mapFixture.resolveGeo())
  assert.deepEqual(await wheelRace.evaluate(() => mapFixture.centers), [])
  const backgroundRace = await setup({ signedIn: true, pick: false })
  await backgroundRace.waitForFunction(() => mapFixture.geo.length === 1)
  await backgroundRace.getByRole('button', { name: '我的标记', exact: true }).click()
  await backgroundRace.waitForURL('**/pages/map/marks')
  await backgroundRace.evaluate(() => mapFixture.resolveGeo())
  assert.deepEqual(await backgroundRace.evaluate(() => mapFixture.centers), [])
  pass(
    'wheel interaction and navigating away prevent late GPS from moving or changing the hidden map'
  )
  const http = await setup({ insecure: true })
  await http.getByText('局域网 HTTP 无法获取当前位置。请使用 HTTPS，或搜索地点。').waitFor()
  assert.equal(await http.evaluate(() => mapFixture.geo.length), 0)
  assert.equal(await http.locator('#amap-canvas').isVisible(), true)
  const denied = await setup({ denied: true })
  await denied.getByText('定位权限已关闭。可在浏览器或系统设置中开启，也可以搜索地点。').waitFor()
  assert.equal(await denied.evaluate(() => mapFixture.geo.length), 0)
  pass(
    'HTTP and denied permission explain recovery without replacing the usable map with an error page'
  )
  const viewportPage = await setup({ denied: true, pick: false })
  activePage = viewportPage
  await viewportPage
    .getByText('这片水域还没有可见钓位，可以移动地图再找找。', { exact: true })
    .waitFor()
  const initialReads = viewportPage.fixtureMapReads.length
  const areaA = { west: 121, east: 122, south: 31, north: 32 }
  const areaB = { west: 122, east: 123, south: 32, north: 33 }
  await viewportPage.evaluate((bounds) => mapFixture.pan(bounds), areaA)
  await viewportPage.getByRole('button', { name: '查看这片水域', exact: true }).waitFor()
  await viewportPage.waitForTimeout(350)
  assert.equal(viewportPage.fixtureMapReads.length, initialReads)
  const mapCalls = []
  let lateMapRoute
  let failMap = false
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*'
  }
  const mapSpot = {
    id: 'a1111111-1111-4111-8111-111111111111',
    name: '当前水域测试钓位',
    city: '测试城市',
    water_type: '自然水域',
    longitude: 122.4,
    latitude: 32.4,
    precision: 'area',
    own: false,
    crs: 'GCJ-02'
  }
  await viewportPage.context().route('**/rest/v1/rpc/fishing_map_spots', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ headers, json: {} })
    const body = route.request().postDataJSON()
    mapCalls.push(body)
    if (body.payload.west === areaA.west) {
      lateMapRoute = route
      return
    }
    if (failMap)
      return route.fulfill({ headers, status: 503, json: { message: 'TEMPORARILY_UNAVAILABLE' } })
    return route.fulfill({ headers, json: { items: [mapSpot], truncated: false, zoom_in: false } })
  })
  const pendingMapRequest = viewportPage.waitForRequest((r) => r.postData()?.includes('"west":121'))
  await viewportPage.getByRole('button', { name: '查看这片水域', exact: true }).click()
  await viewportPage.getByText('正在查找这片水域的钓位…', { exact: true }).waitFor()
  await pendingMapRequest
  await viewportPage.evaluate((bounds) => mapFixture.pan(bounds), areaB)
  await viewportPage.getByRole('button', { name: '查看这片水域', exact: true }).click()
  await viewportPage.getByRole('button', { name: '钓位列表 · 1', exact: true }).waitFor()
  await lateMapRoute.fulfill({
    headers,
    json: { items: [{ ...mapSpot, name: '旧水域结果' }], truncated: false, zoom_in: false }
  })
  await viewportPage.getByRole('button', { name: '钓位列表 · 1', exact: true }).click()
  await viewportPage.getByRole('button', { name: /当前水域测试钓位/ }).click()
  await viewportPage.getByText('大致水域，不是精确钓点', { exact: true }).waitFor()
  assert.equal(await viewportPage.getByText('旧水域结果', { exact: true }).count(), 0)
  assert.deepEqual(mapCalls[0], { payload: areaA })
  assert.deepEqual(mapCalls[1], { payload: areaB })
  assert.equal(
    await viewportPage.evaluate(
      () => mapFixture.overlays.filter((p) => p.options?.title?.includes('旧水域')).length
    ),
    0
  )
  pass(
    'viewport pan waits for explicit refresh; only current bounds are sent, late old results cannot replace pins or cards'
  )
  const settledBounds = { ...areaB, west: 122.001, east: 123.001 }
  await viewportPage.evaluate((bounds) => mapFixture.settle(bounds), settledBounds)
  await viewportPage.getByRole('button', { name: '钓位列表 · 1', exact: true }).waitFor()
  assert.deepEqual(mapCalls.at(-1), { payload: settledBounds })
  await viewportPage.getByRole('button', { name: '钓位列表 · 1', exact: true }).click()
  await viewportPage.getByRole('button', { name: /当前水域测试钓位/ }).click()
  pass(
    'late provider settling after a refresh is followed automatically until the next explicit user gesture'
  )
  for (const [width, height, dark] of [
    [320, 720, true],
    [375, 812, false],
    [440, 956, false],
    [812, 375, false],
    [1280, 900, false]
  ]) {
    await viewportPage.setViewportSize({ width, height })
    await viewportPage.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
    await viewportPage.addStyleTag({ content: 'html { font-size: 24px !important; }' })
    assert.ok(
      await viewportPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
    )
    const detail = viewportPage.getByRole('button', { name: '查看钓位详情', exact: true })
    assert.ok((await detail.boundingBox()).height >= 44)
    await detail.focus()
    await viewportPage.screenshot({
      path: resolve(output, `viewport-card-${width}.png`),
      fullPage: true
    })
  }
  failMap = true
  await viewportPage.evaluate(() => mapFixture.pan({ west: 123, east: 124, south: 33, north: 34 }))
  assert.equal(await viewportPage.getByText(mapSpot.name, { exact: true }).count(), 0)
  await viewportPage.getByRole('button', { name: '查看这片水域', exact: true }).click()
  await viewportPage.getByText('钓位未能加载', { exact: true }).waitFor()
  assert.equal(
    await viewportPage
      .getByText('这片水域还没有可见钓位，可以移动地图再找找。', { exact: true })
      .count(),
    0
  )
  failMap = false
  await viewportPage.getByRole('button', { name: '重试', exact: true }).click()
  await viewportPage.getByRole('button', { name: '钓位列表 · 1', exact: true }).waitFor()
  pass(
    'map pin cards fit all five viewport sizes at large type; movement clears old pins and failed requests show retry, never false empty success'
  )
  const zonePage = await setup({ denied: true, pick: false, signedIn: true })
  activePage = zonePage
  const zoneDate = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const fixtureZones = [
    {
      id: '33333333-3333-4333-8333-333333333333',
      title: '交互样例：非真实禁钓区域',
      description: '这里只验证重复点选与来源说明，不是真实禁钓数据。',
      location_label: '隔离测试水域',
      longitude: 121.5,
      latitude: 31.5,
      radius_m: 500,
      crs: 'GCJ-02',
      source: 'community',
      status: 'published',
      revision: 1,
      observed_on: zoneDate,
      expires_on: zoneDate,
      source_url: '',
      created_at: new Date().toISOString()
    }
  ]
  let returnedZones = fixtureZones,
    holdZone = false,
    lateZoneRoute
  const zoneCalls = []
  await zonePage.context().route('**/rest/v1/rpc/fishing_zones_read', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ headers, status: 204 })
    const body = route.request().postDataJSON()
    if (body.action !== 'nearby') return route.fulfill({ headers, json: { items: [], next: null } })
    zoneCalls.push(body)
    if (holdZone) {
      lateZoneRoute = route
      return
    }
    return route.fulfill({
      headers,
      json: { items: returnedZones, truncated: false, zoom_in: false }
    })
  })
  await zonePage.evaluate((bounds) => mapFixture.pan(bounds), areaA)
  await zonePage.getByRole('button', { name: /交互样例：非真实禁钓区域/ }).waitFor()
  const provenance = zonePage.getByText('钓友提醒 · 非官方边界', { exact: true })
  await zonePage.evaluate(() => mapFixture.clickZone())
  await provenance.waitFor()
  await zonePage.getByRole('button', { name: '收起详情', exact: true }).click()
  await provenance.waitFor({ state: 'hidden' })
  await zonePage.evaluate(() => mapFixture.clickZone())
  await provenance.waitFor()
  await zonePage.screenshot({
    path: resolve(output, 'fixture-zone-reopen-375.png'),
    fullPage: true
  })
  pass(
    'tapping the same community circle reopens its details after dismissing; provenance stays explicit'
  )
  // Hold a read begun on the map, leave for another route, then deliver the old
  // result. Neither cached circles nor that late read may revive a hidden mark.
  holdZone = true
  const pendingZone = zonePage.waitForRequest((r) => r.postData()?.includes('"west":122'))
  await zonePage.evaluate((bounds) => mapFixture.pan(bounds), areaB)
  await pendingZone
  await zonePage.getByRole('button', { name: '我的标记', exact: true }).click()
  await zonePage.waitForURL('**/pages/map/marks')
  returnedZones = []
  holdZone = false
  await lateZoneRoute.fulfill({
    headers,
    json: { items: fixtureZones, truncated: false, zoom_in: false }
  })
  await zonePage.waitForTimeout(350)
  assert.equal(
    await zonePage.evaluate(
      () => mapFixture.overlays.filter((o) => o.options.strokeStyle === 'dashed').length
    ),
    0
  )
  const beforeReturn = zoneCalls.length
  await zonePage.getByRole('button', { name: '返回上一页', exact: true }).click()
  await zonePage.waitForURL('**/pages/map/index')
  await zonePage
    .getByText('此范围暂无已审核提醒；没有标记不代表允许垂钓。', { exact: true })
    .waitFor()
  assert.ok(zoneCalls.length > beforeReturn)
  assert.deepEqual(zoneCalls.at(-1).payload, areaB)
  assert.equal(await zonePage.getByText(fixtureZones[0].title, { exact: true }).count(), 0)
  pass(
    'returning to the same viewport revalidates zones; a hidden-route late response cannot restore an old circle or its details'
  )
  returnedZones = fixtureZones
  await visibility(zonePage, false)
  const backgroundReads = zoneCalls.length
  await zonePage.evaluate((bounds) => mapFixture.settle(bounds), areaA)
  await zonePage.waitForTimeout(350)
  assert.equal(zoneCalls.length, backgroundReads)
  await visibility(zonePage, true)
  await zonePage.getByRole('button', { name: /交互样例：非真实禁钓区域/ }).waitFor()
  await visibility(zonePage, false)
  await zonePage.waitForFunction(() =>
    mapFixture.overlays.every((o) => o.options.strokeStyle !== 'dashed')
  )
  returnedZones = []
  await visibility(zonePage, true)
  await zonePage
    .getByText('此范围暂无已审核提醒；没有标记不代表允许垂钓。', { exact: true })
    .waitFor()
  pass(
    'app background pauses zone reads and clears public overlays; foreground reload removes withdrawn data without a map gesture'
  )
  const drawingPage = await setup({ denied: true, pick: false, signedIn: true })
  activePage = drawingPage
  await drawingPage.waitForFunction(() => !!window.mapFixture?.map)
  await drawingPage.getByRole('button', { name: '圈选提醒', exact: true }).click()
  const fill = (label, value) =>
    drawingPage.locator(`input[aria-label="${label}"],textarea[aria-label="${label}"]`).fill(value)
  await fill('提醒名称', '交互测试禁钓标牌')
  await fill('地点说明', '测试水域，不是真实地点')
  await fill('现场依据', '交互测试说明，未上传真实坐标或报告。')
  await visibility(drawingPage, false)
  await visibility(drawingPage, true)
  assert.equal(
    await drawingPage.locator('input[aria-label="提醒名称"]').inputValue(),
    '交互测试禁钓标牌'
  )
  assert.equal(
    await drawingPage.locator('textarea[aria-label="现场依据"]').inputValue(),
    '交互测试说明，未上传真实坐标或报告。'
  )
  assert.equal(drawingPage.fixtureWrites.length, 0)
  pass('foreground revalidation preserves an unsent circle draft and does not submit it')
  await drawingPage.getByRole('button', { name: '提交审核', exact: true }).click()
  await drawingPage.getByText('请确认审核后公开的范围与说明。', { exact: true }).waitFor()
  assert.equal(drawingPage.fixtureWrites.length, 0)
  await drawingPage.locator('#amap-canvas').click()
  await fill('参考半径（米）', '500')
  await drawingPage.waitForFunction(() => mapFixture.circles.at(-1)?.radius === 500)
  const zoneConsent = drawingPage.getByRole('checkbox')
  assert.equal(await zoneConsent.getAttribute('aria-checked'), 'false')
  assert.equal(await zoneConsent.locator('.wd-checkbox').count(), 1)
  assert.ok((await zoneConsent.boundingBox()).height >= 48)
  await drawingPage
    .getByText('我确认：审核后公开此范围和说明；这是钓友提醒，不冒充官方公告。', { exact: true })
    .click()
  assert.equal(await zoneConsent.getAttribute('aria-checked'), 'true')
  await zoneConsent.focus()
  await zoneConsent.press('Space')
  assert.equal(await zoneConsent.getAttribute('aria-checked'), 'false')
  await zoneConsent.press('Space')
  assert.equal(await zoneConsent.getAttribute('aria-checked'), 'true')
  await drawingPage.getByRole('button', { name: '提交审核', exact: true }).click()
  await drawingPage
    .getByText('已提交审核，暂不公开。可在“我的标记”查看或撤回。', { exact: true })
    .waitFor()
  assert.equal(drawingPage.fixtureWrites.length, 1)
  assert.deepEqual(
    [
      drawingPage.fixtureWrites[0].payload.longitude,
      drawingPage.fixtureWrites[0].payload.latitude,
      drawingPage.fixtureWrites[0].payload.radius_m
    ],
    [120.5, 31.5, 500]
  )
  assert.equal('source' in drawingPage.fixtureWrites[0].payload, false)
  pass(
    'circle drafting uses point/radius/explicit consent with a standard icon, text and keyboard activation; submits pending once and never forges official provenance'
  )
  const staticCalls = []
  await drawingPage.context().route('**/functions/v1/amap', (route) => {
    const payload = route.request().postDataJSON()
    staticCalls.push(payload)
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
    return payload?.action === 'search'
      ? route.fulfill({
          headers,
          json: {
            items: [
              {
                id: 'static-fixture',
                name: '静态搜索测试湖',
                address: '隔离测试地址',
                longitude: 121.2,
                latitude: 31.2,
                crs: 'GCJ-02'
              }
            ],
            hasMore: false
          }
        })
      : route.fulfill({ headers, status: 503, json: { error: 'MAP_NOT_CONFIGURED' } })
  })
  await drawingPage.goto(`${base}/?static-fixture=1#/pages/map/search`, {
    waitUntil: 'domcontentloaded'
  })
  const staticInput = drawingPage.locator('input[aria-label="搜索高德地点"]')
  await staticInput.fill('测试湖')
  await drawingPage.getByRole('option', { name: /静态搜索测试湖/ }).click()
  await drawingPage.getByRole('button', { name: '圈选提醒', exact: true }).click()
  assert.equal(await staticInput.isDisabled(), true)
  await drawingPage.locator('input[aria-label="参考半径（米）"]').fill('500')
  await drawingPage.waitForTimeout(800)
  assert.ok(
    staticCalls.some(
      (call) => call.radiusM === 500 && call.longitude === 121.2 && call.latitude === 31.2
    )
  )
  await drawingPage.getByRole('button', { name: '取消圈选', exact: true }).click()
  const cancelDrawing = drawingPage.getByRole('alertdialog', { name: '放弃本次圈选？' })
  await cancelDrawing.getByRole('button', { name: '放弃圈选', exact: true }).click()
  await cancelDrawing.waitFor({ state: 'hidden' })
  assert.equal(await staticInput.isDisabled(), false)
  await drawingPage.waitForTimeout(350)
  const staticZoneReads = drawingPage.fixtureZoneReads.filter((r) => r.action === 'nearby').length
  await drawingPage.getByRole('button', { name: '我的标记', exact: true }).click()
  await drawingPage.waitForURL('**/pages/map/marks')
  await drawingPage.getByRole('button', { name: '返回上一页', exact: true }).click()
  await drawingPage.waitForURL('**/pages/map/search')
  await drawingPage
    .getByText('此范围暂无已审核提醒；没有标记不代表允许垂钓。', { exact: true })
    .waitFor()
  assert.ok(
    drawingPage.fixtureZoneReads.filter((r) => r.action === 'nearby').length > staticZoneReads
  )
  assert.equal(await drawingPage.getByText('静态搜索测试湖', { exact: true }).count(), 1)
  pass(
    'the personal-miniapp search route revalidates reminders on return without losing the selected place'
  )
  pass(
    'personal-miniapp route uses live search, bounded circle-preview payloads and prevents replacing the place mid-draft; preview failure remains explicit'
  )
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
  pass('zero external provider requests; fixture evidence is separate from real-map acceptance')
  console.log(JSON.stringify({ passed: true, checks }, null, 2))
} catch (error) {
  await (activePage || page)
    ?.screenshot({ path: resolve(output, 'fixture-failed.png'), fullPage: true })
    .catch(() => {})
  console.log(
    JSON.stringify(
      {
        passed: false,
        checks,
        error: String(error).replace(/https?:\/\/\S+/g, '[URL]'),
        ui: await (activePage || page)
          .locator('.fishing-content')
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
    JSON.stringify({ checks, passed: !process.exitCode, escaped }, null, 2)
  )
  await browser.close()
}
