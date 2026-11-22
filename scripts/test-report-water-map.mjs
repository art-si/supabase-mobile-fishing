// Real AMap renderer and Wuhan shorelines; isolated GPS, POI, geocoder, session and report writes.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { setH5TextScale } from './h5-text-scale.mjs'

const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname))
const output = 'artifacts/report-water-map'
await mkdir(output, { recursive: true })
const owner = '11111111-1111-4111-8111-111111111111'
const shore = [114.18749, 30.51436]
const inside = [114.191333, 30.516943]
const unnamedWater = [114.192305, 30.505867]
const dongjingRiver = [114.151786, 30.445221]
const waterLabel = '具体水域与位置'
const coordinateText = ([lng, lat]) => `经度 ${lng.toFixed(6)}，纬度 ${lat.toFixed(6)}`
const browser = await chromium.launch({ channel: 'chrome' })
const errors = []

async function verify(staticOnly) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 }, locale: 'zh-CN', reducedMotion: 'reduce',
    permissions: ['geolocation'], geolocation: { longitude: 114.1885, latitude: 30.5128, accuracy: 15 }
  })
  await context.addInitScript(owner => {
    localStorage.setItem('dyj.auth.v1', JSON.stringify({ type: 'object', data: {
      access_token: 'isolated-water-picker', refresh_token: 'fixture',
      expires_at: Date.now() / 1000 + 3600, user: { id: owner }
    } }))
    let sdk
    Object.defineProperty(window, 'AMap', {
      configurable: true, set(value) { sdk = value }, get() {
        if (sdk?.Map && !sdk.Map.reportCaptured) {
          sdk.Map = new Proxy(sdk.Map, { construct(Map, args) {
            const map = window.reportMap = Reflect.construct(Map, args)
            map.on('click', event => { window.reportTap = [event.lnglat.getLng(), event.lnglat.getLat()] })
            return map
          } })
          sdk.Map.reportCaptured = true
        }
        if (sdk?.Marker && !sdk.Marker.reportCaptured) {
          sdk.Marker = new Proxy(sdk.Marker, { construct(Marker, args) {
            const marker = Reflect.construct(Marker, args)
            if (args[0]?.content?.classList?.contains('mobile-map__pin')) {
              window.reportPin = { point: [...args[0].position], name: args[0].title, marker }
            }
            return marker
          } })
          sdk.Marker.reportCaptured = true
        }
        if (sdk?.Geocoder && !sdk.Geocoder.reportCaptured) {
          sdk.Geocoder.prototype.getAddress = (point, callback) => {
            window.reportGeocodePoint = [...point]
            callback('complete', { regeocode: { formattedAddress: '验收用岸上街道',
              addressComponent: { province: '湖北省', city: '武汉市', district: '汉阳区', adcode: '420105' } } })
          }
          sdk.Geocoder.reportCaptured = true
        }
        return sdk
      }
    })
  }, owner)
  if (staticOnly) await context.route('https://webapi.amap.com/maps**', route => route.abort())
  await context.routeWebSocket(/supabase\.co/, socket => socket.close())
  const writes = [], previews = []
  let failNextUnnamedLookup = staticOnly
  await context.route('https://*.supabase.co/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path.includes('/amap-js/')) return route.continue()
    const reply = (json, status = 200) => route.fulfill({ json, status, headers: {
      'access-control-allow-origin': '*', 'access-control-allow-headers': '*'
    } })
    if (request.method() === 'OPTIONS') return reply({})
    if (path === '/auth/v1/user') return reply({ id: owner })
    const body = request.postDataJSON() || {}
    if (path.endsWith('/amap') && body.action === 'search') {
      const [longitude, latitude] = body.query === '无岸线样本' ? [131.036, -25.34] :
        body.query === '无名河段旁的道路' ? unnamedWater : body.query === '四环线附近的地标' ? dongjingRiver : shore
      return reply({ items: [{ id: 'land', name: body.query, address: '岸上地标', longitude, latitude, crs: 'GCJ-02' }], hasMore: false })
    }
    if (path.endsWith('/amap') && body.action === 'water-places') {
      if (failNextUnnamedLookup && Math.abs(body.longitude - unnamedWater[0]) < .0001 &&
          Math.abs(body.latitude - unnamedWater[1]) < .0001) {
        failNextUnnamedLookup = false
        return reply({ error: 'MAP_SERVICE_UNAVAILABLE' }, 503)
      }
      const atRiver = Math.abs(body.longitude - dongjingRiver[0]) < .001 && Math.abs(body.latitude - dongjingRiver[1]) < .001
      return reply({items: atRiver ? [{ name: '东荆河', point: dongjingRiver, flowing: true }] : []})
    }
    if (path.endsWith('/amap') && body.action === 'preview') {
      previews.push([body.longitude, body.latitude])
      return reply({ error: 'MAP_SERVICE_UNAVAILABLE' }, 503)
    }
    if (path.endsWith('/amap') && body.action === 'region') {
      return reply({ province: '湖北省', city: '武汉市', district: '汉阳区', adcode: '420105', citycode: '027' })
    }
    if (path.endsWith('/fishing_write')) {
      writes.push(body)
      return reply({ ...body.payload, media: [], status: 'saved', crs: 'GCJ-02' })
    }
    return reply({ items: [], next: null })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(25000)
  page.on('pageerror', cause => errors.push(cause.message))
  const button = name => page.getByRole('button', { name, exact: true })
  const location = page.getByRole('textbox', { name: waterLabel, exact: true })
  const confirm = button('确认这处水域')
  const draft = () => page.evaluate(owner =>
    JSON.parse(localStorage.getItem(`dyj.live.draft.${owner}.water-report`)).data, owner)
  async function tapAt(point) {
    const center = [point[0] - .0008, point[1] + .0005]
    await page.evaluate(center => {
      window.reportTap = null
      window.reportMap.setZoomAndCenter(16, center, true)
    }, center)
    await page.waitForFunction(([lng, lat]) => {
      const current = window.reportMap.getCenter()
      return window.reportMap.getZoom() === 16 && Math.abs(current.getLng() - lng) < .00002 &&
        Math.abs(current.getLat() - lat) < .00002
    }, center)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const pixel = await page.evaluate(point => {
      const p = window.reportMap.lngLatToContainer(new window.AMap.LngLat(...point))
      return { x: p.getX(), y: p.getY() }
    }, point)
    await page.locator('.mobile-map__canvas').click({ position: pixel })
    await page.waitForFunction(([lng, lat]) => window.reportTap &&
      Math.abs(window.reportTap[0] - lng) < .00003 && Math.abs(window.reportTap[1] - lat) < .00003, point)
  }
  try {
    await page.goto(base + '/#/pages/water-report/index?tabbed=1')
    await location.waitFor()
    await page.getByRole('textbox', { name: '现场情况' }).fill('仅作隔离验收的现场情况。')
    assert.equal(await location.inputValue(), '')
    await button('水域地图选点').click()
    await page.waitForURL(/map\/index.*context=water/)
    let expected, name
    if (staticOnly) {
      await button('改用地点搜索与静态预览').click()
      await page.waitForURL(/map\/search.*context=water/)
      const search = page.locator('input[name="static-map-search"]')
      for (const query of ['无岸线样本', '验收用岸上地标']) {
        await search.fill(query)
        await page.getByRole('option', { name: new RegExp(query) }).first().click()
        if (query === '无岸线样本') {
          await page.getByText(/附近暂无已收录的水域/).waitFor()
          assert.ok(await confirm.isDisabled())
          assert.equal(previews.length, 0)
        }
      }
      await page.waitForFunction(() => document.body.innerText.includes('经度 '))
      const label = await page.getByRole('status').filter({ hasText: '北太子湖' }).innerText()
      name = label.trim()
      await page.getByText('静态地图暂不可用', { exact: true }).waitFor()
      expected = previews.at(-1)
    } else {
      await page.waitForFunction(() => !!window.reportMap && document.querySelector('input[name="map-search"]:enabled'))
      await tapAt(shore)
      await page.waitForFunction(() => window.reportPin?.name === '北太子湖' &&
        Math.abs(window.reportPin.point[0] - 114.18749) < .0005)
      const pin = await page.evaluate(() => {
        const { point, name, marker } = window.reportPin
        const position = marker.getPosition()
        const insideWater = window.reportMap.getAllOverlays('polygon').some(p => p.contains(position))
        return { point, name, rendered: [position.getLng(), position.getLat()], insideWater }
      })
      expected = pin.point
      name = pin.name
      assert.ok(pin.insideWater)
      assert.ok(pin.rendered.every((n, i) => Math.abs(n - expected[i]) < .000001))
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
      for (const [label, width, height, dark, size] of [
        ['375', 375, 812, false, 16], ['320', 320, 740, false, 16], ['440', 440, 956, false, 16],
        ['landscape', 812, 375, false, 16], ['wide', 1280, 800, false, 16], ['dark-large', 320, 740, true, 24]
      ]) {
        await page.setViewportSize({ width, height })
        await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
        await setH5TextScale(page, size)
        await confirm.focus()
        await confirm.click({ trial: true })
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        await page.screenshot({ path: `${output}/map-${label}.png` })
      }
      await page.setViewportSize({ width: 375, height: 812 })
      await page.emulateMedia({ colorScheme: 'light' })
      await setH5TextScale(page, 16)
      await button('地图内禁钓区域').click()
      const zones = page.getByRole('dialog', { name: '地图内禁钓区域', exact: true })
      await zones.waitFor()
      await page.keyboard.press('Escape')
      await zones.waitFor({ state: 'hidden' })
    }
    assert.notDeepEqual(expected, shore)
    await page.getByText(coordinateText(expected), { exact: true }).waitFor()
    await confirm.click()
    await page.waitForURL(/water-report\/index/)
    await page.getByText('已选位置：' + coordinateText(expected), { exact: true }).waitFor()
    await page.waitForFunction(name => document.querySelector('input[name="report-place"]')?.value === name, name)
    const saved = await draft()
    assert.deepEqual([saved.longitude, saved.latitude], expected)
    if (!staticOnly) {
      assert.deepEqual(await page.evaluate(() => window.reportGeocodePoint), expected)
      assert.equal(saved.district, '汉阳区')
      await location.scrollIntoViewIfNeeded()
      await page.screenshot({ path: output + '/report-375.png' })
      await button('水域地图选点').click()
      await page.waitForURL(/map\/index/)
      await page.waitForFunction(() => !!window.reportMap && document.querySelector('input[name="map-search"]:enabled'))
      await tapAt(inside)
      await page.waitForFunction(([lon, lat]) => Math.abs(window.reportPin.point[0] - lon) < .00002 &&
        Math.abs(window.reportPin.point[1] - lat) < .00002, inside)
      await page.evaluate(point => {
        const nearby = window.AMap.PlaceSearch.prototype.searchNearBy
        window.AMap.PlaceSearch.prototype.searchNearBy = function (query, anchor, radius, done) {
          if (Math.abs(anchor[0] - point[0]) < .0003 && Math.abs(anchor[1] - point[1]) < .0003) return done('no_data', {})
          return nearby.call(this, query, anchor, radius, done)
        }
        const provider = window.AMap.AutoComplete.prototype
        const search = provider.search
        provider.search = function (name, done) {
          if (name !== '无名河段旁的道路') return search.call(this, name, done)
          done('complete', { tips: [{ id: 'water-report-road', name, location: new window.AMap.LngLat(...point) }] })
        }
      }, unnamedWater)
      await page.locator('input[name="map-search"]').fill('无名河段旁的道路')
      await page.getByRole('option', { name: /无名河段旁的道路/ }).click()
      // The live OSM label service can be unavailable while the local pond geometry is usable.
      await page.waitForFunction(([lng, lat]) => window.reportPin &&
        Math.abs(window.reportPin.point[0] - lng) < .00003 && Math.abs(window.reportPin.point[1] - lat) < .00003 &&
        ['未命名水域', '水域名称待确认'].includes(window.reportPin.name), unnamedWater)
      const pondLabel = await page.evaluate(() => window.reportPin.name)
      await page.getByRole('img', { name: pondLabel, exact: true }).waitFor()
      if (pondLabel === '水域名称待确认') await page.getByText('水域名称暂时无法读取，可重新点按水面。').waitFor()
      await page.waitForFunction(label => document.querySelector('input[name="map-search"]')?.value === label, pondLabel)
      await button('返回上一页').click()
      await page.waitForURL(/water-report\/index/)
      const afterCancel = await draft()
      assert.deepEqual([afterCancel.longitude, afterCancel.latitude], expected)
    } else {
      await button('水域地图选点').click()
      await button('改用地点搜索与静态预览').click()
      await page.locator('input[name="static-map-search"]').fill('无名河段旁的道路')
      await page.getByRole('option', { name: /无名河段旁的道路/ }).click()
      await page.getByText(coordinateText(unnamedWater), { exact: true }).waitFor()
      await page.getByRole('status').filter({ hasText: /^水域名称待确认$/ }).waitFor()
      await button('重新查找水域').click()
      await page.getByText('正在查找附近水域…').waitFor({ state: 'hidden' })
      const pondLabel = (await page.getByRole('status').filter({ hasText: /^(未命名水域|水域名称待确认)$/ }).innerText()).trim()
      await confirm.click()
      await page.waitForFunction(label => document.querySelector('input[name="report-place"]')?.value === label, pondLabel)
      const unnamed = await draft()
      assert.deepEqual([unnamed.longitude, unnamed.latitude], unnamedWater)
    }
    await button('水域地图选点').click()
    if (staticOnly) {
      await button('改用地点搜索与静态预览').click()
      await page.locator('input[name="static-map-search"]').fill('四环线附近的地标')
      await page.getByRole('option', { name: /四环线附近的地标/ }).click()
      await page.getByRole('status').filter({hasText: '东荆河'}).waitFor()
    } else {
      await page.waitForFunction(() => !!window.reportMap && document.querySelector('input[name="map-search"]:enabled'))
      // The renderer and tile geometry are real. Only the label provider is fixed here.
      await page.evaluate(point => {
        window.AMap.PlaceSearch.prototype.searchNearBy = (_keyword, _origin, _radius, done) =>
          done('complete', { poiList: { pois: [
            {name: '东荆河路', type: '地名地址信息;交通地名;道路名', location: new window.AMap.LngLat(...point)},
            {name: '竹林湖', type: '地名地址信息;自然地名;湖泊', location: new window.AMap.LngLat(114.158339, 30.437699)},
            {name: '东荆河', type: '地名地址信息;自然地名;河流', location: new window.AMap.LngLat(...point)}
          ]}})
      }, dongjingRiver)
      await tapAt(dongjingRiver)
      await page.getByRole('img', {name: '东荆河', exact: true}).waitFor()
      await page.waitForFunction(() => document.querySelector('input[name="map-search"]')?.value === '东荆河')
      await page.locator('.map-selection .name').filter({hasText: /^东荆河$/}).waitFor()
    }
    await confirm.click()
    await page.waitForFunction(() => document.querySelector('input[name="report-place"]')?.value === '东荆河')
    const river = await draft()
    assert.ok(Math.abs(river.longitude - dongjingRiver[0]) < .00003 && Math.abs(river.latitude - dongjingRiver[1]) < .00003)
    if (!staticOnly) {
      await button('上报').click()
      await page.getByRole('button', { name: '编辑材料' }).waitFor()
      assert.equal(writes.length, 1)
      assert.equal(writes[0].payload.location_label, '东荆河')
      assert.deepEqual([writes[0].payload.longitude, writes[0].payload.latitude], [river.longitude, river.latitude])
    }
    if (!staticOnly) {
      await page.goto(base + '/#/pages/spot/create')
      const form = page.locator('.spot-entry')
      await form.getByRole('button', { name: '更换水域', exact: true }).waitFor()
      const spotDraft = () => page.evaluate(owner =>
        JSON.parse(localStorage.getItem(`dyj.live.spot-draft.${owner}`)).data, owner)
      const automatic = await spotDraft()
      assert.ok(automatic.location_label && automatic.location_label !== '验收用岸上街道')
      await form.getByRole('button', { name: '重新定位', exact: true }).click()
      await form.getByRole('button', { name: '更换水域', exact: true }).waitFor()
      await form.locator('input[name="spot-name"]').fill('保留自定名称')
      await form.getByRole('button', { name: '更换水域', exact: true }).click()
      await page.waitForURL(/map\/index.*context=water/)
      await page.waitForFunction(() => !!window.reportMap && document.querySelector('input[name="map-search"]:enabled'))
      await tapAt(shore)
      await page.locator('.map-selection .name').filter({ hasText: /^北太子湖$/ }).waitFor()
      const point = await page.evaluate(() => window.reportPin.point)
      await confirm.click()
      await form.getByText('北太子湖', { exact: true }).waitFor()
      const saved = await spotDraft()
      assert.deepEqual([saved.longitude, saved.latitude], point)
      assert.equal(saved.location_label, '北太子湖')
      assert.equal(saved.city, '武汉市')
      assert.equal(saved.name, '保留自定名称')
      await page.screenshot({ path: output + '/spot-water-375.png' })
      await page.goto(base + '/#/pages/post/compose')
      const postLocation = page.locator('#post-location')
      await page.waitForFunction(() => document.querySelector('#post-location')?.textContent?.includes('汉阳区'))
      await postLocation.click()
      await page.waitForURL(/map\/index.*context=water/)
      await page.waitForFunction(() => !!window.reportMap && document.querySelector('input[name="map-search"]:enabled'))
      await tapAt(shore)
      await page.locator('.map-selection .name').filter({ hasText: /^北太子湖$/ }).waitFor()
      await confirm.click()
      await page.waitForFunction(() => document.querySelector('#post-location')?.textContent?.includes('北太子湖'))
      const post = await page.evaluate(owner => JSON.parse(localStorage.getItem(`dyj.live.draft.${owner}.post`)).data, owner)
      assert.deepEqual([post.location_longitude, post.location_latitude], point.map(n => Math.round(n / .02) * .02))
    } else {
      await page.goto(base + '/#/pages/spot/create')
      await page.locator('.spot-entry').getByRole('button', { name: '更换水域', exact: true }).click()
      await button('改用地点搜索与静态预览').click()
      await page.waitForURL(/map\/search.*context=water/)
      const search = page.locator('input[name="static-map-search"]')
      await search.fill('四环线附近的地标')
      await page.getByRole('option', { name: /四环线附近的地标/ }).first().click()
      await page.getByText('东荆河', { exact: true }).waitFor()
      await confirm.click()
      await page.locator('.spot-entry').getByText('东荆河', { exact: true }).waitFor()
      await page.locator('.spot-entry').getByText('武汉市', { exact: true }).waitFor()
    }
    console.log(`PASS ${staticOnly ? 'static fallback' : 'interactive map and spot entry'}: ${name} and 东荆河 verified through form confirmation`)
  } catch (cause) {
    await page.screenshot({ path: `${output}/failed-${staticOnly ? 'static' : 'map'}.png` }).catch(() => {})
    if (await location.isVisible()) {
      const { location_label, longitude, latitude } = await draft()
      console.error({ location_label, longitude, latitude, shown: await location.inputValue() })
    }
    throw cause
  } finally {
    await context.close()
  }
}

try {
  await verify(false)
  await verify(true)
  assert.deepEqual(errors, [])
} finally { await browser.close() }
