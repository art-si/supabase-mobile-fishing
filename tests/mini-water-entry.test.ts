import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import ts from 'typescript'
import { placeSelection, waterSelection } from '../src/domain/map'
import { returnMapSelection } from '../src/platforms/map-navigation'
import { containsWaterPoint } from '../src/domain/water-geometry'

function deferred() {
  let resolve!: (value: any) => void, reject!: (error: Error) => void
  return { promise: new Promise((ok, fail) => { resolve = ok; reject = fail }), resolve, reject }
}
const entry = { longitude: 114.2, latitude: 30.4, coarse: true, crs: 'GCJ-02' }
const nearby = { name: '契约附近水域', point: [114.199, 30.399], distance: 100, source: 'live' }
// Run the actual Mini controller with real Vue mounting/watch scheduling. Only
// native lifecycle/provider contracts are isolated; no physical-GPS claim.
function mpOnly(source: string) {
  const enabled = [true], lines: string[] = []
  for (const line of source.split('\n')) {
    const open = line.match(/^\s*(?:\/\/|<!--)\s*#(ifdef|ifndef)\s+([\w-]+)(?:\s*-->)?\s*$/)
    if (open) { const matches = open[2] === 'MP-WEIXIN'; enabled.push(enabled.at(-1)! && (open[1] === 'ifdef' ? matches : !matches)); continue }
    if (/^\s*(?:\/\/|<!--)\s*#endif(?:\s*-->)?\s*$/.test(line)) { enabled.pop(); continue }
    if (enabled.at(-1)) lines.push(line)
  }
  assert.equal(enabled.length, 1, 'real page conditional-compilation directives remain balanced')
  return lines.join('\n')
}
function runtime(options: { mode?: 'water' | 'browse' | 'place'; entry?: typeof entry | null; fresh?: typeof entry; deferLocation?: boolean; signedIn?: boolean; parent?: boolean; regionFailure?: boolean } = {}) {
  const mode = options.mode || 'water', point = Vue.ref(options.entry === undefined ? entry : options.entry)
  const auth = Vue.reactive({ context: 1, signedIn: options.signedIn !== false, requireLogin: () => auth.signedIn })
  const waters: any[] = [], locations: any[] = [], regions: any[] = [], hooks: Record<string, () => void> = {}, stored: any[] = [], miniMounts: any[] = []
  const pageHooks: Record<string, (value?: any) => void> = {}
  const modules: Record<string, any> = {
    vue: Vue,
    '@dcloudio/uni-app': { onHide: (fn: () => void) => { hooks.hide = fn }, onShow: (fn: () => void) => { hooks.show = fn },
      onLoad: (fn: (value: any) => void) => { pageHooks.load = fn }, onReady: (fn: () => void) => { pageHooks.ready = fn }, onUnload: (fn: () => void) => { pageHooks.unload = fn } },
    '@/stores/auth': { useAuthStore: () => auth },
    '@/services/entry-location': { entryPosition: point },
    '@/platforms/map-trace': { traceMap() {} }, '@/platforms/map-navigation': { returnMapSelection },
    '@/services/water-index': { registerBundledWaterIndex() {} },
    '../bundled-water-index': { readBundledWaterIndex() {} },
    '@/platforms/entry-location': { captureEntryLocation: () => { const job = deferred(); locations.push(job); if (!options.deferLocation) job.resolve(options.fresh ?? entry); return job.promise } },
    '@/services/amap': {
      searchMapPlaces: async () => ({ items: [] }), searchMapWaterPlaces: async () => [],
      lookupMapRegion: async (...values: number[]) => { regions.push(values); if (options.regionFailure) throw Error('offline'); return { city: '城市', district: '区域', adcode: '420100' } },
    },
    '@/services/nearby-water': { resolveNearbyWater: (values: number[], radius: number, labels: unknown) => {
      const job = { point: values, radius, labels, ...deferred() }; waters.push(job); return job.promise
    } },
    '@/domain/rules': { validCoordinates: (lng: number, lat: number) => Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90,
      errorText: (error: Error) => error.message },
    '@/domain/map': { placeSelection, waterSelection, validSelection: () => true, formatMapCoordinates: () => '' },
    '@/domain/water-geometry': { waterTapRadiusM: () => 100, containsWaterPoint }, '@/domain/zones': { circleBounds: (value: any) => value },
    '@mobile-core/action-keyboard': {},
    '@/domain/zone-geometry': { boundaryPaths: () => [], boundaryAnchor: () => [0, 0], boundaryBounds: () => ({}) },
    '@/stores/appearance': { useAppearanceStore: () => ({ palette: { danger: '#B42331' } }) },
    '@/domain/user-errors': { unknownErrorMessage: 'unknown' }, '@/domain/map-spots': { sameMapBounds: () => false },
    '@/services/app-activity': { appForeground: Vue.ref(true) }, '@mobile-core/page-activity': { usePageActivity() {} },
  }
  const query = { in: () => query, select: () => query, boundingClientRect: () => query, exec() {} }
  const uni = { getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812 }), createSelectorQuery: () => query,
    onWindowResize() {}, offWindowResize() {}, setStorageSync: (...values: any[]) => stored.push(values), navigateBack() {} }
  const { descriptor } = parse(readFileSync(new URL('../src/pages/map/components/MiniWaterMap.vue', import.meta.url), 'utf8'))
  const script = compileScript(descriptor, { id: 'mini-entry-contract' }), exports: any = {}
  runInNewContext(ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, uni, require: (id: string) => id.endsWith('.vue') ? {} : (assert.ok(id in modules, id), modules[id]),
  })
  const component = exports.default; component.render = () => null
  const vm = Vue.ref<any>(), props = Vue.reactive({ pick: mode !== 'browse', waterPick: mode === 'water', requestId: 'isolated-entry' })
  const setup = component.setup
  component.setup = (values: any, context: any) => {
    miniMounts.push({ pick: values.pick, waterPick: values.waterPick, requestId: values.requestId })
    vm.value = Vue.getCurrentInstance()!.proxy
    return setup(values, context)
  }
  const renderer = Vue.createRenderer({ patchProp() {}, insert() {}, remove() {}, createElement: () => ({}), createText: () => ({}),
    createComment: () => ({}), setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null })
  let root: any = { render: () => Vue.h(component, { ...props, ref: vm }) }
  if (options.parent) {
    const pageSource = mpOnly(readFileSync(new URL('../src/pages/map/index.vue', import.meta.url), 'utf8'))
    const parent = parse(pageSource)
    assert.equal(parent.errors.length, 0)
    const parentScript = compileScript(parent.descriptor, { id: 'real-map-page-entry', inlineTemplate: true }), pageExports: any = {}
    const shell = Vue.defineComponent({ inheritAttrs: false, setup: (_props, context) => () => Vue.h('view', null, context.slots.default?.()) })
    runInNewContext(ts.transpileModule(parentScript.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      exports: pageExports, uni,
      require: (id: string) => id.endsWith('MiniWaterMap.vue') ? { __esModule: true, default: component }
        : id.endsWith('.vue') ? { __esModule: true, default: shell } : (assert.ok(id in modules, id), modules[id])
    })
    root = pageExports.default
  }
  const app = renderer.createApp(root); app.mount({})
  const tick = async () => { for (let i = 0; i < 8; i++) { await Vue.nextTick(); await Promise.resolve() } }
  return { state: () => vm.value?.$?.setupState, point, auth, waters, locations, regions, hooks, stored, miniMounts,
    load: async (value: Record<string, string>) => { assert.ok(pageHooks.load, 'the actual parent registered onLoad'); pageHooks.load(value); await tick() },
    tick, dispose: () => app.unmount() }
}

