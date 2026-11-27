// Observe real native MapContext camera changes after SDK touch delivery.
// Never call a regionchange/controller handler to manufacture a successful pan.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { confirmedAppId, confirmedProjectUrl } from './miniapp-release-config.mjs'
import { nativeBindings, mapScreenshot } from './miniapp-map-audit.mjs'

const build = resolve(process.env.MINIAPP_BUILD_DIR || 'dist/build/mp-weixin')
const output = resolve(process.env.MINIAPP_GESTURE_OUTPUT || 'artifacts/mini-native-map-20261124/gesture-live')
const template = await readFile(resolve(build, 'pages/map/components/NativeWaterMap.wxml'), 'utf8')
const bindings = nativeBindings(template)
const require = createRequire(resolve('artifacts/miniapp-tools/package.json'))
async function bounded(promise, label, milliseconds = 15000) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`Timed out SDK ${label}`), { name: 'SdkTimeout' })), milliseconds) })])
  } finally { clearTimeout(timer) }
}
function boundedSdk(target) {
  return new Proxy(target, { get(object, key) {
    const value = Reflect.get(object, key, object)
    if (typeof value !== 'function') return value
    return async (...args) => {
      const result = await bounded(Promise.resolve(value.apply(object, args)), String(key), key === 'disconnect' ? 3000 : 15000)
      return result && ['currentPage', 'getElementByXpath'].includes(key) ? boundedSdk(result) : result
    }
  } })
}
const rawClient = await bounded(require('miniprogram-automator').connect({ wsEndpoint: process.env.WECHAT_AUTOMATOR_WS || 'ws://127.0.0.1:9440' }), 'connect')
  .catch(error => { console.error(JSON.stringify({ passed: false, outcome: 'inconclusive', error: error.message, observerInstalled: false, physicalPhone: false })); process.exit(2) })
const client = boundedSdk(rawClient)
await mkdir(output, { recursive: true })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const result = { checkedAt: new Date().toISOString(), passed: false, exercised: false, physicalPhone: false, drags: [],
  boundary: 'Existing formal authenticated DevTools session, real mandatory gate position, native map and real water services. Inputs are SDK synthetic touch events, never a physical-phone claim. No location/auth/provider mocks, direct event-handler calls, programmatic camera moves, uploads, confirmation or business writes. Public MapContext getters independently establish movement; coordinates and credentials remain inside the evaluator.' }
