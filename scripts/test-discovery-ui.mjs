// H5 acceptance with isolated app responses, real AMap tiles and injected browser coordinates.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { setH5TextScale } from './h5-text-scale.mjs'

const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5179'
const output = 'artifacts/discovery'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const owner = '11111111-1111-4111-8111-111111111111'
const catchEvidence = '一上午上了十几条鲫鱼。'
const spotBase = {
  author: { id: owner, nickname: '验收样例' }, city: '武汉市', species: '鲫鱼',
  water_type: '自然水域', observed_on: '2026-11-19', created_at: '2026-11-20T08:00:00Z',
  status: 'published', audience: 'public', fishing_status: 'allowed', precision: 'area',
  longitude: 114.19, latitude: 30.5
}
const fixtureSpots = [
  { ...spotBase, id: '10000000-0000-4000-8000-000000000001', name: '湖东浅滩',
    description: catchEvidence + '岸边很干净。https://v.douyin.com/fixture-spot/' },
  { ...spotBase, id: '10000000-0000-4000-8000-000000000002', name: '芦苇湾',
    description: '工作日上午钓友很少。水很清澈。https://m.toutiao.com/is/test-spot/' },
  { ...spotBase, id: '10000000-0000-4000-8000-000000000003', name: '水库北岸',
    water_type: '水库', description: '岸边干净。https://www.bilibili.com/video/BVfixture/' },
  { ...spotBase, id: '10000000-0000-4000-8000-000000000004', name: '关闭的岸线',
    fishing_status: 'prohibited', description: '鱼情好，平日人少。' }
]
const errors = []
const requests = []
let reportsEnabled = false
let boundAt = '2026-11-20'
let biliBoundAt = null