test('ordinary native picks preserve the named POI and its address; a later manual tap uses its own region', async () => {
  const app = runtime({ mode: 'place' })
  const place = { id: 'poi', name: '契约地点', address: '契约道路12号', adcode: '320500', longitude: 120.68, latitude: 31.3 }
  try {
    await app.tick()
    const state = app.state()
    state.places = [place]
    state.choosePlace(place.id)
    await app.tick()
    assert.equal(state.selected.name, place.name)
    assert.equal(state.selected.address, place.address)
    assert.equal(state.selected.adcode, place.adcode)
    assert.equal(state.scale, 14)
    assert.equal(app.regions.length, 0)
    state.tapMap({ longitude: 114.21, latitude: 30.41, radius: 100 })
    await app.tick()
    assert.equal(app.regions.length, 1)
    assert.equal(state.selected.name, '城市 区域')
    assert.equal(state.selected.address, undefined)
    assert.equal(state.selected.longitude, 114.21)
    assert.equal(app.waters.length, 0)
    assert.equal(app.stored.length, 0)
  } finally { app.dispose() }
})

test('ordinary manual picks keep their coordinates without inventing an address when region lookup fails', async () => {
  const app = runtime({ mode: 'place', regionFailure: true })
  try {
    await app.tick(); app.state().tapMap({ longitude: 114.21, latitude: 30.41, radius: 100 }); await app.tick()
    const { name, address, longitude, latitude, kind } = app.state().selected
    assert.deepEqual([kind, name, address, longitude, latitude], [undefined, '已选位置', undefined, 114.21, 30.41]); assert.equal(app.stored.length, 0)
  } finally { app.dispose() }
})

