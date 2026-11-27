import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { boundaryAnchor, boundaryPaths } from '../src/domain/zone-geometry'
import { waterTapRadiusM, waterDistance } from '../src/domain/water-geometry'
import * as projection from '../src/domain/map-screen-point'

const component = readFileSync(new URL('../src/pages/map/components/NativeWaterMap.vue', import.meta.url), 'utf8')
const region = (lng = 114, lat = 30) => ({ southwest: { longitude: lng - .02, latitude: lat - .01 }, northeast: { longitude: lng + .02, latitude: lat + .01 } })
const detail = (lng = 114, lat = 30, scale = 15) => ({ centerLocation: { longitude: lng, latitude: lat }, scale, region: region(lng, lat) })
function adapter(options: { defer?: boolean; invalid?: boolean; clearOnInteract?: boolean; projection?: boolean } = {}) {
  const props: any = vue.reactive({ center: { longitude: options.invalid ? NaN : 114, latitude: 30 }, zoom: 15,
    size: { width: 390, height: 693 }, active: true, selected: { longitude: 114, latitude: 30, name: 'Selected water' },
    water: undefined, zones: [], operationPending: false })
  const auth = vue.reactive({ context: 1 }), appearance = vue.reactive({ palette: { danger: '#B42331' } })
  const exports: any = {}, events: any[] = [], calls: any[] = [], contexts: any[] = [], timers = new Map<number, () => void>(), stops: (() => void)[] = []
  let mounted: (() => void) | undefined, unmounted: (() => void) | undefined, timer = 0
  const native = { center: { longitude: 114, latitude: 30 }, scale: { scale: 15 }, region: region() }
  const map = {
    getCenterLocation: (callbacks: any) => query('center', callbacks),
    getScale: (callbacks: any) => query('scale', callbacks),
    getRegion: (callbacks: any) => query('region', callbacks),
    ...(options.projection ? {
      toScreenLocation: (callbacks: any) => callbacks.success({ x: 195, y: 300 }),
      fromScreenLocation: (callbacks: any) => {
        calls.push({ method: 'unproject', x: callbacks.x, y: callbacks.y })
        callbacks.success({ longitude: 114.192213, latitude: 30.505830 })
      }
    } : {})
  }
  function query(method: keyof typeof native, callbacks: any) {
    calls.push({ method, ...callbacks })
    if (!options.defer) void Promise.resolve().then(() => callbacks.success(native[method]))
  }
  const source = component.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!
    + '\nexports.api={onRegionChange,onUpdated,onTap,onZoneTap,onError,retry,readViewport,startPinDrag,movePin,endPinDrag,state:()=>({pinPosition:pinPosition.value,pinDragging:pinDragging.value,camera:observedCamera,commandCamera:camera.value,ready:ready.value,error:error.value,busy:busy.value,mapId,mapKey:mapKey.value,markers:markers.value,overlays:overlays.value,generation,readRevision,userGesture,publishingRead,pendingReads:pendingReads.size})};'
  const modules: Record<string, any> = {
    vue: { ...vue, getCurrentInstance: () => ({ uid: 37, proxy: { nativeScope: true } }),
      onMounted: (callback: () => void) => { mounted = callback }, onUnmounted: (callback: () => void) => { unmounted = callback },
      watch: (...args: any[]) => { const stop = (vue.watch as any)(...args); stops.push(stop); return stop } },
    '@/stores/auth': { useAuthStore: () => auth }, '@/stores/appearance': { useAppearanceStore: () => appearance },
    '@/platforms/map-trace': { traceMap() {} },
    '@/domain/rules': { validCoordinates: (lng: number, lat: number) => Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat > -85 && lat < 85 },
    '@/brand/no-fishing-pin.png': { __esModule: true, default: '/assets/test-no-fishing.png' },
    '@/domain/zone-geometry': { boundaryAnchor, boundaryPaths }, '@/domain/water-geometry': { waterTapRadiusM, waterDistance },
    '@/domain/map-screen-point':projection
  }
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: (id: string) => { assert.ok(id in modules, id); return modules[id] }, defineOptions() {}, defineProps: () => props,
    defineEmits: () => (name: string, value: any) => {
      events.push({ name, value })
      if (name === 'interact' && options.clearOnInteract) props.selected = null
    },
    uni: { createMapContext: (id: string, scope: any) => { contexts.push({ id, scope }); return map } },
    setTimeout: (callback: () => void) => { timers.set(++timer, callback); return timer }, clearTimeout: (id: number) => timers.delete(id)
  })
  const drain = async () => { for (let index = 0; index < 14; index++) await Promise.resolve(); await vue.nextTick() }
  const api = exports.api
  return { api, props, auth, appearance, events, calls, contexts, native, drain,
    mount: async () => { mounted?.(); await drain() },
    respond: async (start = 0, value = detail()) => {
      for (const call of calls.slice(start)) call.success(call.method === 'center' ? value.centerLocation : call.method === 'scale' ? { scale: value.scale } : value.region)
      await drain()
    },
    dispose: async () => { unmounted?.(); stops.forEach(stop => stop()); await drain() }
  }
}
const eventsOf = (state: ReturnType<typeof adapter>, name: string) => state.events.filter(event => event.name === name)
test('pin drag converts its tip once on release without moving or rounding the native camera', async () => {
  const state = adapter({ projection: true })
  try {
    await state.mount()
    const projected=projection.mapScreenPoint(state.props.selected,state.native.region,state.props.size)!
    assert.equal(state.api.state().pinPosition.x,projected.x-24)
    const camera = { ...state.api.state().commandCamera }
    state.api.startPinDrag()
    for (let x = 172; x <= 201; x++) state.api.movePin({ detail: { x, y: 282, source: 'touch' } })
    assert.equal(state.calls.filter(call => call.method === 'unproject').length, 0)
    await state.api.endPinDrag(); await state.drain()
    const conversion = state.calls.filter(call => call.method === 'unproject')
    assert.equal(conversion.length, 0)
    const dropped=eventsOf(state,'pinDrop')[0].value
    const screen=projection.mapScreenPoint(dropped,state.native.region,state.props.size)!
    assert.ok(Math.abs(screen.x-225)<1e-6);assert.ok(Math.abs(screen.y-330)<1e-6)
    assert.deepEqual({ ...state.api.state().commandCamera }, camera)
    assert.equal(eventsOf(state, 'interact').length, 0)
    assert.equal(state.api.state().pinDragging, false)
  } finally { await state.dispose() }
})
test('cancelled pin gesture and simple pin tap keep the previous selection', async () => {
  const state = adapter({ projection: true })
  try {
    await state.mount(); state.api.startPinDrag(); await state.api.endPinDrag(); await state.drain()
    state.api.startPinDrag(); state.api.movePin({ detail: { x: 240, y: 300, source: 'touch' } })
    await state.api.endPinDrag(true); await state.drain()
    assert.equal(eventsOf(state, 'pinDrop').length, 0)
    assert.equal(state.calls.filter(call => call.method === 'unproject').length, 0)
    assert.equal(state.props.selected.longitude, 114)
    assert.equal(state.api.state().pinDragging, false)
  } finally { await state.dispose() }
})
async function initialized(options: Parameters<typeof adapter>[0] = {}) {
  const state = adapter(options); await state.mount()
  if (options.defer) await state.respond()
  return state
}