try {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 }, locale: 'zh-CN', reducedMotion: 'reduce',
    geolocation: { longitude: 114.1885, latitude: 30.5128, accuracy: 20 },
    permissions: ['geolocation']
  })
  await context.addInitScript(({ owner }) => {
    localStorage.setItem('dyj.feed.city', '武汉市')
    localStorage.setItem('dyj.auth.v1', JSON.stringify({
      type: 'object', data: {
        access_token: 'isolated-discovery-fixture', refresh_token: 'fixture',
        expires_at: Date.now() / 1000 + 3600, user: { id: owner }
      }
    }))
    let provider
    Object.defineProperty(window, 'AMap', {
      configurable: true,
      get() {
        if (provider?.Map && !provider.Map.discoveryCaptured) {
          provider.Map = new Proxy(provider.Map, {
            construct(Target, args) {
              return window.discoveryMap = Reflect.construct(Target, args)
            }
          })
          provider.Map.discoveryCaptured = true
        }
        if (provider?.PlaceSearch && !provider.PlaceSearch.discoveryCaptured) {
          const search = provider.PlaceSearch.prototype.search
          provider.PlaceSearch.prototype.search = function (name, callback) {
            if (name !== '验收外部钓点' && name !== '杉野灵溪') return search.call(this, name, callback)
            return callback('complete', { poiList: { count: 1, pois: [{
              id: name === '验收外部钓点' ? 'B0FIXTURE1' : 'B0FIXTURE2',
              name, cityname: '武汉市', address: '验收样例路',
              location: new provider.LngLat(114.12, 30.4)
            }] } })
          }
          provider.PlaceSearch.discoveryCaptured = true
        }
        return provider
      },
      set(value) { provider = value }
    })
  }, { owner })
  await context.routeWebSocket(/supabase\.co/, socket => socket.close())
  await context.route('**/static/web/water-index/manifest.json', route =>
    route.fulfill({ json: { version: '20261120T000000Z', tiles: [] } }))
  const sourceVisits = []
  await context.route('https://v.douyin.com/**', route => {
    sourceVisits.push(route.request().url())
    return route.fulfill({ body: '验收用外部原文' })
  })
  await context.route('https://www.bilibili.com/video/BVexternal/', route => {
    sourceVisits.push(route.request().url())
    return route.fulfill({ body: '验收用 B 站原文' })
  })
  let completeLabels
  const labelGate = new Promise(resolve => { completeLabels = resolve })
  const state = 'bb2b4c10-4bf8-44bb-aa1e-c788dbcba282'
  await context.route('https://account.bilibili.com/pc/account-pc/auth/oauth**', async route => {
    const params = new URL(route.request().url()).searchParams
    assert.equal(params.get('state'), state)
    const callback = new URL(base + '/static/social-callback.html')
    callback.search = new URLSearchParams({ code: 'fixture-code', state })
    await route.fulfill({ status: 302, headers: { location: callback.href } })
  })
  await context.route('https://jupuypvmgjpnpntfetqv.supabase.co/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.includes('/amap-js/')) return route.continue()
    const reply = json => route.fulfill({ json, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': '*'
    } })
    if (route.request().method() === 'OPTIONS') return reply({})
    if (path === '/auth/v1/user') return reply({ id: owner })
    const body = route.request().postDataJSON() || {}
    if (path.startsWith('/functions/v1/')) requests.push({ path, body })
    if (path.endsWith('/social-accounts')) {
      if (body.operation === 'unlink') { boundAt = null; return reply({ ok: true }) }
      if (body.operation === 'start') {
        assert.equal(body.platform, 'bilibili')
        return reply({ url: 'https://account.bilibili.com/pc/account-pc/auth/oauth?state=' + state, state })
      }
      if (body.operation === 'finish') {
        assert.equal(body.platform, 'bilibili')
        assert.equal(body.state, state)
        assert.equal(body.code, 'fixture-code')
        biliBoundAt = '2026-11-20'
        return reply({ ok: true })
      }
      return reply([
        { platform: 'douyin', available: true, boundAt },
        { platform: 'toutiao', available: false, boundAt: null },
        { platform: 'bilibili', available: true, boundAt: biliBoundAt }
      ])
    }
    if (path.endsWith('/fishing_list_spot_leads')) {
      assert.equal(body.city_name, '武汉市')
      return reply([{
        name: '验收外部钓点', city: '武汉市', waterType: '自然水域',
        labels: { quiet: '工作日这段水面钓友很少。' }, sourceDate: '2026-10-18',
        source: { platform: 'bilibili', url: 'https://www.bilibili.com/video/BVexternal/' }
      }, {
        name: '杉野灵溪休闲垂钓区', city: '武汉市', waterType: '钓场',
        poiQuery: '杉野灵溪',
        labels: { setting: '园区有浅滩、休憩座椅和休闲垂钓区。' }, sourceDate: '2026-10-03',
        source: { platform: 'public', url: 'https://hbj.wuhan.gov.cn/hjxw/202610/t20261008_2857123.html' }
      }])
    }
    if (path.endsWith('/spot-discovery') && body.operation === 'water_notices') return reply({ items: [] })
    if (path.endsWith('/spot-discovery')) {
      assert.equal(body.operation, 'labels')
      assert.deepEqual(body.ids, fixtureSpots.slice(0, 3).map(spot => spot.id))
      await labelGate
      return reply({ mode: 'ai', items: [{
        spotId: fixtureSpots[0].id, labels: { catch: catchEvidence, quiet: '模型虚构的理由' }
      }] })
    }
    if (path.endsWith('fishing_read') && body.action === 'spots')
      return reply({ items: fixtureSpots.filter(spot =>
        (!body.payload?.type || spot.water_type === body.payload.type) &&
        (!body.payload?.query || spot.name.includes(body.payload.query))
      ), next: null })
    if (path.endsWith('fishing_zones_read')) return reply({
      items: [], truncated: false, zoom_in: false, spot_points:
        reportsEnabled && body.payload?.east - body.payload?.west < .3 ? [{
          id: fixtureSpots[3].id, name: '验收上报点', city: '武汉市', observed_on: '2026-11-19',
          created_at: '2026-11-20T08:00:00Z', review_revision: 1, longitude: 114.194, latitude: 30.508
        }] : []
    })
    if (path.endsWith('fishing_zones_write')) throw new Error('Automatic fence attempted a public write')
    return reply({ items: [], next: null })
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(18000)
  await page.goto(base + '/#/pages/home/index?tab=spots', { waitUntil: 'domcontentloaded' })
  const spotCard = name => page.locator('.spot-card').filter({
    has: page.getByRole('button', { name: '查看钓位：' + name, exact: true })
  })
  await spotCard('湖东浅滩').waitFor()
  await spotCard('芦苇湾').getByText('人少', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: /AI 找钓位|获取推荐/ }).count(), 0)
  assert.equal(await spotCard('关闭的岸线').getByText('人少', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: /^(鱼情好|人少|环境好|推荐)$/ }).count(), 0)
  await page.getByText('验收外部钓点', { exact: true }).waitFor()
  await page.getByText('杉野灵溪休闲垂钓区', { exact: true }).waitFor()
  const externalCard = page.locator('.spot-card').filter({ hasText: '验收外部钓点' })
  await externalCard.getByRole('button', { name: /在地图中查看.*验收样例路/ }).click()
  const placeDialog = page.getByRole('dialog', { name: '在地图中查看' })
  await placeDialog.getByText('高德地点 验收外部钓点 · 经度 114.12 · 纬度 30.4', { exact: true }).waitFor()
  await page.screenshot({ path: output + '/external-spot-location.png' })
  await page.keyboard.press('Escape')
  await placeDialog.waitFor({ state: 'hidden' })
  completeLabels()
  await spotCard('湖东浅滩').getByText('鱼情好', { exact: true }).waitFor()
  assert.equal(await spotCard('湖东浅滩').getByText('「' + catchEvidence + '」', { exact: true }).count(), 0)
  assert.equal(await spotCard('湖东浅滩').getByText('人少', { exact: true }).count(), 0)
  assert.equal(requests.filter(item => item.body.operation === 'labels').length, 1)
  assert.equal(await page.locator('.spot-card').getByRole('button', { name: /原文/ }).count(), 0)
  assert.deepEqual(sourceVisits, [])
  const titleAction = externalCard.getByRole('button', { name: '查看钓位：验收外部钓点', exact: true })
  await titleAction.focus()
  await page.keyboard.press('Enter')
  const details = page.getByRole('dialog', { name: '验收外部钓点', exact: true })
  const original = details.getByRole('button', { name: '打开B 站原文', exact: true })
  await original.waitFor()
  await page.screenshot({ path: output + '/external-source-detail.png' })
  const opened = context.waitForEvent('page')
  await original.click()
  const originalPage = await opened
  await originalPage.waitForLoadState()
  assert.deepEqual(sourceVisits, ['https://www.bilibili.com/video/BVexternal/'])
  await originalPage.close()
  await page.keyboard.press('Escape')
  await details.waitFor({ state: 'hidden' })
  assert.equal(await titleAction.evaluate(element => element === document.activeElement), true)
  await page.evaluate(() => document.activeElement?.blur())
  for (const [name, width, height] of [
    ['320', 320, 740], ['375', 375, 812], ['440', 440, 956],
    ['landscape', 844, 390], ['wide', 1280, 900], ['dark-large', 320, 812]
  ]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: name === 'dark-large' ? 'dark' : 'light' })
    await setH5TextScale(page, name === 'dark-large' ? 24 : 16)
    await page.evaluate(() => window.scrollTo(0, 0))
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: output + '/main-recommend-' + name + '.png' })
  }
  await page.getByRole('button', { name: '水库', exact: true }).click()
  await spotCard('湖东浅滩').waitFor({ state: 'detached' })
  await page.getByText('验收外部钓点', { exact: true }).waitFor({ state: 'detached' })
  await spotCard('水库北岸').waitFor()
  await page.goto(base + '/#/pages/spot/discover')
  await page.waitForURL(/#\/(?:pages\/home\/index)?\?tab=spots$/)
  await spotCard('芦苇湾').waitFor()

  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'light' })
  await setH5TextScale(page, 16)
  await page.goto(base + '/#/pages/account/connections', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '解绑抖音' }).focus()
  await page.keyboard.press('Enter')
  const confirmation = page.getByRole('alertdialog', { name: '解除抖音绑定？' })
  await confirmation.waitFor()
  await confirmation.getByRole('button', { name: '取消' }).evaluate(element => element.focus())
  await page.waitForTimeout(250)
  await page.screenshot({ path: output + '/account-confirm.png' })
  await page.keyboard.press('Escape')
  await confirmation.waitFor({ state: 'hidden' })
  assert.equal(requests.some(item => item.body.operation === 'unlink'), false)
  await page.screenshot({ path: output + '/account-connections.png' })
  await page.getByRole('button', { name: '解绑抖音' }).click()
  await confirmation.getByRole('button', { name: '解绑', exact: true }).click()
  await page.getByText('已解绑抖音。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '绑定B 站', exact: true }).click()
  await page.getByText('绑定成功。', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.location.search), '')

  await page.goto(base + '/#/pages/map/index', { waitUntil: 'domcontentloaded' })
  const mapSearch = page.locator('input[name="map-search"]')
  await page.waitForFunction(() => document.querySelector('input[name="map-search"]')?.value === '北太子湖', null, {
    timeout: 25000
  })
  assert.equal(await page.getByText('已定位到北太子湖', { exact: true }).count(), 0)
  assert.equal(await page.locator('.map-search-stack .map-water-credit').count(), 0)
  const credit = await page.getByRole('link', { name: '© OpenStreetMap' }).boundingBox()
  const mapStage = await page.locator('.map-stage').boundingBox()
  assert.ok(credit && mapStage && credit.y >= mapStage.y + mapStage.height - 60)
  await page.waitForTimeout(900)
  await page.screenshot({ path: output + '/map-nearest-water.png' })
  await page.getByRole('img', { name: '北太子湖' }).evaluate(element => {
    element.dataset.originalPin = 'true'
  })
  const canvas = page.locator('.mobile-map__canvas')
  const landPixel = await page.evaluate(() => {
    const pixel = window.discoveryMap.lngLatToContainer(new window.AMap.LngLat(114.18749, 30.51436))
    return { x: pixel.getX(), y: pixel.getY() }
  })
  await canvas.click({ position: landPixel })
  await page.locator('[data-original-pin]').waitFor({ state: 'detached' })
  await page.getByRole('img', { name: '北太子湖' }).waitFor()
  assert.equal(await mapSearch.inputValue(), '北太子湖')
  await page.evaluate(() => {
    window.fixturePoiSearches = []
    window.AMap.AutoComplete.prototype.search = (keyword, callback) => {
      window.fixturePoiSearches.push(keyword)
      const [longitude, latitude] = /新新人家|北太子湖/.test(keyword) ? [114.194, 30.508] : [139.7, 35.68]
      callback('complete', { tips: [{
        id: keyword, name: keyword, district: '验收样例城市',
        location: new window.AMap.LngLat(longitude, latitude)
      }] })
    }
  })
  await page.getByRole('img', { name: '北太子湖' }).evaluate(el => el.setAttribute('data-before-search', 'true'))
  await mapSearch.fill('新新人家')
  await page.getByRole('option', { name: /新新人家/ }).waitFor()
  await page.locator('[data-before-search]').waitFor({ state: 'detached' })
  assert.equal(await page.getByRole('img', { name: '新新人家' }).count(), 0)
  const searchesBeforeConfirmation = await page.evaluate(() => window.fixturePoiSearches.slice())
  assert.equal(searchesBeforeConfirmation.at(-1), '新新人家')
  await mapSearch.press('Enter')
  await page.waitForFunction(() => document.querySelector('input[name="map-search"]')?.value === '北太子湖')
  await page.waitForTimeout(900)
  assert.deepEqual(await page.evaluate(() => window.fixturePoiSearches), searchesBeforeConfirmation)
  await page.screenshot({ path: output + '/map-poi-nearest-water.png' })
  await page.getByRole('button', { name: '定位附近水域' }).focus()
  await mapSearch.focus()
  await page.getByRole('option', { name: /北太子湖/ }).waitFor()
  await page.screenshot({ path: output + '/map-poi-focus.png' })
  assert.deepEqual(await page.evaluate(() => window.fixturePoiSearches), [...searchesBeforeConfirmation, '北太子湖'])
  await mapSearch.press('Escape')
  await mapSearch.click()
  await page.getByRole('option', { name: /北太子湖/ }).waitFor()
  await mapSearch.fill('无收录水域的地点')
  await page.getByRole('option', { name: /无收录水域的地点/ }).waitFor()
  await mapSearch.press('Enter')
  await page.getByText('附近暂无可用的水域边界，可搜索水域名称。', { exact: true }).waitFor()
  assert.equal(await page.locator('.mobile-map__pin').count(), 0)
  reportsEnabled = true
  await page.getByRole('button', { name: '定位附近水域' }).click()
  await page.getByRole('img', { name: '北太子湖' }).waitFor()
  assert.equal(await page.getByRole('button', { name: /标记禁钓区|AI 画围栏|继续/ }).count(), 0)
  await page.getByRole('button', { name: '地图内禁钓区域' }).click()
  const zoneList = page.getByRole('dialog', { name: '地图内禁钓区域' })
  await zoneList.getByText('验收上报点', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await zoneList.waitFor({ state: 'hidden' })
  const automaticFence = page.getByRole('button', { name: /验收上报点，钓位上报/ })
  await automaticFence.waitFor()
  await page.waitForTimeout(900)
  await page.screenshot({ path: output + '/map-automatic-fence.png' })
  await automaticFence.click()
  const zoneSheet = page.getByRole('dialog', { name: '禁钓提醒' })
  await zoneSheet.getByText('钓位上报', { exact: true }).waitFor()
  await zoneSheet.getByRole('button', { name: '查看上报钓位' }).waitFor()
  await page.waitForTimeout(250)
  await page.screenshot({ path: output + '/map-automatic-fence-sheet.png' })
  assert.deepEqual(errors, [])
  console.log('PASS automatic combined leads and spot cards, source links and responsive layouts, POI refocus and snapping, automatic reported fences, browser OAuth callback')
} finally {
  await browser.close()
}