test('first water-pick/browse entry refreshes the authorized position once, displays water, and never confirms it automatically', async () => {
  for (const mode of ['water', 'browse'] as const) {
    const h = runtime({ mode })
    try {
      await h.tick(); assert.equal(h.waters.length, 1)
      assert.deepEqual(Array.from(h.waters[0].point), [entry.longitude, entry.latitude]); assert.equal(h.waters[0].radius, 2000)
      assert.equal(typeof h.waters[0].labels, 'function'); assert.equal(h.locations.length, 1, 'fresh location rather than the gate cache')
      h.waters[0].resolve(nearby); await h.tick()
      assert.equal(h.state().selected.kind, 'water'); assert.equal(h.state().focusedPlace, nearby.name); assert.equal(h.state().scale, 15)
      assert.deepEqual({ ...h.state().center }, { longitude: nearby.point[0], latitude: nearby.point[1] }); assert.equal(h.stored.length, 0)
      h.hooks.hide!(); h.hooks.show!(); h.point.value = { ...entry, longitude: 115 }; await h.tick()
      assert.equal(h.waters.length, 1); assert.equal(h.state().selected.name, nearby.name)
    } finally { h.dispose() }
  }
})

test('the real MP page defers Mini mounting and every provider until onLoad establishes water/post/place/browse mode', async () => {
  const modes = [
    { name: 'water', route: { pick: '1', context: 'water', requestId: 'route-water' }, pick: true, waterPick: true },
    { name: 'post', route: { pick: '1', context: 'post', requestId: 'route-post' }, pick: true, waterPick: true },
    { name: 'place', route: { pick: '1', requestId: 'route-place' }, pick: true, waterPick: false },
    { name: 'browse', route: {}, pick: false, waterPick: false }
  ]
  for (const mode of modes) {
    const h = runtime({ parent: true })
    try {
      // Compile/mount the real page template before delivering its native onLoad.
      // Gate position and authenticated account already exist, so an early child
      // would immediately perform the wrong default-browse water lookup.
      await h.tick(); await h.tick()
      assert.equal(h.miniMounts.length, 0, `${mode.name}: no child setup before route options`)
      assert.equal(h.state(), undefined)
      assert.equal(h.waters.length + h.locations.length + h.regions.length, 0, `${mode.name}: no provider before route options`)
      await h.load(mode.route as Record<string, string>)
      assert.deepEqual(h.miniMounts, [{ pick: mode.pick, waterPick: mode.waterPick, requestId: mode.route.requestId || '' }])
      assert.equal(h.locations.length, 1, 'the child refreshes the authorized position after its actual mount')
      if (mode.name === 'place') {
        assert.equal(h.waters.length, 0); assert.equal(h.regions.length, 0)
        assert.equal(h.state().selected, null); assert.equal(h.state().water, undefined)
        assert.equal(h.state().positionMarker.name, '当前位置附近')
        assert.equal(h.state().selecting, false)
      } else {
        assert.equal(h.waters.length, 1)
        h.waters[0].resolve(nearby); await h.tick()
        assert.equal(h.state().selected.kind, 'water'); assert.equal(h.state().selected.name, nearby.name)
        assert.equal(h.state().scale, 15)
      }
      await h.tick(); assert.equal(h.miniMounts.length, 1, 'normal reactive scheduling does not remount the initialized mode')
      assert.equal(h.stored.length, 0, 'route initialization never confirms or stores a selection')
    } finally { h.dispose() }
  }
})

