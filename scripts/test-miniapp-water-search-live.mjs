// Real, already-authenticated formal DevTools search and water lookup. Read-only:
// no account/GPS/provider fixtures, business writes, uploads or map confirmation.
// SDK input/tap delivery remains synthetic and does not establish physical-phone UX.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readBuildFiles } from './miniapp-package.mjs'
import { nativeBindings, mapScreenshot } from './miniapp-map-audit.mjs'
import { confirmedAppId, confirmedProjectUrl, isLiveConfig } from './miniapp-release-config.mjs'

const build = resolve(process.env.MINIAPP_BUILD_DIR || 'dist/build/mp-weixin')
const output = resolve(process.env.MINIAPP_SEARCH_OUTPUT || 'artifacts/mini-water-search-20261124/devtools-live')
const keyword = process.env.MINIAPP_SEARCH_KEYWORD || '新新人家'
assert.ok(keyword.trim() && keyword.length <= 80)
const miniTemplate = await readFile(resolve(build, 'pages/map/components/MiniWaterMap.wxml'), 'utf8')
assert.match(miniTemplate, /bindpreview="{{\w+}}"/, 'Build the focused/live/preview search fix before running this check')
const nativeTemplate = await readFile(resolve(build, 'pages/map/components/NativeWaterMap.wxml'), 'utf8')
assert.ok(!/<(?:canvas|image)\b[^>]*amap-water-canvas__image/.test(nativeTemplate), 'This check must not validate the old raster renderer')
const searchTemplate = await readFile(resolve(build, '_mobile-core/components/MobileSearch.wxml'), 'utf8')
const inputTag = searchTemplate.match(/<input\b[^>]*>/)?.[0], suggestionTag = searchTemplate.match(/<button\b[^>]*mobile-search__suggestion[^>]*>/)?.[0]
const bindings = { input: inputTag?.match(/bindinput="{{(\w+)}}"/)?.[1],
  suggestions: suggestionTag?.match(/wx:for="{{(\w+)}}"/)?.[1], tap: suggestionTag?.match(/bindtap="{{item\.(\w+)}}"/)?.[1], native: nativeBindings(nativeTemplate) }
assert.ok(Object.values(bindings).every(Boolean), 'The real compiled search UI bindings must be available')
const files = readBuildFiles(build)
const code = [...files.entries()].filter(([name]) => name.endsWith('.js')).map(([, bytes]) => bytes.toString())
const config = code.find(source => isLiveConfig(source))
assert.ok(config, 'This check must run against the formal live build')
assert.ok(code.some(source => source.includes(confirmedProjectUrl)))
const require = createRequire(resolve('artifacts/miniapp-tools/package.json'))
const client = await require('miniprogram-automator').connect({ wsEndpoint: process.env.WECHAT_AUTOMATOR_WS || 'ws://127.0.0.1:9440' })
await mkdir(output, { recursive: true })
const result = { checkedAt: new Date().toISOString(), keyword, checks: [], physicalPhone: false,
  boundary: 'Real formal DevTools session, WeChat native map plus AMap POIs and water sources. Input/tap are SDK UI events. Native camera is read through public MapContext methods only. No account/GPS/provider fixtures, confirmation, uploads or business writes. Structured logs omit coordinates, URLs and credentials; screenshots preserve the visible app UI.' }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const audit = () => client.evaluate(() => getApp().__waterSearchAudit.status())
