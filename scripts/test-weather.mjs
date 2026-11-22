// Isolated UI/transport contracts. Weather/place fixtures are never written to production.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setH5TextScale } from './h5-text-scale.mjs'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5179'
const output = resolve('artifacts/weather/contract')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'zh-CN' })
const checks = [],
  errors = [],
  unexpected = [],
  requests = []
let edgeFail = false
await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
await context.route('**/*', async (route) => {
  const url = new URL(route.request().url())
  if (url.origin === base) return route.continue()
  if (url.origin !== 'https://jupuypvmgjpnpntfetqv.supabase.co') {
    unexpected.push(url.origin)
    return route.abort()
  }
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*'
  }
  if (route.request().method() === 'OPTIONS') return route.fulfill({ headers, status: 204 })
  if (url.pathname.includes('_write')) unexpected.push(url.pathname)
  if (url.pathname.endsWith('/functions/v1/amap')) {
    const body = route.request().postDataJSON()
    requests.push(body)
    if (body.action === 'search')
      return route.fulfill({
        headers,
        json: {
          items: [
            {
              id: 'isolated-poi',
              name: '隔离天气验收地点',
              address: '隔离样例',
              adcode: '320506',
              longitude: 120.7,
              latitude: 31.3,
              crs: 'GCJ-02'
            }
          ],
          hasMore: false
        }
      })
    if (body.action === 'weather')
      return route.fulfill({
        headers,
        status: edgeFail ? 503 : 200,
        json: edgeFail
          ? { error: 'MAP_NOT_CONFIGURED' }
          : {
              source: 'amap',
              adcode: '320506',
              city: '吴中区',
              province: '江苏省',
              weather: '多云',
              temperature: 7,
              windDirection: '西北',
              windPower: '3-4',
              humidity: 52,
              reportedAt: '2020-01-01T00:00:00.000Z'
            }
      })
    return route.fulfill({ headers, status: 503, json: { error: 'MAP_NOT_CONFIGURED' } })
  }
  return route.fulfill({ headers, json: { items: [], next: null, hasMore: false } })
})
await context.addInitScript(() => {
  localStorage.setItem(
    'dyj.auth.v1',
    JSON.stringify({
      type: 'object',
      data: {
        access_token: 'isolated-weather-fixture',
        refresh_token: 'isolated-weather-fixture',
        expires_at: Date.now() / 1000 + 3600,
        user: { id: '11111111-1111-4111-8111-111111111111' }
      }
    })
  )
  Object.defineProperty(navigator.permissions, 'query', {
    value: async () => ({ state: 'denied' })
  })
  const state = (window.weatherFixture = {
    queries: 0,
    geocodes: 0,
    gps: 0,
    mode: 'normal',
    pending: [],
    maps: []
  })
  const point = (x, y) => ({ getLng: () => x, getLat: () => y })
  class Map {
    constructor(id) {
      this.center = point(120.7, 31.3)
      this.events = {}
      this.root = document.getElementById(id)
      this.root.textContent = '隔离交互测试占位，不是真实地图'
      state.maps.push(this)
    }
    on(name, callback) {
      ;(this.events[name] ||= []).push(callback)
    }
    emit(name) {
      for (const callback of this.events[name] || []) callback({ lnglat: this.center })
    }
    getCenter() {
      return this.center
    }
    getBounds() {
      return {
        getSouthWest: () => point(this.center.getLng() - 0.02, this.center.getLat() - 0.02),
        getNorthEast: () => point(this.center.getLng() + 0.02, this.center.getLat() + 0.02)
      }
    }
    setCenter([x, y]) {
      this.center = point(x, y)
      this.emit('moveend')
    }
    setZoom() {
      this.emit('zoomend')
    }
    add() {}
    remove() {}
    destroy() {
      this.root.textContent = ''
    }
  }
  window.AMap = {
    Map,
    Marker: class {
      on() {}
      setPosition() {}
    },
    Circle: class {
      on() {}
    },
    plugin(_name, callback) {
      callback()
    },
    Geocoder: class {
      getAddress([x], callback) {
        state.geocodes++
        callback('complete', {
          regeocode: {
            formattedAddress: '隔离样例地址',
            addressComponent: { adcode: x > 120 ? '320506' : '110101' }
          }
        })
      }
    },
    Geolocation: class {
      getCurrentPosition() {
        state.gps++
      }
    },
    Weather: class {
      getLive(adcode, callback) {
        state.queries++
        const reply = () =>
          callback(state.mode === 'fail' ? 'isolated-failure' : null, {
            adcode: state.mode === 'mismatch' ? '999999' : adcode,
            city: adcode === '320506' ? '吴中区' : '东城区',
            province: '隔离样例',
            weather: '多云',
            temperature: state.mode === 'partial' ? '' : 7,
            windDirection: '西北',
            windPower: state.mode === 'partial' ? null : '3-4',
            humidity: state.mode === 'partial' ? [] : '52',
            reportTime: '2020-01-01 08:00:00'
          })
        if (state.mode === 'hold') state.pending.push(reply)
        else reply()
      }
    }
  }
})
const page = await context.newPage()
page.setDefaultTimeout(15000)
page.on('pageerror', (error) => errors.push(error.message))
const button = (name) => page.getByRole('button', { name, exact: true })
const weather = page.locator('.map-weather')
async function mode(value) {
  await page.evaluate((value) => {
    window.weatherFixture.mode = value
  }, value)
}
async function pending() {
  await page.waitForFunction(() => window.weatherFixture.pending.length > 0)
}
async function resolvePending() {
  await page.evaluate(() => {
    for (const reply of window.weatherFixture.pending.splice(0)) reply()
  })
}
try {
  await page.goto(`${base}/#/pages/map/index`)
  await button('查看天气').waitFor()
  assert.equal(
    await page.evaluate(
      () =>
        window.weatherFixture.queries + window.weatherFixture.geocodes + window.weatherFixture.gps
    ),
    0
  )
  await button('查看天气').click()
  await weather.getByText('吴中区', { exact: true }).waitFor()
  await weather.getByText('7°C', { exact: true }).waitFor()
  assert.match(await weather.innerText(), /西北 · 3-4 级/)
  assert.match(await weather.innerText(), /2020-01-01 08:00（北京时间）/)
  assert.match(await weather.innerText(), /已较旧/)
  assert.equal(await page.evaluate(() => window.weatherFixture.queries), 1)
  checks.push(
    'collapsed never requests weather/GPS; explicit query shows provider region, measurements, publication and stale warning'
  )
  await mode('fail')
  await button('刷新天气').click()
  await weather.getByText('天气未能更新', { exact: true }).waitFor()
  assert.match(await weather.innerText(), /不是本次更新/)
  assert.equal(await weather.getByText('7°C', { exact: true }).count(), 1)
  await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true })
  await mode('partial')
  await weather.getByRole('button', { name: '重试', exact: true }).click()
  await weather.getByText('气温暂无', { exact: true }).waitFor()
  assert.match(await weather.innerText(), /风力暂无/)
  assert.match(await weather.innerText(), /湿度暂无/)
  checks.push(
    'failure retains explicitly labelled last result; retry; missing measurements never become zero'
  )
  await mode('hold')
  await button('刷新天气').click()
  await pending()
  assert.equal(await button('刷新天气').isDisabled(), true)
  await page.evaluate(() => window.weatherFixture.maps.at(-1).setCenter([116.4, 39.9]))
  await button('查看天气').waitFor()
  await mode('normal')
  await resolvePending()
  assert.equal(await page.locator('.weather-details').count(), 0)
  await button('查看天气').click()
  await weather.getByText('东城区', { exact: true }).waitFor()
  assert.equal(await weather.getByText('吴中区', { exact: true }).count(), 0)
  checks.push(
    'single-flight refresh; changing region collapses and clears old data; late result cannot overwrite new region'
  )
  await mode('hold')
  await button('刷新天气').click()
  await pending()
  await button('收起天气').click()
  await mode('normal')
  await resolvePending()
  assert.equal(await page.locator('.weather-details').count(), 0)
  await button('查看天气').click()
  await weather.getByText('东城区', { exact: true }).waitFor()
  checks.push('collapse cancels result acceptance without forcing navigation')
  for (const [name, width, height, dark, scale] of [
    ['375', 375, 812, false, 1],
    ['320-dark-large', 320, 812, true, 1.5],
    ['440', 440, 956, false, 1],
    ['landscape', 812, 375, false, 1],
    ['wide', 1280, 900, false, 1]
  ]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' })
    await setH5TextScale(page, 16 * scale)
    await weather.scrollIntoViewIfNeeded()
    await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true })
    const measured = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
      font: parseFloat(getComputedStyle(document.querySelector('.weather-facts')).fontSize)
    }))
    assert.ok(measured.width <= measured.viewport + 1, `${name}: no overflow`)
    if (scale > 1)
      assert.ok(measured.font >= 23.9, 'actual large weather text, not the Uni outer body')
    for (const text of await weather
      .locator('.weather-region, .weather-temperature, .weather-time')
      .all()) {
      const box = await text.boundingBox()
      assert.ok(box && box.width <= width && box.x >= 0, `${name}: weather label fits`)
    }
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await setH5TextScale(page, 16)
  for (const skin of ['lake', 'ocean', 'stone']) {
    await page.evaluate(async (skin) => {
      const { useAppearanceStore } = await import('/src/stores/appearance.ts')
      useAppearanceStore().select(skin)
    }, skin)
    for (const dark of [false, true]) {
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
      await weather.scrollIntoViewIfNeeded()
      await weather.screenshot({
        path: resolve(output, `skin-${skin}-${dark ? 'dark' : 'light'}.png`)
      })
    }
  }
  await button('收起天气').focus()
  await page.keyboard.press('Enter')
  await button('查看天气').waitFor()
  assert.equal(await button('查看天气').getAttribute('aria-expanded'), 'false')
  await page.keyboard.press('Space')
  await button('收起天气').waitFor()
  checks.push(
    '375/320-dark-150%-font/440/landscape/wide, reduced motion, accessible disclosure and keyboard checked'
  )
  await mode('hold')
  await button('刷新天气').click()
  await pending()
  await page.evaluate(() => uni.navigateTo({ url: '/pages/settings/index' }))
  await page.waitForURL('**/pages/settings/index')
  await page.getByText('主题皮肤', { exact: true }).waitFor()
  await mode('normal')
  await resolvePending()
  await page.evaluate(() => uni.navigateBack())
  await button('查看天气').waitFor()
  assert.equal(await page.locator('.weather-details').count(), 0)
  await mode('mismatch')
  await button('查看天气').click()
  await weather.getByText('天气未能更新', { exact: true }).waitFor()
  assert.equal(await page.locator('.weather-temperature').count(), 0)
  checks.push(
    'page hide clears state and rejects late replies; mismatched provider region rejected'
  )
  await mode('normal')
  await weather.getByRole('button', { name: '重试', exact: true }).click()
  await weather.getByText('东城区', { exact: true }).waitFor()
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/auth.ts')
    await useAuthStore().signOut()
  })
  await button('查看天气').waitFor()
  assert.equal(await page.locator('.weather-details').count(), 0)
  checks.push('account context change clears result and private map center')
  // Fresh fixture browser session for the authenticated personal-miniapp transport contract.
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => uni.navigateTo({ url: '/pages/map/search' }))
  await page.waitForURL('**/pages/map/search')
  await page.locator('input[aria-label="搜索高德地点"]').fill('隔离天气验收')
  await page.getByRole('option').first().click()
  await button('查看天气').click()
  await weather.getByText('吴中区', { exact: true }).waitFor()
  const query = requests.find((x) => x.action === 'weather')
  assert.deepEqual(query, { action: 'weather', adcode: '320506' })
  edgeFail = true
  await button('刷新天气').click()
  await weather.getByText('天气未能更新', { exact: true }).waitFor()
  assert.match(await weather.innerText(), /上方保留的是上次结果/)
  assert.ok(!(await weather.innerText()).includes('Key'))
  checks.push(
    'personal-miniapp transport sends region only with session; missing Web key is failure, not fake weather'
  )
  assert.equal(await page.evaluate(() => window.weatherFixture.gps), 0)
  assert.deepEqual(unexpected, [])
  assert.deepEqual(errors, [])
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(
      {
        passed: true,
        evidence: 'isolated UI/transport fixtures, not real provider or miniapp device',
        checks
      },
      null,
      2
    )
  )
  console.log(JSON.stringify({ passed: checks.length, output }))
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure-current.png'), fullPage: true })
  console.log(
    JSON.stringify({
      currentRoute: new URL(page.url()).hash,
      fixturePageText: (await page.locator('body').innerText()).slice(-2400),
      errors
    })
  )
  throw error
} finally {
  await browser.close()
}
