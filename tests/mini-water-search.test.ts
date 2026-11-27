import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import ts from 'typescript'
import { resolveMobileProRoot } from '../scripts/mobile-pro.mjs'
import { placeSelection, waterSelection } from '../src/domain/map'
import { returnMapSelection } from '../src/platforms/map-navigation'
import { containsWaterPoint } from '../src/domain/water-geometry'

function nativeSource(source: string) {
  const enabled = [true]
  return source.split('\n').filter(line => {
    const directive = line.match(/^\s*\/\/ #(ifdef|ifndef|endif)(?:\s+(\S+))?/)
    if (!directive) return enabled.at(-1)
    if (directive[1] === 'endif') enabled.pop()
    else enabled.push(Boolean(enabled.at(-1)) && (directive[1] === 'ifdef' ? directive[2] === 'MP-WEIXIN' : directive[2] !== 'MP-WEIXIN'))
    return false
  }).join('\n')
}
function deferred() {
  let resolve!: (value: any) => void, reject!: (error: Error) => void
  return { promise: new Promise((ok, fail) => { resolve = ok; reject = fail }), resolve, reject }
}
// The real MiniWaterMap and MobileSearch setups run with Vue's actual scheduler.
// Only provider responses/lifecycle/native measurements are isolated contracts.
// These fixtures are not a claim that a physical device/provider returned them.
function runtime(pick = true) {
  const requests: any[] = [], waters: any[] = [], hooks: Record<string, () => void> = {}, timers = new Map<number, () => void>()
  let timerId = 0
  const auth = Vue.reactive({ context: 1, signedIn: true, requireLogin: () => auth.signedIn })
  const modules: Record<string, any> = {
    vue: Vue,
    '@dcloudio/uni-app': { onHide: (fn: () => void) => { hooks.hide = fn }, onShow: (fn: () => void) => { hooks.show = fn } },
    '@/stores/auth': { useAuthStore: () => auth },
    '@/services/entry-location': { entryPosition: Vue.ref(null) },
    '@/platforms/map-trace': { traceMap() {} },
    '@/platforms/map-navigation': { returnMapSelection },
    '@/services/water-index': { registerBundledWaterIndex() {} },
    '../bundled-water-index': { readBundledWaterIndex() {} },
    '@/platforms/entry-location': { captureEntryLocation: async () => ({ longitude: 114.2, latitude: 30.4 }) },
    '@/services/amap': {
      searchMapPlaces: (query: string, city: string) => { const request = { query, city, ...deferred() }; requests.push(request); return request.promise },
      searchMapWaterPlaces: () => Promise.resolve([]),
      lookupMapRegion: async () => ({ city: '城市', district: '区域', adcode: '420100' }),
    },
    '@/services/nearby-water': { resolveNearbyWater: (point: number[], radius: number, labels?: unknown) => {
      const request = { point, radius, labels, ...deferred() }; waters.push(request); return request.promise
    } },
    '@/domain/rules': { validCoordinates: (lng: number, lat: number) => Number.isFinite(lng) && Number.isFinite(lat), errorText: (cause: Error) => cause.message },
    '@/domain/map': { placeSelection, waterSelection, formatMapCoordinates: () => '', validSelection: () => true },
    '@/domain/water-geometry': { waterTapRadiusM: () => 100, containsWaterPoint },
    '@/domain/zones': { circleBounds: () => ({}) },
    '@mobile-core/action-keyboard': {},
    '../action-keyboard': {},
    '../form-focus': { useNativeFieldAttributes: () => Vue.ref(), nativeFieldOf: () => undefined },
  }
  const query = { in: () => query, select: () => query, boundingClientRect: () => query, exec() {} }
  const uni = { getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812 }), createSelectorQuery: () => query,
    onWindowResize() {}, offWindowResize() {}, setStorageSync() {}, navigateBack() {} }
  function component(path: string, name: string) {
    const { descriptor } = parse(nativeSource(readFileSync(path, 'utf8')))
    const script = compileScript(descriptor, { id: name }), exports: any = {}
    runInNewContext(ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      exports, uni, setTimeout: (fn: () => void) => { timers.set(++timerId, fn); return timerId }, clearTimeout: (id: number) => timers.delete(id),
      require: (id: string) => id.endsWith('.vue') ? {} : (assert.ok(id in modules, id), modules[id]),
    })
    return exports.default
  }
  const search = component(resolve(resolveMobileProRoot(), 'packages/mobile-core/src/components/MobileSearch.vue'), 'mini-search'),
    mini = component(resolve('src/pages/map/components/MiniWaterMap.vue'), 'mini-map')
  search.render = () => null
  const props = Vue.reactive({ pick, waterPick: pick, requestId: pick ? 'isolated-water-request' : '' }), miniRef = Vue.ref<any>(), searchRef = Vue.ref<any>()
  mini.render = function () {
    const state = Vue.getCurrentInstance()!.setupState
    return Vue.h(search, { ref: searchRef, modelValue: state.focusedPlace || state.query,
      name: 'water-map-search', label: '搜索高德地点', placeholder: '城市或水域',
      live: !state.focusedPlace, autoSelectFirst: !state.focusedPlace, suggestions: state.suggestions,
      'onUpdate:modelValue': state.editSearch, onSearch: state.search, onSelect: state.choosePlace,
      onPreview: state.previewPlace, onDismiss: state.dismissSearch })
  }
  const renderer = Vue.createRenderer({ patchProp() {}, insert() {}, remove() {}, createElement: () => ({}), createText: () => ({}),
    createComment: () => ({}), setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null })
  const app = renderer.createApp({ render: () => Vue.h(mini, { ...props, ref: miniRef }) })
  app.mount({})
  const tick = async () => { for (let i = 0; i < 8; i++) { await Vue.nextTick(); await Promise.resolve() } }
  const state = () => miniRef.value.$.setupState
  return { state, props, requests, waters, hooks, auth, searchState: () => searchRef.value.$.setupState, tick,
    flush: async () => { await tick(); const jobs = [...timers.values()]; timers.clear(); jobs.forEach(fn => fn()); await tick() },
    dispose: () => app.unmount() }
}
const place = { id: 'isolated-place-a', name: '契约地标甲', address: '契约地点说明', longitude: 114.18, latitude: 30.45, crs: 'GCJ-02' }
const water = { name: '契约水域', point: [114.179, 30.449], distance: 180, source: 'live', polygon: [[[114.17, 30.44], [114.19, 30.44], [114.19, 30.46], [114.17, 30.44]]] }
test('pin drop on land snaps to nearest water without a camera request or zoom reset', async () => {
  const h = runtime()
  try {
    h.state().viewportScale = 17.65
    const before = h.state().cameraRequest, center = { ...h.state().center }
    h.state().dragPin(true); assert.equal(h.state().pinDragging, true)
    h.state().dragPin(false)
    h.state().dropPin({ longitude: 114.191234, latitude: 30.451234, radius: 100 })
    await h.tick()
    h.waters[0].resolve({ ...water, distance: 12 }); await h.tick()
    assert.equal(h.state().selected.longitude, water.point[0])
    assert.equal(h.state().selected.latitude, water.point[1])
    assert.equal(h.state().selected.name, water.name)
    assert.equal(h.state().cameraRequest, before)
    assert.equal(h.state().viewportScale, 17.65)
    assert.deepEqual({ ...h.state().center }, center)
  } finally { h.dispose() }
})
async function results(h: ReturnType<typeof runtime>) {
  h.state().editSearch('契约地标'); await h.flush()
  assert.equal(h.requests.length, 1); h.requests[0].resolve({ items: [place], hasMore: false }); await h.tick()
}