test('native context readiness uses the actual map API without requesting device location or static rasters', async () => {
  const state = adapter({ defer: true })
  try {
    assert.equal(state.api.state().busy, true)
    await state.mount(); assert.equal(state.calls.length, 3)
    assert.equal(state.contexts[0].id, 'native-water-map-37')
    assert.equal(state.contexts[0].scope.nativeScope, true)
    await state.respond()
    assert.equal(state.api.state().ready, true); assert.equal(state.api.state().busy, false)
    assert.equal(eventsOf(state, 'bounds').length, 1)
    assert.equal(eventsOf(state, 'pan').length, 0)
    assert.match(component, /:show-location="false"/)
    assert.ok(!/getLocation|getFuzzyLocation|moveToLocation|staticmap|<canvas|\.wxs/.test(component))
    assert.match(component, /:enable-scroll="active && !pinDragging"/); assert.match(component, /:enable-zoom="active && !pinDragging"/)
  } finally { await state.dispose() }
})

test('programmatic camera update preserves selection and never emits user interaction or camera feedback', async () => {
  const state = await initialized()
  try {
    const selected = state.props.selected
    state.events.length = 0; state.props.center = { longitude: 115, latitude: 31 }; state.props.zoom = 16
    await state.drain()
    state.native.center = { longitude: 115, latitude: 31 }; state.native.scale = { scale: 16 }
    state.api.onRegionChange({ type: 'begin', causedBy: 'update' })
    state.api.onRegionChange({ type: 'end', causedBy: 'update', detail: detail(115, 31, 16) }); await state.drain()
    assert.equal(state.props.selected, selected)
    assert.equal(eventsOf(state, 'interact').length, 0); assert.equal(eventsOf(state, 'pan').length, 0); assert.equal(eventsOf(state, 'zoom').length, 0)
    assert.equal(state.api.state().camera.longitude, 115); assert.equal(state.api.state().camera.zoom, 16)
    assert.equal(eventsOf(state, 'bounds').at(-1).value.west, 114.98)
  } finally { await state.dispose() }
})

