// Isolated public feed and location callbacks: UI evidence, no hosted writes or device GPS.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { setH5TextScale } from './h5-text-scale.mjs'

const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname))
const output = 'artifacts/feed-city-row'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'zh-CN', reducedMotion: 'reduce' })
const errors = [], escaped = [], feeds = [], checks = [], metrics = []
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'granted' }) } })
  class Geolocation { getCurrentPosition(callback) { callback('complete', { position: { getLng: () => 114.3, getLat: () => 30.6 }, location_type: 'html5', accuracy: 20 }) } }
  class Geocoder { getAddress(point, callback) { callback('complete', { regeocode: { addressComponent: { province: '湖北省', city: '武汉市', district: '江汉区' } } }) } }
  window.AMap = { Geolocation, Geocoder }
})
await context.routeWebSocket(/supabase\.co/, socket => socket.close())
await context.route('**/*', route => {
  const request = route.request(), url = new URL(request.url())
  if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
  if (url.origin !== 'https://tlfmfokyhahlpzmpliad.supabase.co') { escaped.push(url.origin); return route.abort() }
  const reply = json => route.fulfill({ json, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
  if (request.method() === 'OPTIONS') return reply({})
  if (url.pathname.endsWith('fishing_read')) { const body = request.postDataJSON(); if (body.action === 'feed') feeds.push(body.payload); return reply({ items: [], next: null }) }
  if (url.pathname.endsWith('fishing_moderation')) return reply({ allowed: false })
  escaped.push(url.pathname); return route.abort()
})
const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))
const pass = message => { checks.push(message); console.log('PASS', message) }
try {
  await page.goto(`${base}/#/pages/home/index`)
  await page.getByRole('button', { name: '同城', exact: true }).click()
  const trigger = page.getByRole('button', { name: '切换同城城市', exact: true })
  await trigger.getByText('武汉市', { exact: true }).waitFor()
  const views = [['375',375,812,false,16],['320',320,740,false,16],['440',440,956,false,16],['landscape',844,390,false,16],['wide',1280,900,false,16],['dark-large',320,812,true,32]]
  for (const [name,width,height,dark,scale] of views) {
    await page.setViewportSize({ width, height }); await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' }); await setH5TextScale(page, scale)
    const measure = await page.evaluate(() => {
      const button = document.getElementById('feed-city'), row = document.querySelector('.feed-city__row'), hint = document.querySelector('.feed-city__hint')
      const buttonBox = button.getBoundingClientRect(), rowBox = row.getBoundingClientRect(), hintBox = hint.getBoundingClientRect(), style = getComputedStyle(button)
      return { button: buttonBox.toJSON(), row: rowBox.toJSON(), hint: hintBox.toJSON(), background: style.backgroundColor, border: style.borderColor, overflow: document.documentElement.scrollWidth > innerWidth + 1 }
    })
    assert.ok(measure.button.height >= 48, `${name}: touch target is at least 48px`)
    assert.equal(measure.background, 'rgba(0, 0, 0, 0)', `${name}: trigger has no solid panel`)
    assert.equal(measure.border, 'rgba(0, 0, 0, 0)', `${name}: trigger has no outline box at rest`)
    assert.equal(measure.overflow, false, `${name}: page fits horizontally`)
    assert.ok(measure.hint.right <= width + 1 && measure.row.right <= width + 1)
    if (scale === 16) {
      assert.ok(Math.abs((measure.button.y + measure.button.height / 2) - (measure.hint.y + measure.hint.height / 2)) < 2, `${name}: city and description share the row`)
      assert.ok(measure.hint.x >= measure.button.right, `${name}: description is beside city`)
      assert.ok(measure.row.height <= 50, `${name}: row stays compact`)
    }
    metrics.push({ name, ...measure })
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true })
  }
  pass('borderless city action and adjacent explanation fit six layouts, including 200% dark text')
  await page.setViewportSize({ width: 375, height: 812 }); await page.emulateMedia({ colorScheme: 'light' }); await setH5TextScale(page, 16)
  await trigger.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab')
  assert.equal(await trigger.evaluate(node => node === document.activeElement), true)
  assert.equal(await trigger.evaluate(node => getComputedStyle(node).outlineStyle), 'solid')
  await page.screenshot({ path: `${output}/focus.png`, fullPage: true })
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '切换同城城市', exact: true })
  await dialog.waitFor()
  await dialog.locator('input[aria-label="搜索城市"]').fill('杭州市')
  await dialog.getByRole('button', { name: '选择杭州市', exact: true }).click()
  await trigger.getByText('杭州市', { exact: true }).waitFor()
  assert.ok(feeds.some(input => input.filter === 'city' && input.city === '杭州市'))
  pass('keyboard focus opens the existing city picker and selection still filters the feed')
  await trigger.click({ position: { x: 8, y: 24 } })
  await dialog.waitFor()
  await page.screenshot({ path: `${output}/picker.png` })
  await page.getByRole('button', { name: '关闭城市选择', exact: true }).click()
  pass('location icon area activates the same full city action')
  await trigger.click(); await dialog.waitFor()
  await dialog.locator('input[aria-label="搜索城市"]').fill('巴音郭楞蒙古自治州')
  await dialog.getByRole('button', { name: '选择巴音郭楞蒙古自治州', exact: true }).click()
  await page.setViewportSize({ width: 320, height: 812 }); await page.emulateMedia({ colorScheme: 'dark' }); await setH5TextScale(page, 32)
  await trigger.getByText('巴音郭楞蒙古自治州', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
  await page.screenshot({ path: `${output}/long-city-dark-large.png`, fullPage: true })
  pass('long city names wrap within the same accessible action at 200% text')
  assert.deepEqual(errors, []); assert.deepEqual(escaped, [])
  await writeFile(`${output}/result.json`, JSON.stringify({ checks, metrics, errors, escaped, boundary: 'Isolated feed and location callbacks; no device GPS or hosted writes.' }, null, 2))
} finally { await browser.close() }
