// Real formal DevTools first-entry water selection. No search, locate tap,
// account/GPS/provider fixtures, uploads, confirmation or business writes.
// A simulator result does not establish physical-phone location/gesture behavior.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readBuildFiles } from './miniapp-package.mjs'
import { nativeBindings, mapScreenshot } from './miniapp-map-audit.mjs'
import { confirmedAppId, confirmedProjectUrl, isLiveConfig } from './miniapp-release-config.mjs'

const build = resolve(process.env.MINIAPP_BUILD_DIR || 'dist/build/mp-weixin')
const output = resolve(process.env.MINIAPP_ENTRY_OUTPUT || 'artifacts/mini-water-entry-20261124/devtools-live')
const miniTemplate = await readFile(resolve(build, 'pages/map/components/MiniWaterMap.wxml'), 'utf8')
const nativeTemplate = await readFile(resolve(build, 'pages/map/components/NativeWaterMap.wxml'), 'utf8')
const miniTag = miniTemplate.match(/<view\b[^>]*mini-water-map__selection[^>]*>/)?.[0]
const bindings = { confirmation: miniTag?.match(/wx:if="{{(\w+)}}"/)?.[1], native: nativeBindings(nativeTemplate) }
assert.ok(bindings.confirmation, 'Current compiled native confirmation binding must be present')
assert.match(miniTemplate, /bindinteract="{{\w+}}"/, 'Build the current first-entry and gesture-ownership controller')
const code = [...readBuildFiles(build).entries()].filter(([path]) => path.endsWith('.js')).map(([, bytes]) => bytes.toString())
assert.ok(code.some(isLiveConfig))
assert.ok(code.some(source => source.includes(confirmedProjectUrl)))
const require = createRequire(resolve('artifacts/miniapp-tools/package.json'))
const client = await require('miniprogram-automator').connect({ wsEndpoint: process.env.WECHAT_AUTOMATOR_WS || 'ws://127.0.0.1:9440' })
await mkdir(output, { recursive: true })
const result = { checkedAt: new Date().toISOString(), cases: [], passed: false, physicalPhone: false,
  boundary: 'Existing real formal DevTools session, mandatory gate position and WeChat native map. Navigation plus public MapContext camera reads only; no search/locate gesture, injected position/account/provider, upload, confirmation or business writes. Structured logs omit coordinates, request URLs and credentials; screenshots preserve the visible app UI.' }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const status = () => client.evaluate(() => getApp().__waterEntryAudit.status())