async function until(predicate, description, timeout = 45000) {
  const started = Date.now()
  let last
  while (Date.now() - started < timeout) {
    last = await audit()
    if (last.blockedWrites) throw new Error('A forbidden business mutation was attempted and blocked')
    if (predicate(last)) return last
    await sleep(200)
  }
  throw new Error(`Timed out ${description}; sanitized state: ${JSON.stringify(last)}`)
}
async function progress(stage) {
  result.stage = stage
  await writeFile(resolve(output, 'progress.json'), JSON.stringify(result, null, 2) + '\n')
}
try {
  result.stage = 'verify-project'
  const identity = await client.evaluate(() => ({ platform: wx.getDeviceInfo().platform, appId: wx.getAccountInfoSync().miniProgram.appId }))
  assert.equal(identity.platform, 'devtools'); assert.equal(identity.appId, confirmedAppId)
  result.stage = 'install-read-only-observer'
  await client.evaluate(({ project, bindings }) => {
    const app = getApp(), uniApi = require('_mobile-core/app.js').index
    app.__waterSearchAudit?.restore?.()
    if (typeof uniApi.addInterceptor !== 'function' || typeof uniApi.removeInterceptor !== 'function')
      throw new Error('Read-only request observation is unavailable')
    const counts = { search: 0, shoreline: 0, waterPlaces: 0, preview: 0, blockedWrites: 0, blockedRequests: [] }
    const readActions = ['search', 'region', 'shoreline', 'water-places', 'preview', 'weather']
    const guard = { invoke(options) {
      const url = String(options.url || ''), method = String(options.method || 'GET').toUpperCase()
      if (!url.startsWith(project + '/') || ['GET', 'HEAD'].includes(method)) return
      let data
      try { data = typeof options.data === 'string' ? JSON.parse(options.data) : options.data } catch {}
      if (url.startsWith(project + '/functions/v1/amap') && method === 'POST' && readActions.includes(data?.action)) {
        const key = data.action === 'water-places' ? 'waterPlaces' : data.action
        if (key in counts) counts[key]++
        return
      }
      if (method === 'POST' && (url === project + '/rest/v1/rpc/fishing_read' ||
          (url === project + '/functions/v1/spot-discovery' && data?.operation === 'water_notices') ||
          (url === project + '/rest/v1/rpc/fishing_spot_community' && data?.action === 'summary') ||
          url === project + '/rest/v1/rpc/fishing_list_spot_leads' ||
          (url === project + '/rest/v1/rpc/fishing_zones_read' && data?.action === 'nearby') ||
          url.startsWith(project + '/storage/v1/object/sign/') ||
          (url.startsWith(project + '/auth/v1/token') && (data?.grant_type === 'refresh_token' || /[?&]grant_type=refresh_token(?:&|$)/.test(url))))) return
      counts.blockedWrites++
      const path = url.slice(project.length).split('?')[0]
      counts.blockedRequests.push({ path: path.startsWith('/rest/v1/rpc/') ? path : path.split('/').slice(0, 4).join('/'),
        action: typeof data?.action === 'string' && /^[a-z_0-9]{1,80}$/i.test(data.action) ? data.action : '[not an action request]' })
      return false
    } }
    const uploadGuard = { invoke() { counts.blockedWrites++; return false } }
    uniApi.addInterceptor('request', guard); uniApi.addInterceptor('uploadFile', uploadGuard)
    let initial
    function refs() {
      const page = getCurrentPages().slice(-1)[0], found = { page }
      function walk(vm) {
        if (!vm) return
        const name = vm.$options.__name || vm.$options.name
        if (name === 'MiniWaterMap') found.mini = vm
        if (name === 'NativeWaterMap') found.map = vm
        if (name === 'MobileSearch' && vm.$props.name === 'water-map-search') found.search = vm
        ;(vm.$children || []).forEach(walk)
      }
      walk(page?.$vm); return found
    }
    const same = (point, center) => !!point && !!center && Math.abs(point[0] - center.longitude) < 1e-8 && Math.abs(point[1] - center.latitude) < 1e-8
    async function nativeCamera(map) {
      if (!map) return { ready: false }
      const id = bindings.native.id.replace(/{{(\w+)}}/g, (_, name) => map.$scope.data[name])
      let context
      try { context = wx.createMapContext(id, map.$scope) } catch { return { ready: false } }
      const read = method => new Promise(resolve => {
        let finished = false
        const timer = setTimeout(() => finish(null), 1800)
        function finish(value) { if (!finished) { finished = true; clearTimeout(timer); resolve(value) } }
        try { context[method]({ success: finish, fail: () => finish(null) }) } catch { finish(null) }
      })
      const [center, scale] = await Promise.all([read('getCenterLocation'), read('getScale')])
      return { ready: !!center && !!scale, center, scale: scale?.scale }
    }
    app.__waterSearchAudit = {
      remember() { const { map } = refs(); initial = map && { ...map.$props.center }; return !!initial },
      input(value) {
        const { search } = refs(), method = search?.$scope.data[bindings.input]
        if (typeof search?.$scope[method] !== 'function') throw new Error('The compiled native input handler is unavailable')
        search.$scope[method]({ type: 'input', detail: { value }, target: { dataset: {} }, currentTarget: { dataset: {} } })
      },
      selectFirst() {
        const { search } = refs(), first = search?.$scope.data[bindings.suggestions]?.[0], method = first?.[bindings.tap]
        if (typeof search?.$scope[method] !== 'function') throw new Error('The compiled native suggestion tap handler is unavailable')
        search.$scope[method]({ type: 'tap', detail: {}, target: { dataset: {} }, currentTarget: { dataset: {} } })
      },
      async status() {
        const { page, mini, map, search } = refs(), p = map?.$props, s = search?.$props, native = await nativeCamera(map)
        const selected = p?.selected, water = p?.water
        const data = map?.$scope.data || {}, markers = data[bindings.native.markers] || []
        const nativeMarker = !!selected && (!!data[bindings.native.pin] || markers.some(marker => marker.id === 1 && same([Number(marker.longitude), Number(marker.latitude)], selected)))
        const auth = page?.$vm?.$pinia?._s.get('fishing-auth')
        const source = s?.modelValue || '', suggestions = s?.suggestions || []
        return { route: page?.route, signedIn: !!auth?.signedIn, componentsReady: !!mini && !!map && !!search,
          pick: !!mini?.$props.pick, waterPick: !!mini?.$props.waterPick, live: !!s?.live, autoSelectFirst: !!s?.autoSelectFirst,
          searching: s?.suggestionStatus === '正在查找地点…', suggestionStatus: s?.suggestionStatus || '',
          suggestionCount: suggestions.length, firstSuggestion: suggestions[0]?.label || '',
          firstSuggestionDescription: suggestions[0]?.description || '', displayLabel: source,
          selectionIsWater: selected?.kind === 'water', waterName: water?.name || '', waterSource: water?.source || '',
          waterGeometry: !!water?.polygon?.length || !!water?.line?.length, centerMatchesSelection: selected ? same([selected.longitude, selected.latitude], p.center) : false,
          centerChanged: !!initial && !!p && !same([initial.longitude, initial.latitude], p.center),
          pendingOperation: !!p?.operationPending, mapReady: native.ready,
          nativeScale: native.scale, nativeScaleMatches: native.scale === p?.zoom,
          nativeCenterMatchesSelection: !!selected && !!native.center && Math.abs(selected.longitude - native.center.longitude) < 0.00002 && Math.abs(selected.latitude - native.center.latitude) < 0.00002,
          nativeMarker, nativePolygonCount: data[bindings.native.polygons]?.length || 0, nativePolylineCount: data[bindings.native.polyline]?.length || 0,
          geometryOverlayMatches: (!water?.polygon?.length || !!data[bindings.native.polygons]?.length) && (!water?.line?.length || !!data[bindings.native.polyline]?.length),
          zoom: p?.zoom, width: p?.size.width, height: p?.size.height, ...counts }
      },
      async layout() {
        const { mini, search } = refs()
        const ui = wx.createSelectorQuery().in(mini.$scope)
        ui.select('.mini-water-map').boundingClientRect(); ui.select('.mini-water-map__canvas').boundingClientRect()
        const bounds = await new Promise(resolve => ui.exec(resolve))
        const query = wx.createSelectorQuery().in(search.$scope)
        query.select('.mobile-search').boundingClientRect(); query.selectAll('.mobile-search__suggestion').boundingClientRect()
        const fields = await new Promise(resolve => query.exec(resolve))
        return { map: bounds[0], canvas: bounds[1], field: fields[0], visibleSuggestionCount: fields[1].length }
      },
      restore() { uniApi.removeInterceptor('request', guard); uniApi.removeInterceptor('uploadFile', uploadGuard); delete app.__waterSearchAudit }
    }
    return true
  }, { project: confirmedProjectUrl, bindings })
  // A normal browse URL exercises H5's automatic preview mode. No pick request or confirmation is created.
  result.stage = 'open-browse-map'
  if (await client.evaluate(() => getCurrentPages().slice(-1)[0]?.route !== 'pages/map/index')) await client.callWxMethod('navigateTo', { url: '/pages/map/index' })
  const initial = await until(value => value.route === 'pages/map/index' && value.componentsReady && value.mapReady && !value.pendingOperation, 'opening the formal browse map')
  assert.equal(initial.signedIn, true, 'An existing real signed-in session is required; this test does not sign in')
  assert.equal(initial.pick, false); assert.equal(initial.waterPick, false)
  // A newly opened map can already show the automatically resolved device water.
  // Typing below must take ownership and re-enable live suggestions in either state.
  assert.equal(await client.evaluate(() => getApp().__waterSearchAudit.remember()), true)
  result.stage = 'deliver-search-input'
  const page = await client.currentPage()
  const miniNode = await page.$('pages\\/map\\/components\\/MiniWaterMap') || await page.$('mini-water-map')
  const searchNode = await miniNode?.$('_mobile-core\\/components\\/MobileSearch') || await miniNode?.$('mobile-search')
  const input = await searchNode?.$('input') || await page.getElementByXpath('//input[contains(@class,"mobile-search__field")]')
  if (input && typeof input.input === 'function') { await input.input(keyword); result.inputDelivery = 'SDK native InputElement.input' }
  else {
    await client.evaluate(value => getApp().__waterSearchAudit.input(value), keyword)
    result.inputDelivery = 'compiled native bindinput UI handler (SDK cannot resolve the input node)'
  }
  result.suggestions = await until(value => !value.searching && value.suggestionCount > 0 && value.search > initial.search, 'waiting for real place suggestions')
  result.checks.push('Native input UI boundary dispatched search; authenticated AMap suggestions returned')
  await mapScreenshot(client, resolve(output, 'search-suggestions.png'))
  await progress('real-suggestions')
  result.preview = await until(value => value.suggestionCount > 0 && value.selectionIsWater && value.centerMatchesSelection && value.mapReady && value.nativeCenterMatchesSelection && value.nativeScaleMatches,
    'previewing the first real suggestion nearby water', 15000)
  assert.equal(result.preview.zoom, 15); assert.equal(result.preview.nativeScale, 15); assert.equal(result.preview.live, true)
  assert.equal(result.preview.nativeMarker, true)
  assert.equal(result.preview.displayLabel, keyword, 'Preview preserves the typed query and result list')
  result.checks.push('Browse auto-previews real nearby mapped water without committing or rewriting the query')
  await mapScreenshot(client, resolve(output, 'search-water-preview.png'))
  await progress('real-preview')
  const first = await searchNode?.$('.mobile-search__suggestion') || await page.getElementByXpath('//button[contains(@class,"mobile-search__suggestion")]')
  if (first) { await first.tap(); result.selectDelivery = 'SDK native Element.tap' }
  else {
    await client.evaluate(() => getApp().__waterSearchAudit.selectFirst())
    result.selectDelivery = 'compiled native suggestion bindtap UI handler (SDK cannot resolve the option node)'
  }
  result.selected = await until(value => !value.pendingOperation && value.mapReady && value.selectionIsWater && value.centerMatchesSelection && value.nativeCenterMatchesSelection && value.nativeScaleMatches && !value.live && value.suggestionCount === 0,
    'verifying the explicitly selected real water')
  assert.equal(result.selected.zoom, 15); assert.equal(result.selected.nativeScale, 15); assert.equal(result.selected.nativeMarker, true)
  assert.equal(result.selected.geometryOverlayMatches, true)
  assert.ok(result.selected.displayLabel)
  const searchesAfterSelection = result.selected.search
  await sleep(1200) // Exceeds MobileSearch's debounce; the former bug reopened suggestions here.
  result.stable = await audit()
  assert.equal(result.stable.search, searchesAfterSelection); assert.equal(result.stable.suggestionCount, 0)
  assert.equal(result.stable.live, false); assert.equal(result.stable.centerMatchesSelection, true)
  assert.equal(result.stable.selectionIsWater, true); assert.equal(result.stable.blockedWrites, 0)
  assert.equal(result.stable.preview, 0, 'Native map rendering must not fetch AMap static previews')
  result.layout = await client.evaluate(() => getApp().__waterSearchAudit.layout())
  assert.equal(result.layout.visibleSuggestionCount, 0)
  assert.ok(result.layout.field.width >= 200 && result.layout.canvas.width >= 300)
  assert.ok(result.layout.field.top >= result.layout.map.top)
  result.checks.push('Tapping the actual suggestion verifies real water, centers it at the H5-equivalent view, and keeps suggestions closed after debounce')
  await mapScreenshot(client, resolve(output, 'search-water-selected.png'))
  result.passed = true; await progress('complete')
} catch (error) {
  result.passed = false; result.error = String(error.message).replace(/https?:\/\/\S+/g, '[URL omitted]')
  result.lastState = await audit().catch(() => ({ unavailable: true }))
  await client.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await client.evaluate(() => getApp().__waterSearchAudit?.restore()).catch(() => {})
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
  await client.disconnect()
}