test('drag within verified water keeps the exact point; failed land drops restore the previous valid point',async()=>{
 const h=runtime()
 try{
  h.state().dropPin({longitude:114.18,latitude:30.445,radius:100});await h.tick()
  h.waters[0].resolve({...water,point:[114.18,30.445],distance:0});await h.tick()
  const count=h.waters.length
  h.state().dropPin({longitude:114.185,latitude:30.445,radius:100});await h.tick()
  assert.equal(h.waters.length,count)
  assert.equal(h.state().selected.longitude,114.185)
  assert.equal(h.state().selected.latitude,30.445)
  const last={...h.state().selected}
  h.state().dropPin({longitude:114.3,latitude:30.5,radius:100});await h.tick()
  h.waters.at(-1).resolve(undefined);await h.tick()
  assert.deepEqual({...h.state().selected},last)
  h.state().dropPin({longitude:114.3,latitude:30.5,radius:100});await h.tick()
  h.waters.at(-1).reject(new Error('provider unavailable'));await h.tick()
  assert.deepEqual({...h.state().selected},last)
 }finally{h.dispose()}
})

test('selected search result keeps the resolved water and never reopens POI results after the debounce', async () => {
  const h = runtime()
  try {
    await results(h); h.searchState().select(place.id); await h.tick()
    assert.equal(h.waters.length, 1); assert.deepEqual(Array.from(h.waters[0].point), [place.longitude, place.latitude]); assert.equal(h.waters[0].radius, 2000)
    assert.equal(typeof h.waters[0].labels, 'function', 'a committed selection verifies real water names')
    h.waters[0].resolve(water); await h.flush()
    assert.equal(h.requests.length, 1, 'setting the result label must not trigger another text search')
    assert.equal(h.state().selected.name, water.name); assert.equal(h.state().focusedPlace, water.name)
    assert.equal(h.state().places.length, 0); assert.equal(h.state().searching, false)
    assert.equal(h.state().scale, 15)
    assert.deepEqual({ ...h.state().center }, { longitude: water.point[0], latitude: water.point[1] })
  } finally { h.dispose() }
})