async function until(predicate, description, timeout = 45000) {
  const started = Date.now()
  let last
  while (Date.now() - started < timeout) {
    last = await status()
    if (last.blockedWrites) throw new Error('A non-read request was blocked by the isolated observer')
    if (predicate(last)) return last
    await sleep(200)
  }
  throw new Error(`Timed out ${description}; sanitized state: ${JSON.stringify(last)}`)
}
try {
  const identity = await client.evaluate(() => ({ platform: wx.getDeviceInfo().platform, appId: wx.getAccountInfoSync().miniProgram.appId }))
  assert.equal(identity.platform, 'devtools'); assert.equal(identity.appId, confirmedAppId)
  await client.evaluate(({ project, bindings }) => {
    const app = getApp(), uniApi = require('_mobile-core/app.js').index
    app.__waterEntryAudit?.restore?.()
    if (typeof uniApi.addInterceptor !== 'function' || typeof uniApi.removeInterceptor !== 'function')
      throw new Error('Native request observation is unavailable')
    const counts = { search: 0, shoreline: 0, waterPlaces: 0, preview: 0, blockedWrites: 0, blockedRequests: [] }
    const guard = { invoke(options) {
      const url = String(options.url || ''), method = String(options.method || 'GET').toUpperCase()
      if (!url.startsWith(project + '/') || ['GET', 'HEAD'].includes(method)) return
      let data
      try { data = typeof options.data === 'string' ? JSON.parse(options.data) : options.data } catch {}
      if (method === 'POST' && url.startsWith(project + '/functions/v1/amap') && ['search', 'region', 'shoreline', 'water-places', 'preview', 'weather'].includes(data?.action)) {
        const key = data.action === 'water-places' ? 'waterPlaces' : data.action
        if (key in counts) counts[key]++
        return
      }
      if (method === 'POST' && (url === project + '/rest/v1/rpc/fishing_read' || url.startsWith(project + '/storage/v1/object/sign/') ||
          (url === project + '/functions/v1/spot-discovery' && data?.operation === 'water_notices') ||
          (url === project + '/rest/v1/rpc/fishing_spot_community' && data?.action === 'summary') ||
          url === project + '/rest/v1/rpc/fishing_list_spot_leads' ||
          (url === project + '/rest/v1/rpc/fishing_zones_read' && data?.action === 'nearby') ||
          (url.startsWith(project + '/auth/v1/token') && (data?.grant_type === 'refresh_token' || /[?&]grant_type=refresh_token(?:&|$)/.test(url))))) return
      counts.blockedWrites++
      const path = url.slice(project.length).split('?')[0]
      counts.blockedRequests.push({ path: path.startsWith('/rest/v1/rpc/') ? path : path.split('/').slice(0, 4).join('/'),
        action: typeof data?.action === 'string' && /^[a-z_0-9]{1,80}$/i.test(data.action) ? data.action : '[not an action request]' })
      return false
    } }
    const uploadGuard = { invoke() { counts.blockedWrites++; return false } }
    uniApi.addInterceptor('request', guard); uniApi.addInterceptor('uploadFile', uploadGuard)
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
    app.__waterEntryAudit = {
      async status() {
        const { page, mini, map, search } = refs(), p = map?.$props, s = search?.$props, native = await nativeCamera(map)
        const selected = p?.selected, water = p?.water, auth = page?.$vm?.$pinia?._s.get('fishing-auth')
        const data = map?.$scope.data || {}, markers = data[bindings.native.markers] || []
        const pinVisible = !!selected && (!!data[bindings.native.pin] || markers.some(marker => marker.id === 1 && Math.abs(Number(marker.longitude) - selected.longitude) < 1e-8 && Math.abs(Number(marker.latitude) - selected.latitude) < 1e-8))
        const confirmation = mini?.$children?.find(vm => (vm.$options.__name || vm.$options.name) === 'MobileAction')
        return { route: page?.route, signedIn: !!auth?.signedIn, ready: !!mini && !!map && !!search,
          mapReady: native.ready, pendingOperation: !!p?.operationPending,
          pick: !!mini?.$props.pick, waterPick: !!mini?.$props.waterPick,
          displayLabel: s?.modelValue || '', suggestionCount: s?.suggestions?.length || 0,
          selectionIsWater: selected?.kind === 'water', markerName: selected?.name || '', waterName: water?.name || '',
          waterSource: water?.source || '', waterNameUnavailable: !!water?.nameUnavailable,
          waterGeometry: !!water?.polygon?.length || !!water?.line?.length,
          waterDistanceWithinLookup: typeof water?.distance === 'number' && water.distance >= 0 && water.distance <= 2000,
          centerMatchesMarker: !!selected && !!p && Math.abs(selected.longitude - p.center.longitude) < 1e-8 && Math.abs(selected.latitude - p.center.latitude) < 1e-8,
          pinVisible, confirmationVisible: !!mini?.$scope.data[bindings.confirmation],
          confirmationEnabled: !!mini?.$scope.data[bindings.confirmation] && confirmation?.$props.disabled === false,
          nativeScale: native.scale, nativeScaleMatches: native.scale === p?.zoom,
          nativeCenterMatchesMarker: !!selected && !!native.center && Math.abs(selected.longitude - native.center.longitude) < 0.00002 && Math.abs(selected.latitude - native.center.latitude) < 0.00002,
          nativePolygonCount: data[bindings.native.polygons]?.length || 0, nativePolylineCount: data[bindings.native.polyline]?.length || 0,
          geometryOverlayMatches: (!water?.polygon?.length || !!data[bindings.native.polygons]?.length) && (!water?.line?.length || !!data[bindings.native.polyline]?.length),
          zoom: p?.zoom, ...counts }
      },
      async layout() {
        const { mini, map } = refs()
        const measure = query => new Promise(resolve => {
          let settled = false
          const timer = setTimeout(() => finish(null), 1800)
          function finish(value) { if (!settled) { settled = true; clearTimeout(timer); resolve(value) } }
          try { query.exec(finish) } catch { finish(null) }
        })
        const query = wx.createSelectorQuery().in(mini.$scope)
        query.select('.mini-water-map').boundingClientRect(); query.selectAll('.mini-water-map__selection').boundingClientRect()
        const cards = await measure(query)
        const surfaceQuery = wx.createSelectorQuery().in(map.$scope)
        surfaceQuery.select('.native-water-map__surface').boundingClientRect()
        const surfaces = await measure(surfaceQuery)
        return { observed: !!cards && !!surfaces, map: cards?.[0] || null, confirmation: cards?.[1]?.[0] || null, surface: surfaces?.[0] || null }
      },
      restore() { uniApi.removeInterceptor('request', guard); uniApi.removeInterceptor('uploadFile', uploadGuard); delete app.__waterEntryAudit }
    }
    return true
  }, { project: confirmedProjectUrl, bindings })
  await client.callWxMethod('reLaunch', { url: '/pages/home/index?tab=spots' })
  await until(value => value.route === 'pages/home/index', 'opening the existing authenticated home')
  await sleep(500)
  for (const mode of ['place', 'water', 'browse']) {
    const before = await status()
    const query = mode === 'browse' ? '' : `?pick=1&requestId=entry-readonly-${Date.now().toString(36)}${mode === 'water' ? '&context=water' : ''}`
    await client.callWxMethod('navigateTo', { url: '/pages/map/index' + query })
    result.stage = `${mode}-automatic-selection`
    const value = await until(value => value.route === 'pages/map/index' && value.ready && value.mapReady && !value.pendingOperation && value.nativeCenterMatchesMarker && value.nativeScaleMatches &&
      (mode === 'place' ? ['当前位置', '当前位置附近'].includes(value.markerName) : value.selectionIsWater), `automatically initializing ${mode} mode`)
    assert.equal(value.signedIn, true); assert.equal(value.pinVisible, true); assert.equal(value.centerMatchesMarker, true)
    assert.equal(value.search, before.search, 'First entry never searches a typed keyword')
    assert.equal(value.suggestionCount, 0); assert.equal(value.blockedWrites, 0)
    assert.equal(value.preview, before.preview, 'Native map rendering must not request AMap static previews')
    if (mode === 'place') {
      assert.equal(value.selectionIsWater, false); assert.equal(value.confirmationVisible, false)
      assert.equal(value.shoreline, before.shoreline); assert.equal(value.waterPlaces, before.waterPlaces)
    } else {
      assert.ok(value.markerName); assert.equal(value.displayLabel, value.markerName)
      if (value.waterName) assert.equal(value.displayLabel, value.waterName)
      else {
        assert.equal(value.waterGeometry, true)
        assert.ok(['未命名水域', '水域名称待确认'].includes(value.displayLabel), 'Do not invent a name for a real unnamed water geometry')
      }
      assert.equal(value.waterDistanceWithinLookup, true); assert.equal(value.zoom, 15); assert.equal(value.nativeScale, 15)
      assert.equal(value.geometryOverlayMatches, true)
      assert.equal(value.confirmationVisible, mode === 'water')
      if (mode === 'water') assert.equal(value.confirmationEnabled, true)
    }
    result.stage = `${mode}-native-layout`
    await sleep(400)
    const layout = await client.evaluate(() => getApp().__waterEntryAudit.layout())
    assert.equal(layout.observed, true, 'The public selector queries must return before claiming layout verification')
    assert.ok(layout.map && layout.map.width >= 300)
    assert.ok(layout.surface && layout.surface.width >= 300 && layout.surface.height >= 200)
    if (mode === 'water') {
      assert.ok(layout.confirmation); assert.ok(layout.confirmation.top > layout.map.top)
      assert.ok(layout.confirmation.bottom <= layout.map.bottom + 1)
    }
    result.stage = `${mode}-screenshot`
    await mapScreenshot(client, resolve(output, `${mode}-initial.png`))
    result.cases.push({ mode, state: value, layout })
    await writeFile(resolve(output, 'progress.json'), JSON.stringify(result, null, 2) + '\n')
    await client.callWxMethod('navigateBack', { delta: 1 })
    await until(value => value.route === 'pages/home/index', `returning from ${mode} mode without confirmation`)
    await sleep(500)
  }
  result.passed = true; result.stage = 'complete'
} catch (error) {
  result.error = String(error.message).replace(/https?:\/\/\S+/g, '[URL omitted]')
  result.lastState = await status().catch(() => ({ unavailable: true }))
  await client.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await client.evaluate(() => getApp().__waterEntryAudit?.restore()).catch(() => {})
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
  await client.disconnect()
}