test('an asynchronous location/login gates initial lookup; no invented overview point is queried', async () => {
  for (const readiness of ['entry', 'login'] as const) {
    const h = runtime(readiness === 'entry' ? { entry: null } : { signedIn: false })
    try {
      await h.tick(); assert.equal(h.waters.length, 0)
      if (readiness === 'entry') h.point.value = entry
      else h.auth.signedIn = true
      await h.tick(); assert.equal(h.waters.length, 1)
      h.waters[0].resolve(nearby); await h.tick(); assert.equal(h.state().selected.name, nearby.name)
    } finally { h.dispose() }
  }
})

test('general-place entry centers the device and shows a current-position pin without selecting water or enabling confirmation', async () => {
  const h = runtime({ mode: 'place' })
  try {
    await h.tick(); assert.equal(h.waters.length, 0); assert.equal(h.regions.length, 0)
    assert.equal(h.state().selected, null); assert.equal(h.state().water, undefined)
    assert.equal(h.state().positionMarker.name, '当前位置附近'); assert.equal(h.state().focusedPlace, '当前位置附近')
    assert.deepEqual({ ...h.state().center }, { longitude: entry.longitude, latitude: entry.latitude })
    assert.match(h.state().hint, /请选点确认/); assert.equal(h.stored.length, 0)
  } finally { h.dispose() }
})

test('manual search, pan, point and an existing selection prevent late entry initialization from overwriting user intent', async () => {
  for (const action of ['search', 'pan', 'point', 'existing'] as const) {
    const h = runtime({ entry: null })
    try {
      await h.tick()
      if (action === 'search') h.state().editSearch('正在编辑')
      if (action === 'pan') { h.state().interactMap(); h.state().panMap({ longitude: 115, latitude: 31 }) }
      if (action === 'point') h.state().tapMap({ longitude: 115, latitude: 31, radius: 100 })
      if (action === 'existing') h.state().selected = waterSelection([115, 31], '已回填水域')
      const before = h.waters.length; h.point.value = entry; await h.tick(); assert.equal(h.waters.length, before)
      if (action === 'search') assert.equal(h.state().query, '正在编辑')
      if (action === 'existing') assert.equal(h.state().selected.name, '已回填水域')
    } finally { h.dispose() }
  }
})

test('hide invalidates an unfinished initial lookup and show resumes it once; obsolete completion never wins', async () => {
  const h = runtime()
  try {
    await h.tick(); assert.equal(h.waters.length, 1)
    h.hooks.hide!(); h.waters[0].resolve(nearby); await h.tick(); assert.equal(h.state().selected, null)
    h.hooks.show!(); h.hooks.show!(); await h.tick(); assert.equal(h.waters.length, 2)
    h.waters[1].resolve({ ...nearby, name: '恢复后的真实水域' }); await h.tick()
    assert.equal(h.state().selected.name, '恢复后的真实水域')
  } finally { h.dispose() }
})

test('a manual action supersedes an already-started initial lookup and return does not restart it', async () => {
  const h = runtime()
  try {
    await h.tick(); assert.equal(h.waters.length, 1)
    h.state().editSearch('手动搜索'); h.waters[0].resolve(nearby); await h.tick()
    assert.equal(h.state().selected, null); assert.equal(h.state().query, '手动搜索')
    h.hooks.hide!(); h.hooks.show!(); await h.tick(); assert.equal(h.waters.length, 1)
  } finally { h.dispose() }
})

test('native gesture start owns the camera and clears selection; end observations never command a camera reset', async () => {
  const h = runtime()
  try {
    await h.tick(); assert.equal(h.waters.length, 1)
    h.state().interactMap(); const center = { ...h.state().center }
    h.waters[0].resolve(nearby); await h.tick()
    assert.equal(h.state().selected, null); assert.equal(h.state().selecting, false)
    assert.deepEqual({ ...h.state().center }, center)
    h.state().selected = waterSelection([115, 31], '已选水域')
    h.state().interactMap(); assert.equal(h.state().selected, null)
    h.state().panMap({ longitude: 115.01, latitude: 31.01 }); assert.equal(h.state().selected, null)
    assert.deepEqual({ ...h.state().center }, center)
    h.hooks.hide!(); h.hooks.show!(); await h.tick(); assert.equal(h.waters.length, 1)
  } finally { h.dispose() }
})