test('one native user drag clears selection once and publishes camera only at end, without a reactive update loop', async () => {
  const state = await initialized({ clearOnInteract: true })
  try {
    state.events.length = 0; state.props.operationPending = true
    state.api.onRegionChange({ detail: { type: 'begin', causedBy: 'gesture' } })
    state.api.onRegionChange({ type: 'begin', causedBy: 'gesture' })
    assert.equal(eventsOf(state, 'interact').length, 0); assert.equal(eventsOf(state, 'gesture').at(-1).value, true)
    assert.equal(state.api.state().camera.longitude, 114); assert.equal(eventsOf(state, 'pan').length, 0)
    state.native.center = { longitude: 115, latitude: 31 }; state.native.scale = { scale: 15.5 }
    state.api.onRegionChange({ detail: { type: 'end', causedBy: 'drag', ...detail(115, 31, 15.5) } }); await state.drain()
    assert.equal(eventsOf(state, 'pan').length, 1); assert.equal(eventsOf(state, 'zoom').length, 1); assert.equal(eventsOf(state, 'interact').length, 1); assert.equal(state.props.selected, null); assert.equal(state.api.state().commandCamera.zoom, 15)
    assert.equal(state.api.state().camera.longitude, 115); assert.equal(state.api.state().camera.zoom, 15.5)
    state.api.onRegionChange({ type: 'begin', causedBy: 'update' })
    state.api.onRegionChange({ type: 'end', causedBy: 'update', detail: detail(115, 31, 15.5) }); await state.drain()
    assert.equal(eventsOf(state, 'interact').length, 1); assert.equal(eventsOf(state, 'pan').length, 1)
    assert.equal(state.api.state().userGesture, false)
  } finally { await state.dispose() }
})

test('updated and programmatic region events cannot supersede an in-flight user-end camera read', async () => {
  const state = await initialized({ defer: true })
  try {
    state.events.length = 0
    state.api.onRegionChange({ type: 'begin', causedBy: 'gesture' })
    state.api.onRegionChange({ type: 'end', causedBy: 'drag' })
    const count = state.calls.length
    state.api.onUpdated()
    state.api.onRegionChange({ type: 'end', causedBy: 'update' })
    assert.equal(state.calls.length, count, 'passive notifications must not replace the higher-priority user capture')
    await state.respond(3, detail(115, 31, 16))
    assert.equal(eventsOf(state, 'pan').length, 1); assert.equal(eventsOf(state, 'pan')[0].value.longitude, 115)
    assert.equal(state.api.state().camera.zoom, 16)
  } finally { await state.dispose() }
})