const status = () => client.evaluate(() => getApp().__nativeGestureAudit.status())
function requireObservation(value) {
  if (!value.observationActive) throw Object.assign(new Error('Read-only request observation expired; subsequent requests are unverified'), { name: 'AuditInconclusive' })
}
async function until(predicate, description, timeout = 45000) {
  const started = Date.now(); let last
  while (Date.now() - started < timeout) {
    last = await status()
    requireObservation(last)
    if (last.blockedWrites) throw new Error('A non-read request was blocked by the audit guard')
    if (predicate(last)) return last
    await pause(200)
  }
  throw new Error(`Timed out ${description}; sanitized state: ${JSON.stringify(last)}`)
}
try {
  const identity = await client.evaluate(() => ({ appId: wx.getAccountInfoSync().miniProgram.appId, platform: wx.getDeviceInfo().platform }))
  assert.equal(identity.appId, confirmedAppId); assert.equal(identity.platform, 'devtools')
  await client.evaluate(({ project, bindings }) => {
    const app = getApp(), uniApi = require('_mobile-core/app.js').index
    app.__nativeGestureAudit?.restore?.()
    if (typeof uniApi.addInterceptor !== 'function' || typeof uniApi.removeInterceptor !== 'function') throw new Error('Read-only request observation is unavailable')
    const counts = { staticPreviews: 0, blockedWrites: 0 }, observerExpiresAt = Date.now() + 180000
    const guard = { invoke(options) {
      if (Date.now() >= observerExpiresAt) return undefined
      const url = String(options.url || ''), method = String(options.method || 'GET').toUpperCase()
      if (!url.startsWith(project + '/') || ['GET', 'HEAD'].includes(method)) return undefined
      let data
      try { data = typeof options.data === 'string' ? JSON.parse(options.data) : options.data } catch {}
      if (method === 'POST' && url.startsWith(project + '/functions/v1/amap') && ['search', 'region', 'shoreline', 'water-places', 'weather', 'preview'].includes(data?.action)) {
        if (data.action === 'preview') counts.staticPreviews++
        return undefined
      }
      if (method === 'POST' && (url === project + '/rest/v1/rpc/fishing_read' || url.startsWith(project + '/storage/v1/object/sign/') ||
        url.startsWith(project + '/auth/v1/token') && /[?&]grant_type=refresh_token(?:&|$)/.test(url))) return undefined
      if (method === 'POST' && (url === project + '/rest/v1/rpc/fishing_spot_community' && data?.action === 'summary' ||
        url === project + '/functions/v1/spot-discovery' && data?.operation === 'water_notices' ||
        url === project + '/rest/v1/rpc/fishing_list_spot_leads' ||
        url === project + '/rest/v1/rpc/fishing_zones_read' && data?.action === 'nearby')) return undefined
      counts.blockedWrites++; return false
    } }
    const uploadGuard = { invoke() { if (Date.now() >= observerExpiresAt) return undefined; counts.blockedWrites++; return false } }
    uniApi.addInterceptor('request', guard); uniApi.addInterceptor('uploadFile', uploadGuard)
    function refs() {
      const page = getCurrentPages().slice(-1)[0], found = { page }
      function walk(vm) {
        if (!vm) return
        const name = vm.$options.__name || vm.$options.name
        if (name === 'NativeWaterMap') found.map = vm
        if (name === 'MiniWaterMap') found.mini = vm
        ;(vm.$children || []).forEach(walk)
      }
      walk(page?.$vm); return found
    }
    async function nativeCamera(map) {
      if (!map) return null
      const id = bindings.id.replace(/{{(\w+)}}/g, (_, name) => map.$scope.data[name])
      let context
      try { context = wx.createMapContext(id, map.$scope) } catch { return null }
      const read = method => new Promise(resolve => {
        let finished = false
        const finish = value => { if (!finished) { finished = true; clearTimeout(timer); resolve(value) } }
        const timer = setTimeout(() => finish(null), 1800)
        try { context[method]({ success: finish, fail: () => finish(null) }) } catch { finish(null) }
      })
      const [center, scale] = await Promise.all([read('getCenterLocation'), read('getScale')])
      return center && Number.isFinite(center.longitude) && Number.isFinite(center.latitude) && Number.isFinite(scale?.scale)
        ? { center, scale: scale.scale } : null
    }
    const world = (point, zoom) => {
      const size = 256 * 2 ** zoom, latitude = Math.max(-85, Math.min(85, point.latitude)) * Math.PI / 180
      return { x: (point.longitude + 180) / 360 * size, y: (1 - Math.log(Math.tan(Math.PI / 4 + latitude / 2)) / Math.PI) / 2 * size }
    }
    let basis, beforeDrag
    const waterPinCount = map => Number(!!map && (!!map.$scope.data[bindings.pin] || map.$scope.data[bindings.markers]?.some(marker => marker.id === 1)))
    app.__nativeGestureAudit = {
      async status() {
        const { page, map } = refs(), p = map?.$props, native = await nativeCamera(map)
        return { route: page?.route, available: !!map, nativeReady: !!native, selectedWater: p?.selected?.kind === 'water',
          pendingOperation: !!p?.operationPending, nativeScale: native?.scale, parentScaleMatches: !!native && Math.abs(native.scale - p.zoom) < .01,
          parentCenterMatches: !!native && Math.abs(native.center.longitude - p.center.longitude) < .00002 && Math.abs(native.center.latitude - p.center.latitude) < .00002,
          markerCount: waterPinCount(map), observationActive: Date.now() < observerExpiresAt, ...counts }
      },
      async begin() {
        const { map } = refs(), native = await nativeCamera(map)
        if (!native) throw new Error('Native map camera is not readable')
        basis ??= native; beforeDrag = native
        return new Promise(resolve => wx.createSelectorQuery().in(map.$scope).select('.native-water-map__surface').boundingClientRect(resolve).exec())
      },
      async movement() {
        const { map } = refs(), p = map?.$props, native = await nativeCamera(map)
        if (!native || !basis || !beforeDrag) return { available: false, observationActive: Date.now() < observerExpiresAt, ...counts }
        const actual = world(native.center, basis.scale), previous = world(beforeDrag.center, basis.scale), first = world(basis.center, basis.scale)
        return { available: true, sameScale: Math.abs(native.scale - basis.scale) < .01,
          delta: { x: previous.x - actual.x, y: previous.y - actual.y }, cumulative: { x: first.x - actual.x, y: first.y - actual.y },
          parentCenterMatches: Math.abs(native.center.longitude - p.center.longitude) < .00002 && Math.abs(native.center.latitude - p.center.latitude) < .00002,
          selectedCleared: !p.selected, markerCount: waterPinCount(map),
          observationActive: Date.now() < observerExpiresAt, ...counts }
      },
      restore() { uniApi.removeInterceptor('request', guard); uniApi.removeInterceptor('uploadFile', uploadGuard); basis = beforeDrag = undefined; delete app.__nativeGestureAudit }
    }
  }, { project: confirmedProjectUrl, bindings })
  if (!process.argv.includes('--current-map')) {
    await client.callWxMethod('reLaunch', { url: '/pages/home/index?tab=spots' })
    await until(value => value.route === 'pages/home/index', 'opening the authenticated formal home')
    await client.callWxMethod('navigateTo', { url: '/pages/map/index' })
  }
  result.initial = await until(value => value.available && value.nativeReady && value.selectedWater && !value.pendingOperation && value.parentCenterMatches && value.parentScaleMatches,
    'waiting for automatic real nearby-water selection')
  assert.equal(result.initial.staticPreviews, 0)
  await mapScreenshot(client, resolve(output, 'selected-before-gestures.png'))
  const page = await client.currentPage()
  const surface = await page.getElementByXpath('//map[contains(@class,"native-water-map__surface")]')
  if (!surface) {
    result.reason = 'This SDK could not resolve the native map surface; no synthetic user movement is claimed'
  } else {
    for (let index = 0; index < 5; index++) {
      const rect = await client.evaluate(() => getApp().__nativeGestureAudit.begin())
      assert.ok(rect && rect.width >= 300 && rect.height >= 200)
      const travel = Math.min(300, rect.width - 40), startX = rect.left + 20, y = rect.top + rect.height * .48
      const touch = distance => ({ identifier: 1, clientX: startX + distance, clientY: y, pageX: startX + distance, pageY: y })
      let inputError
      try {
        await surface.touchstart({ touches: [touch(0)], changedTouches: [touch(0)] })
        for (let step = 1; step <= 6; step++) {
          const point = touch(travel * step / 6)
          await surface.touchmove({ touches: [point], changedTouches: [point] }); await pause(25)
        }
        await surface.touchend({ touches: [], changedTouches: [touch(travel)] })
      } catch (error) { inputError = error?.name || 'Error' }
      let movement
      for (let sample = 0; sample < 12; sample++) {
        await pause(150)
        movement = await client.evaluate(() => getApp().__nativeGestureAudit.movement())
        requireObservation(movement)
        if (movement.available && Math.hypot(movement.delta.x, movement.delta.y) > 20 && movement.parentCenterMatches) break
      }
      if (!movement?.available || Math.hypot(movement.delta.x, movement.delta.y) <= 20) {
        result.reason = inputError ? `SDK native map touch delivery failed (${inputError}); no actual native-camera movement was observed`
          : 'SDK touch dispatch did not move the public native MapContext camera. Generic element events cannot establish native map pan on this simulator'
        result.inputError = inputError
        break
      }
      assert.equal(movement.sameScale, true); assert.equal(movement.parentCenterMatches, true)
      assert.equal(movement.selectedCleared, true); assert.equal(movement.markerCount, 0)
      assert.equal(movement.staticPreviews, 0); assert.equal(movement.blockedWrites, 0)
      assert.ok(movement.delta.x > 20, 'a rightward drag must advance the independently measured native camera')
      const previous = result.drags.at(-1)?.after?.cumulative.x || 0
      assert.ok(movement.cumulative.x > previous + 20, 'successive drags must continue rather than snapping to the prior selected point')
      await pause(1500)
      const settled = await client.evaluate(() => getApp().__nativeGestureAudit.movement())
      assert.equal(settled.parentCenterMatches, true); assert.equal(settled.selectedCleared, true)
      assert.ok(settled.cumulative.x > previous + 20, 'no late selection or prop feedback may reset the camera')
      result.drags.push({ index: index + 1, requestedCssTravel: travel, after: movement, settled })
      await writeFile(resolve(output, 'progress.json'), JSON.stringify(result, null, 2) + '\n')
    }
    const rect = await client.evaluate(() => getApp().__nativeGestureAudit.begin()), before = await status()
    const midpoint = rect.left + rect.width / 2, y = rect.top + rect.height * .45
    const fingers = offset => [-1, 1].map((direction, index) => ({ identifier: index + 1, clientX: midpoint + direction * offset, clientY: y, pageX: midpoint + direction * offset, pageY: y }))
    try {
      await surface.touchstart({ touches: fingers(22), changedTouches: fingers(22) })
      for (const offset of [33, 48, 64, 80, 90]) { await surface.touchmove({ touches: fingers(offset), changedTouches: fingers(offset) }); await pause(40) }
      await surface.touchend({ touches: [], changedTouches: fingers(90) }); await pause(800)
      const after = await status(); requireObservation(after)
      result.pinch = { before: before.nativeScale, after: after.nativeScale, increased: after.nativeScale > before.nativeScale + .2 }
    } catch (error) { result.pinch = { increased: false, inputError: error.name } }
    result.exercised = result.drags.length === 5 && result.pinch.increased
  }
  result.final = await status()
  requireObservation(result.final)
  assert.equal(result.final.staticPreviews, 0); assert.equal(result.final.blockedWrites, 0)
  await mapScreenshot(client, resolve(output, 'after-gesture-probe.png'))
  if (!result.exercised) result.manualPhoneCheck = 'On the new formal preview, wait for nearby water, drag across the map five times rapidly, then pause. Every gesture must move immediately, selection must clear on the first drag, and the map must not return to the old selected point. This script has not performed that physical-phone check.'
  result.nativeReadChecksPassed = true
  result.outcome = result.exercised ? 'passed' : 'inconclusive'
  result.passed = result.exercised
  if (!result.exercised) process.exitCode = 2
} catch (error) {
  const inconclusive = ['SdkTimeout', 'AuditInconclusive'].includes(error.name)
  result.outcome = inconclusive ? 'inconclusive' : 'failed'
  result.error = String(error.message).replace(/https?:\/\/\S+/g, '[URL omitted]')
  result.lastState = await status().catch(() => ({ unavailable: true }))
  await client.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {})
  process.exitCode = inconclusive ? 2 : 1
} finally {
  result.observerRemovalConfirmed = await client.evaluate(() => { getApp().__nativeGestureAudit?.restore(); return true }).catch(() => false)
  result.sdkDisconnected = await client.disconnect().then(() => true, () => false)
  if (!result.observerRemovalConfirmed) result.cleanupNote = 'SDK did not confirm observer removal; the audit guard expires automatically within three minutes and never changes or mocks a wx method'
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
  if (!result.sdkDisconnected) process.exit(2)
}