test('no-water/error entry never fabricates a water or loops on return', async () => {
  for (const scenario of ['empty', 'error', 'invalid'] as const) {
    const h = runtime({ entry: scenario === 'invalid' ? { ...entry, longitude: NaN } : entry })
    try {
      await h.tick()
      if (scenario === 'invalid') { assert.equal(h.waters.length, 0); continue }
      assert.equal(h.waters.length, 1)
      if (scenario === 'empty') h.waters[0].resolve(undefined)
      else h.waters[0].reject(new Error('契约网络失败'))
      await h.tick(); assert.equal(h.state().selected, null); assert.ok(h.state().hint)
      h.hooks.hide!(); h.hooks.show!(); await h.tick(); assert.equal(h.waters.length, 1)
    } finally { h.dispose() }
  }
})

test('first entry uses newly returned coordinates rather than the old mandatory-gate position', async () => {
  const fresh = { ...entry, longitude: 115, latitude: 31 }
  const h = runtime({ fresh })
  try {
    await h.tick()
    assert.deepEqual(Array.from(h.waters[0].point), [fresh.longitude, fresh.latitude])
    assert.equal(h.stored.length, 0)
  } finally { h.dispose() }
})

test('manual touch cancels late fresh positioning, while viewport observations cannot cancel a new tap lookup', async () => {
  const h = runtime({ deferLocation: true })
  try {
    await h.tick(); assert.equal(h.locations.length, 1)
    h.state().interactMap(); h.state().viewportScale = 17
    h.state().tapMap({ longitude: 115, latitude: 31, radius: 300 })
    h.locations[0].resolve(entry); await h.tick()
    assert.equal(h.waters.length, 1, 'stale positioning never starts a second water request')
    h.state().panMap({ longitude: 114.9, latitude: 30.9 })
    h.waters[0].resolve({ ...nearby, point: [115.001, 31.001] }); await h.tick()
    assert.equal(h.state().selected.name, nearby.name)
    assert.equal(h.state().viewportScale, 17, 'selection retains the observed native zoom')
    assert.equal(h.state().scale, 15, 'do not echo the observed zoom through the rounding native scale attribute')
    assert.deepEqual({ ...h.state().center }, { longitude: 115.001, latitude: 31.001 })
  } finally { h.dispose() }
})

test('first location and tap results wait for an active touch, then survive harmless native jitter', async () => {
  const h = runtime()
  try {
    await h.tick()
    h.state().gestureChanged(true)
    h.waters[0].resolve(nearby); await h.tick()
    assert.equal(h.state().selected, null, 'do not move the map underneath a finger')
    h.state().gestureChanged(false); await h.tick()
    assert.equal(h.state().selected.name, nearby.name)
    h.state().tapMap({ longitude: 115, latitude: 31, radius: 300 })
    h.state().gestureChanged(true)
    h.waters[1].resolve({ ...nearby, name: '刚点击的水域', point: [115, 31] }); await h.tick()
    h.state().gestureChanged(false); await h.tick()
    assert.equal(h.state().selected.name, '刚点击的水域')
  } finally { h.dispose() }
})

test('a named verified water is reused for inside taps, but island and outside taps still resolve geometry', async () => {
  const h = runtime()
  const polygon = [
    [[114,30],[114.3,30],[114.3,30.3],[114,30.3],[114,30]],
    [[114.1,30.1],[114.2,30.1],[114.2,30.2],[114.1,30.2],[114.1,30.1]]
  ]
  try {
    await h.tick(); h.waters[0].resolve({ ...nearby, polygon }); await h.tick()
    h.state().viewportScale = 16.65
    h.state().interactMap(); h.state().tapMap({ longitude:114.05, latitude:30.05, radius:300 }); await h.tick()
    assert.equal(h.waters.length, 1, 'inside verified water needs no new network request')
    assert.equal(h.state().selected.longitude, 114.05)
    assert.equal(h.state().viewportScale, 16.65)
    assert.equal(h.state().scale, 15, 'native fractional scale is not sent through the scale attribute')
    h.state().interactMap(); h.state().tapMap({ longitude:114.15, latitude:30.15, radius:300 }); await h.tick()
    assert.equal(h.waters.length, 2, 'land island is not water')
    h.state().interactMap(); h.state().tapMap({ longitude:115, latitude:31, radius:300 }); await h.tick()
    assert.equal(h.waters.length, 3, 'outside cached geometry uses nearest-water resolution')
  } finally { h.dispose() }
})