test('a newer programmatic target invalidates old asynchronous native coordinates and orphan user ends', async () => {
  const state = await initialized({ defer: true })
  try {
    state.events.length = 0
    state.api.onRegionChange({ type: 'begin', causedBy: 'gesture' }); state.api.onRegionChange({ type: 'end', causedBy: 'drag' })
    const old = state.calls.slice(3)
    state.props.center = { longitude: 116, latitude: 32 }; state.props.zoom = 14; await state.drain()
    for (const call of old) call.success(call.method === 'center' ? { longitude: 115, latitude: 31 } : call.method === 'scale' ? { scale: 16 } : region(115, 31))
    state.api.onRegionChange({ type: 'end', causedBy: 'drag', detail: detail(115, 31, 16) }); await state.drain()
    assert.equal(eventsOf(state, 'pan').length, 0)
    assert.equal(state.api.state().camera.longitude, 116); assert.equal(state.api.state().camera.zoom, 14)
  } finally { await state.dispose() }
})

test('hidden, account-changed and disposed maps reject late native callbacks', async () => {
  for (const boundary of ['hidden', 'owner', 'disposed']) {
    const state = await initialized({ defer: true })
    try {
      state.events.length = 0
      state.api.onRegionChange({ type: 'begin', causedBy: 'gesture' }); state.api.onRegionChange({ type: 'end', causedBy: 'scale' })
      const old = state.calls.slice(3)
      if (boundary === 'hidden') state.props.active = false
      else if (boundary === 'owner') state.auth.context = 2
      else await state.dispose()
      await state.drain()
      for (const call of old) call.success(call.method === 'center' ? { longitude: 115, latitude: 31 } : call.method === 'scale' ? { scale: 18 } : region(115, 31))
      await state.drain()
      assert.equal(eventsOf(state, 'pan').length, 0, boundary)
      assert.equal(state.api.state().pendingReads, boundary === 'owner' ? 3 : 0,
        'only the new owner may start a fresh native read; hidden/disposed maps retain none')
      assert.equal(state.api.state().camera.longitude, 114, boundary)
    } finally { if (boundary !== 'disposed') await state.dispose() }
  }
})

test('a newer gesture wins when native responses arrive out of order', async () => {
  const state = await initialized({ defer: true })
  try {
    state.events.length = 0
    state.api.onRegionChange({ type: 'begin', causedBy: 'gesture' }); state.api.onRegionChange({ type: 'end', causedBy: 'drag' })
    const old = state.calls.slice(3)
    state.api.onRegionChange({ type: 'begin', causedBy: 'gesture' }); state.api.onRegionChange({ type: 'end', causedBy: 'drag' })
    await state.respond(6, detail(116, 32, 17))
    for (const call of old) call.success(call.method === 'center' ? { longitude: 115, latitude: 31 } : call.method === 'scale' ? { scale: 16 } : region(115, 31))
    await state.drain()
    assert.equal(eventsOf(state, 'pan').length, 1); assert.equal(state.api.state().camera.longitude, 116); assert.equal(state.api.state().camera.zoom, 17)
  } finally { await state.dispose() }
})

test('native tap coordinates use the current native zoom and remain usable during water lookup', async () => {
  const state = await initialized()
  try {
    state.events.length = 0; state.props.operationPending = true
    state.api.onTap({ detail: { longitude: 114.25, latitude: 30.5 } })
    await state.drain()
    const point = eventsOf(state, 'point')[0].value
    assert.equal(point.longitude, 114.25); assert.equal(point.latitude, 30.5)
    assert.equal(point.radius, waterTapRadiusM(30.5, 15, 160))
    assert.equal(eventsOf(state, 'interact').length, 1)
    state.api.onTap({ detail: { longitude: NaN, latitude: 30 } }); state.props.active = false; await state.drain()
    state.api.onTap({ detail: { longitude: 114, latitude: 30 } })
    assert.equal(eventsOf(state, 'point').length, 1)
  } finally { await state.dispose() }
})

