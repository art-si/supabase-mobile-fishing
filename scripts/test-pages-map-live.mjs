// Real AMap and public backend reads. Only browser GPS is a fixed test location.
// --local serves docs at its real localhost origin and repository path; it never
// substitutes SDK, tiles, map responses, authentication or business data.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { createDocsServer } from './preview-docs.mjs'
import { setH5TextScale } from './h5-text-scale.mjs'

const local = process.argv.includes('--local')
const output = resolve(process.env.UI_OUTPUT_DIR || `artifacts/pages-map-live/${local ? 'local' : 'github'}`)
mkdirSync(output, { recursive: true })
const server = local ? createDocsServer({directory: process.env.FISHING_DOCS_DIR}) : undefined
if (server) await new Promise((done, fail) => server.once('error',fail).listen(0, '127.0.0.1', done))
const site = local ? 'http://localhost:5178/supabase-mobile-fishing/' : 'https://art-si.github.io/supabase-mobile-fishing/'
const proxy = new URL('/_AMapService', site).href
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: server ? [`--host-resolver-rules=MAP localhost:5178 127.0.0.1:${server.address().port}`] : [] })
const context = await browser.newContext({
  viewport: { width: 375, height: 812 }, locale: 'zh-CN', colorScheme: 'light',
  reducedMotion: 'reduce', permissions: ['geolocation'],
  geolocation: { longitude: 120.69, latitude: 31.31, accuracy: 20 }
})
await context.addInitScript(() => {
  let provider
  Object.defineProperty(window, 'AMap', {
    configurable: true,
    get() {
      if (provider?.Map && !provider.Map.__pagesCaptured) {
        provider.Map = new Proxy(provider.Map, {
          construct(Target, args) {
            const map = Reflect.construct(Target, args)
            window.__pagesMap = map
            map.on('complete', () => { window.__pagesMapComplete = true })
            if (new URL(location.href).searchParams.has('qa-late-complete')) {
              const on = map.on.bind(map), queued = []
              let released = false
              map.on = (event, handler, ...rest) => on(event, event !== 'complete' ? handler : function (...args) {
                if (released) return handler.apply(this, args)
                queued.push(() => handler.apply(this, args))
              }, ...rest)
              window.__releaseMapComplete = () => { released = true; queued.splice(0).forEach(deliver => deliver()) }
            }
            return map
          }
        })
        provider.Map.__pagesCaptured = true
      }
      return provider
    },
    set(value) { provider = value }
  })
})
const writes = [], errors = [], responses = [], failed = []
await context.route(/\/fishing_(?:write|zones_write|moderation)(?:\?|$)/, route => {
  writes.push(new URL(route.request().url()).pathname)
  return route.abort()
})
const page = await context.newPage()
page.on('dialog',async dialog=>{errors.push(`Unexpected native ${dialog.type()}: ${dialog.message().slice(0,120)}`);await dialog.dismiss()})
page.setDefaultTimeout(45000)
page.on('pageerror', (error) => errors.push(error.message.replace(/https?:\/\/\S+/g, '[URL]')))
context.on('response', (response) => {
  const url = new URL(response.url())
  if (url.pathname.includes('_AMapService') || /(?:jsapi-data\d+|webrd\d+)\.amap\.com/.test(url.hostname))
    responses.push({ host: url.hostname, path: url.pathname, status: response.status() })
})
page.on('requestfailed', (request) => {
  const url = new URL(request.url())
  if (request.url().startsWith(site) || url.pathname.includes('_AMapService'))
    failed.push({ path: url.pathname, error: request.failure()?.errorText })
})
async function ready() {
  await page.waitForFunction(() => window.__pagesMap?.getCenter && document.querySelector('.amap-layer') && !document.querySelector('.mobile-map__loading'))
  assert.equal(await page.locator('.map-unavailable').count(), 0)
  assert.equal(await page.evaluate(() => window._AMapSecurityConfig.serviceHost), proxy)
  assert.equal(await page.evaluate(() => Boolean(window._AMapSecurityConfig.securityJsCode)), false)
}
async function capture(name) {
  await page.evaluate(async () => { await document.fonts.ready })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: overflow`)
  await page.screenshot({ path: resolve(output, `${name}.png`) })
}
let searchCount = 0
let gestureState
let delayedCompletionRecovered = false
let passed = false
try {
  await page.goto(`${site}#/pages/map/index`, { waitUntil: 'domcontentloaded' })
  await ready()
  await page.waitForFunction(() => document.querySelectorAll('.amap-container canvas').length > 0)
  await page.waitForFunction(() => window.__pagesMap.getZoom() >= 13)
  await page.waitForTimeout(1600)
  await capture('water-map-375')
  console.log('PASS real basemap rendered from local/static Pages assets')
  // Actual pointer gestures, with the real map instance observed only for assertions.
  const before = await page.evaluate(() => ({ zoom: window.__pagesMap.getZoom(), lng: window.__pagesMap.getCenter().getLng() }))
  const bounds = await page.locator('.amap-container').first().boundingBox()
  gestureState = { before, bounds, hit: await page.evaluate(({x,y}) => ({node:document.elementFromPoint(x,y)?.className,status:window.__pagesMap.getStatus()}), {x:bounds.x+bounds.width*0.65,y:bounds.y+bounds.height*0.55}) }
  await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.55)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.6, { steps: 15 })
  await page.mouse.up()
  await page.waitForFunction((lng) => Math.abs(window.__pagesMap.getCenter().getLng() - lng) > 0.00001, before.lng)
  console.log('PASS map pointer drag')
  await page.mouse.dblclick(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.4)
  await page.waitForFunction((zoom) => window.__pagesMap.getZoom() !== zoom, before.zoom)
  console.log('PASS map double-click zoom')
  for (const [name, width, height, dark, textSize] of [
    ['320', 320, 740, false, 16], ['440', 440, 956, false, 16],
    ['landscape', 844, 390, false, 16], ['wide', 1280, 900, false, 16],
    ['dark-large', 320, 812, true, 28]
  ]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
    await setH5TextScale(page, textSize)
    await page.waitForTimeout(400)
    await capture(`water-map-${name}`)
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'light' })
  await setH5TextScale(page, 16)
  // Uni reuses a page for same-path hash navigation; start a new document so
  // the pick-mode query is read by onLoad just as it is on a fresh deep link.
  await page.goto('about:blank')
  await page.goto(`${site}#/pages/map/index?pick=1&requestId=pages-readonly-map-check`, { waitUntil: 'domcontentloaded' })
  const input = page.locator('input[aria-label="搜索高德地点"]')
  await input.waitFor({ state: 'visible' })
  await ready()
  await input.fill('苏州金鸡湖')
  await page.getByRole('option').first().waitFor({ state: 'visible' })
  console.log('PASS real AMap autocomplete')
  searchCount = await page.getByRole('option').count()
  await capture('place-search-375')
  const previousOptions = await page.getByRole('option').evaluateAll(items => items.map(item => item.textContent).join('\n'))
  await page.getByRole('option').first().click()
  const confirm = page.getByRole('button', { name: '确认这个位置', exact: true })
  await page.waitForFunction(previous => {
    if (document.querySelector('.map-selection .name')) return true
    const choices = [...document.querySelectorAll('[role="option"]')]
    return choices.length && choices.map(item => item.textContent).join('\n') !== previous
  }, previousOptions)
  if (!(await confirm.isVisible())) {
    await page.getByRole('option').first().click()
  }
  await page.waitForFunction(() => {
    const name = document.querySelector('.map-selection .name')?.textContent
    return name && name !== '已选位置'
  })
  assert.ok(await confirm.isEnabled())
  await confirm.focus()
  await page.waitForTimeout(1200)
  await capture('selected-place-375')
  for (const [name, width, height, scale] of [['dark-large', 320, 740, 32], ['landscape', 844, 390, 20]]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: name === 'dark-large' ? 'dark' : 'light' })
    await setH5TextScale(page, scale)
    await confirm.focus()
    for (const control of [confirm, input, page.getByRole('button', { name: '地图内禁钓区域', exact: true })]) {
      assert.ok(await control.evaluate(node => {
        const rect = node.getBoundingClientRect()
        const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        return rect.top >= 0 && rect.bottom <= innerHeight + 1 && node.contains(target)
      }), `${name}: the selection must not cover search, confirm or the map controls`)
    }
    await capture(`selected-place-${name}`)
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'light' })
  await setH5TextScale(page, 16)
  const originalName = await page.locator('.map-selection .name').innerText()
  const geocoded = context.waitForEvent('response', { predicate: response =>
    new URL(response.url()).pathname.endsWith('/v3/geocode/regeo') && response.status() === 200, timeout: 45000 })
  await page.locator('.mobile-map__canvas').click({ position: { x: 145, y: 170 } })
  await geocoded
  await page.waitForFunction(previous => {
    const name = document.querySelector('.map-selection .name')?.textContent
    return name && name !== previous && name !== '已选位置' &&
      [...document.querySelectorAll('.amap-marker [aria-label]')].some(pin => pin.getAttribute('aria-label') === name)
  }, originalName)
  await capture('manual-place-375')
  console.log('PASS manual selection and real reverse geocoding')
  // A deep-link refresh must also initialize the real SDK and proxy.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await ready()
  if (local && process.argv.includes('--late-complete')) {
    await page.goto(`${site}?qa-late-complete#/pages/map/index`, { waitUntil: 'domcontentloaded' })
    const unavailable = page.getByText('地图暂时未能加载', { exact: true })
    await unavailable.waitFor()
    assert.equal(await page.locator('.mobile-map__canvas').evaluate(canvas => getComputedStyle(canvas).opacity), '0')
    await capture('delayed-complete-error-375')
    await page.waitForFunction(() => window.__pagesMapComplete)
    await page.evaluate(() => window.__releaseMapComplete())
    await unavailable.waitFor({ state: 'hidden' })
    await ready()
    assert.ok(await page.locator('input[aria-label="搜索高德地点"]').isEnabled())
    await page.getByRole('button', { name: '地图内禁钓区域', exact: true }).waitFor()
    await capture('delayed-complete-recovered-375')
    delayedCompletionRecovered = true
    console.log('PASS delayed provider completion restores the same map without manual reload (controlled event timing)')
  }
  assert.ok(responses.some((r) => /jsapi-data\d+\.amap\.com/.test(r.host) && r.status === 200), 'real basemap data missing')
  assert.ok(responses.some((r) => r.path.endsWith('/v3/assistant/inputtips') && r.status === 200))
  assert.ok(responses.some((r) => r.path.endsWith('/v3/geocode/regeo') && r.status === 200))
  assert.ok(responses.filter((r) => r.path.includes('_AMapService')).every((r) => r.status === 200))
  assert.deepEqual(errors, [])
  assert.deepEqual(writes, [])
  assert.ok(failed.every((r) => r.error === 'net::ERR_ABORTED'))
  passed = true
  console.log(JSON.stringify({ passed: true, source: local ? 'local-docs-at-repository-path' : 'github-pages', searchCount, proxy, output }))
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failed.png') }).catch(() => {})
  console.error(String(error.message).replace(/https?:\/\/\S+/g, '[URL]').slice(0, 700))
  console.log(JSON.stringify({ messages: (await page.locator('body').innerText()).slice(0, 500), gestureState, state: await page.evaluate(() => ({map:!!window.__pagesMap, zoom:window.__pagesMap?.getZoom(),lng:window.__pagesMap?.getCenter()?.getLng(), complete:window.__pagesMapComplete, layers:document.querySelectorAll('.amap-layer').length, canvases:document.querySelectorAll('.amap-container canvas').length})), errors, failed }))
  process.exitCode = 1
} finally {
  writeFileSync(resolve(output, 'result.json'), JSON.stringify({ passed, local, searchCount, delayedCompletionRecovered, responses, errors, writes, failed }, null, 2))
  await browser.close()
  if (server) await new Promise((done) => server.close(done))
}