test('a missing water hit never confirms the land POI and lookup failures retain a retryable explanation', async () => {
  for (const failure of [false, true]) {
    const h = runtime()
    try {
      await results(h); h.searchState().select(place.id); await h.tick()
      if (failure) h.waters[0].reject(new Error('契约水域读取失败'))
      else h.waters[0].resolve(undefined)
      await h.tick()
      assert.equal(h.state().selected, null); assert.equal(h.state().water, undefined)
      assert.equal(h.state().focusedPlace, ''); assert.equal(h.state().selecting, false)
      assert.match(h.state().hint, failure ? /读取失败/ : /附近未识别到水域/)
    } finally { h.dispose() }
  }
})

test('an explicit result selection supersedes an in-flight automatic browse preview', async () => {
  const h = runtime(false)
  try {
    await results(h); assert.equal(h.waters.length, 1)
    h.searchState().select(place.id); await h.tick(); assert.equal(h.waters.length, 2)
    h.waters[1].resolve(water); await h.tick()
    h.waters[0].resolve({ ...water, name: '旧预览', point: [115, 31] }); await h.flush()
    assert.equal(h.state().selected.name, water.name); assert.equal(h.state().focusedPlace, water.name)
    assert.deepEqual({ ...h.state().center }, { longitude: water.point[0], latitude: water.point[1] })
    assert.equal(h.requests.length, 1)
  } finally { h.dispose() }
})

test('the native template wires the same focused/live/first-preview contract exercised by the real setups', () => {
  const source = readFileSync(new URL('../src/pages/map/components/MiniWaterMap.vue', import.meta.url), 'utf8')
  const search = source.match(/<MobileSearch\b[\s\S]*?\/>/)![0]
  assert.match(search, /:model-value="focusedPlace \|\| query"/)
  assert.match(search, /:live="!focusedPlace"/); assert.match(search, /:auto-select-first="!focusedPlace"/)
  assert.match(search, /@preview="previewPlace"/); assert.match(search, /@select="choosePlace"/)
})

test('editing a selected search invalidates its pending water resolution before a newer query', async () => {
  const h = runtime()
  try {
    await results(h); h.searchState().select(place.id); await h.tick(); assert.equal(h.waters.length, 1)
    h.state().editSearch('另一个地点'); const before = { ...h.state().center }; await h.tick()
    h.waters[0].resolve(water); await h.tick()
    assert.equal(h.state().selected, null); assert.equal(h.state().water, undefined)
    assert.deepEqual({ ...h.state().center }, before); assert.equal(h.state().selecting, false)
  } finally { h.dispose() }
})

test('browse mode previews the first suggestion without committing it or requesting live labels', async () => {
  const h = runtime(false)
  try {
    await results(h); assert.equal(h.waters.length, 1); assert.equal(h.waters[0].labels, undefined)
    h.waters[0].resolve(water); await h.tick()
    assert.deepEqual({ ...h.state().center }, { longitude: water.point[0], latitude: water.point[1] })
    assert.equal(h.state().scale, 15)
    assert.equal(h.state().focusedPlace, ''); assert.equal(h.state().query, '契约地标'); assert.equal(h.state().places.length, 1)
  } finally { h.dispose() }
})

test('pick mode never commits an automatic preview and hides obsolete browse previews after pan/hide', async () => {
  const pick = runtime()
  try { await results(pick); assert.equal(pick.waters.length, 0); assert.equal(pick.state().selected, null) } finally { pick.dispose() }
  for (const boundary of ['pan', 'hide', 'edit']) {
    const h = runtime(false)
    try {
      await results(h); assert.equal(h.waters.length, 1)
      if (boundary === 'pan') { h.state().interactMap(); h.state().panMap({ longitude: 115, latitude: 31 }) }
      else if (boundary === 'hide') h.hooks.hide!()
      else h.state().editSearch('新的查询')
      const before = { ...h.state().center }; h.waters[0].resolve(water); await h.tick()
      assert.deepEqual({ ...h.state().center }, before); assert.equal(h.state().selected, null)
    } finally { h.dispose() }
  }
})