test('real geometry is passed in GCJ-02 unchanged and multi-ring holes are never filled', async () => {
  const state = await initialized()
  const outer: [number, number][] = [[114, 30], [114.1, 30], [114.1, 30.1], [114, 30]]
  const inner: [number, number][] = [[114.02, 30.02], [114.03, 30.02], [114.03, 30.03], [114.02, 30.02]]
  try {
    state.props.water = { polygon: [outer, inner], line: [[114.2, 30.2], [114.3, 30.3]] }
    state.props.zones = [
      { id: 'core', source: 'official', title: '核心区', boundary: { type: 'MultiPolygon', coordinates: [[outer, inner], [outer]] } },
      { id: 'point', source: 'spot', title: '现场提醒', longitude: 114.4, latitude: 30.4, radius_m: 500 }
    ]
    const value = state.api.state()
    assert.ok(value.pinPosition); assert.equal(value.markers.length, 2)
    const [core, point] = value.markers
    assert.ok(core.id > 1 && point.id !== core.id); assert.equal(core.iconPath, '/assets/test-no-fishing.png')
    assert.deepEqual([core.longitude, core.latitude], boundaryAnchor(state.props.zones[0].boundary))
    assert.deepEqual([point.longitude, point.latitude, point.width, point.height], [114.4, 30.4, 48, 48])
    assert.match(component, /@markertap\.stop="onZoneTap"/); assert.match(component, /@callouttap\.stop="onZoneTap"/)
    state.api.onZoneTap({ detail: { markerId: core.id } }); state.api.onZoneTap({ markerId: point.id }); state.api.onZoneTap({ markerId: 1 })
    assert.deepEqual(eventsOf(state, 'zone').map(event => event.value), ['core', 'point']); assert.equal(eventsOf(state, 'point').length, 0)
    assert.equal(value.overlays.polygons.length, 3); assert.equal(value.overlays.polyline.length, 3)
    assert.equal(value.overlays.polygons[0].fillColor, '#00000000'); assert.equal(value.overlays.polygons[1].fillColor, '#00000000')
    assert.deepEqual(JSON.parse(JSON.stringify(value.overlays.polygons[0].points)), outer.map(([longitude, latitude]) => ({ longitude, latitude })))
    assert.ok(!('circles' in value.overlays))
    state.appearance.palette.danger = '#FFADB5'
    assert.equal(state.api.state().overlays.polygons[1].strokeColor, '#FFADB5')
    state.props.zones.reverse(); assert.deepEqual(Array.from(state.api.state().markers, (marker: any) => marker.id), [point.id, core.id])
    state.props.water = { polygon: [[[NaN, 30], [114, 30], [114.1, 30.1]]] }; state.props.zones = []; state.props.selected = null
    state.api.onZoneTap({ markerId: core.id }); assert.equal(eventsOf(state, 'zone').length, 2)
    assert.equal(state.api.state().overlays.polygons.length, 0); assert.equal(state.api.state().markers.length, 0)
  } finally { await state.dispose() }
})

test('tile updates do not produce continuous viewport reads after readiness; native errors remain retryable', async () => {
  const state = await initialized()
  try {
    const count = state.calls.length
    for (let index = 0; index < 100; index++) state.api.onUpdated()
    await state.drain(); assert.equal(state.calls.length, count)
    state.api.onError(); assert.equal(state.api.state().busy, false); assert.match(state.api.state().error, /重试/)
    state.api.retry(); await state.drain()
    assert.equal(state.api.state().mapKey, 1); assert.equal(state.api.state().error, '')
    assert.equal(state.contexts.length, 2); assert.equal(state.api.state().ready, true)
  } finally { await state.dispose() }
})

test('invalid initial coordinates are recoverable and never create an arbitrary map location', async () => {
  const state = adapter({ invalid: true })
  try {
    await state.mount()
    assert.equal(state.api.state().camera, undefined); assert.equal(state.contexts.length, 0)
    assert.equal(state.api.state().busy, false); assert.match(state.api.state().error, /无效/)
    state.props.center = { longitude: 114, latitude: 30 }; await state.drain()
    assert.equal(state.api.state().camera.longitude, 114); assert.equal(state.api.state().ready, true)
  } finally { await state.dispose() }
})

test('a layout measurement during pinch does not invalidate it or restore the requested camera afterwards', async () => {
  const state = await initialized()
  try {
    state.api.onRegionChange({ type: 'begin', causedBy: 'gesture' })
    state.props.size.height = 700; await state.drain()
    assert.equal(state.api.state().userGesture, true)
    state.native.center = { longitude: 114.3, latitude: 30.2 }; state.native.scale = { scale: 18.25 }
    // Android can deliver the scale from the previous render in event.detail.
    state.api.onRegionChange({ type: 'end', causedBy: 'scale', detail: detail(114, 30, 15) }); await state.drain()
    assert.equal(state.api.state().camera.zoom, 18.25)
    assert.equal(state.api.state().camera.longitude, 114.3)
    state.props.size.height = 710; await state.drain()
    assert.equal(state.api.state().camera.zoom, 18.25, 'size changes must not replay initial zoom 15')
    assert.equal(state.api.state().camera.longitude, 114.3)
    assert.equal(state.props.zoom, 15, 'observed scale is not fed back as a new navigation request')
    state.props.cameraRequest = 1; await state.drain()
    assert.equal(state.api.state().camera.longitude, 114, 'an explicit recenter to the same original target still works')
    assert.equal(state.api.state().camera.zoom, 15)
  } finally { await state.dispose() }
})

test('a tap supersedes an in-flight gesture read; its late end cannot clear the new water selection', async () => {
  const state = await initialized({ defer: true })
  try {
    state.events.length = 0
    state.api.onRegionChange({ type: 'begin', causedBy: 'gesture' })
    state.api.onRegionChange({ type: 'end', causedBy: 'drag' })
    state.api.onTap({ detail: { longitude: 114.25, latitude: 30.5 } })
    await state.respond(3, detail(114.2, 30.4, 17))
    state.api.onRegionChange({ type: 'end', causedBy: 'drag', detail: detail(114.2, 30.4, 17) })
    await state.drain()
    assert.equal(eventsOf(state, 'point').length, 1)
    assert.equal(eventsOf(state, 'pan').length, 0)
  } finally { await state.dispose() }
})

test('phone fractional zoom remains native-owned and never travels back through the rounding scale attribute', async () => {
  const state = await initialized()
  try {
    const command = state.api.state().commandCamera
    state.api.onRegionChange({ type: 'begin', causedBy: 'gesture' })
    state.native.scale = { scale: 14.65 }
    state.api.onRegionChange({ type: 'end', causedBy: 'scale', detail: detail(114, 30, 14.65) })
    await state.drain()
    assert.equal(state.api.state().camera.zoom, 14.65)
    assert.equal(state.api.state().commandCamera, command, 'no property update that makes Android round 14.65 to 14')
    state.api.onUpdated(); await state.drain()
    assert.equal(state.api.state().commandCamera, command)
  } finally { await state.dispose() }
})

test('tap uses actual native scale when wheel zoom emits no region event', async () => {
  const state = await initialized()
  try {
    state.native.scale = { scale: 16.65 }
    await state.api.onTap({ detail: { longitude: 114.2, latitude: 30.4 } })
    const point = eventsOf(state, 'point').at(-1).value
    assert.equal(point.radius, waterTapRadiusM(30.4, 16.65, 160))
    assert.equal(eventsOf(state, 'zoom').at(-1).value, 16.65)
    assert.equal(state.api.state().commandCamera.zoom, 15)
  } finally { await state.dispose() }
})

test('a phone tap followed by tiny native drag jitter does not cancel its water lookup', async () => {
  const state = await initialized()
  try {
    state.events.length = 0
    state.api.onTap({ detail: { longitude: 114.1, latitude: 30.1 } })
    state.api.onRegionChange({ type: 'begin', causedBy: 'gesture' })
    state.native.center = { longitude: 114.000001, latitude: 30.000001 }
    state.api.onRegionChange({ type: 'end', causedBy: 'drag' })
    await state.drain()
    assert.equal(eventsOf(state, 'interact').length, 1, 'only the tap, not subsequent touch jitter, starts a new user intent')
    assert.equal(eventsOf(state, 'gesture').at(-1).value, false)
  } finally { await state.dispose() }
})
