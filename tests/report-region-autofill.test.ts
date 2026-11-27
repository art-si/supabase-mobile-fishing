import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import * as rules from '../src/domain/rules'
import * as water from '../src/domain/water-report'

const located = { province: '湖北省', city: '武汉市', district: '蔡甸区', location_label: '', longitude: 114.3, latitude: 30.5 }
const ownerId = '11111111-1111-4111-8111-111111111111'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

// Execute the actual page setup with real Vue reactivity and isolated GPS/storage/session fixtures.
// No real login, device location, cloud material write or government contact is performed.
function harness(options: { saved?: object; locate?: () => Promise<typeof located>; water?: () => Promise<{name:string;longitude:number;latitude:number}>; describe?: (point:[number,number])=>Promise<typeof located>; guest?: boolean; nativeOptions?: Record<string,string> } = {}) {
  const source = readFileSync(new URL('../src/pages/water-report/index.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]
  const exported = ['prepareDraft', 'currentLocation', 'draft', 'photos', 'publicRegion', 'currentRegion', 'locating', 'locationMessage', 'editing', 'applySelectedPlace', 'id', 'tab']
  const api: Record<string, any> = {}, storage = new Map<string, unknown>()
  const auth = vue.reactive({ userId: options.guest ? '' : ownerId, context: 1 }), sessionScope = vue.ref(1)
  const available = vue.computed(() => Boolean(auth.userId))
  const hooks: Record<string, Array<(...args: any[]) => unknown>> = {}
  const mounts:Array<()=>void>=[]
  let mounted=false
  let accountReset: () => void = () => {}, requests = 0
  const describeCalls:[number,number][]=[]
  if (options.saved) storage.set(`dyj.live.draft.${ownerId}.water-report`, options.saved)
  const modules: Record<string, unknown> = {
    vue:{...vue,onMounted:(fn:()=>void)=>mounts.push(fn)},
    '@dcloudio/uni-app': Object.fromEntries(['onLoad', 'onShow', 'onHide', 'onUnload', 'onReachBottom'].map(name => [name, (callback: () => void) => { (hooks[name] ||= []).push(callback) }])),
    '@/domain/water-report': water,
    '@/domain/rules': rules,
    '@/stores/auth': { useAuthStore: () => auth },
    '@/composables/useDraftOwner': { useDraftOwner: (reset: () => void) => { accountReset = reset; return { owner: vue.computed(() => auth.userId), available, resetting: vue.ref(false) } } },
    '@/composables/useMutation': { useMutation: () => ({ busy: vue.ref(false), error: vue.ref(''), run: (fn: () => unknown) => fn() }) },
    '@/composables/useListRefresh': { useListRefresh: () => {} },
    '@/services/session': { sessionScope, assertSession: (version: number) => { assert.equal(version, sessionScope.value) } },
    '@/services/media': { resolvePhotos: async () => {} },
    '@/services/repository': { read: async () => undefined },
    // These cases leave normally; native-picker ownership has separate real-adapter tests.
    '@mobile-core/media-picker-session': { preserveMediaPickerPage: () => false, resumeMediaPickerPage: () => false },
    '@/platforms/report-location': { canLocateReport: true, locateReport: async () => { requests++; return options.locate ? options.locate() : located }, describeReportLocation: async (point:[number,number]) => {describeCalls.push(point);return options.describe?options.describe(point):located} },
    '@/platforms/map-navigation': { consumeSelection: () => null },
    '@/platforms/water-location': {waterAt:options.water || (async()=>{throw new Error('no nearby water')})},
  }
  const scope = vue.effectScope()
  scope.run(() => runInNewContext(ts.transpileModule(`${source}\nexport { ${exported.join(',')} }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, {
    exports: api,
    defineExpose:(value:unknown)=>{api.exposed=value},
    require: (id: string) => modules[id] || { default: {} },
    uni: { getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: unknown) => storage.set(key, value), pageScrollTo: () => {} },
    getCurrentPages:()=>[{route:'pages/water-report/index',options:options.nativeOptions||{tabbed:'1'}}]
  }))
  const mount=()=>{if(!mounted){mounted=true;mounts.forEach(fn=>fn())}}
  const show=()=>hooks.onShow?.forEach(fn=>fn())
  const prepare=api.prepareDraft
  api.prepareDraft=async()=>{const pending=prepare();show();mount();await pending}
  return {
    api, auth, sessionScope, describeCalls, requests: () => requests, stop: () => scope.stop(),
    hide: () => hooks.onHide?.forEach(fn => fn()), show, mount,
    load:(value:Record<string,string>={tabbed:'1'})=>hooks.onLoad?.forEach(fn=>fn(value)),
    changeOwner: () => { auth.userId = '22222222-2222-4222-8222-222222222222'; sessionScope.value++; accountReset() }
  }
}

async function settle() { await new Promise(resolve => setImmediate(resolve)); await vue.nextTick() }
const saved = () => ({ ...water.freshWaterReport(), description: '此前保存的现场说明', _edited: true })

test('blank new incident defaults to nearest water and preserves manual edits while lookup is pending',async()=>{
 const nearest={name:'南太子湖',longitude:114.2,latitude:30.49}
 const state=harness({water:async()=>nearest,describe:async()=>({...located,...nearest})})
 try{
  await state.api.prepareDraft();await settle()
  assert.equal(state.api.draft.value.location_label,nearest.name)
  assert.equal(state.api.draft.value.longitude,nearest.longitude)
  assert.equal(state.api.draft.value.district,'蔡甸区')
 }finally{state.stop()}
 const pending=deferred<typeof nearest>()
 const edited=harness({water:()=>pending.promise})
 try{
  await edited.api.prepareDraft();await settle()
  edited.api.draft.value.location_label='我自己填写的事发水域'
  pending.resolve(nearest);await settle()
  assert.equal(edited.api.draft.value.location_label,'我自己填写的事发水域')
  assert.equal(edited.api.draft.value.longitude,null)
 }finally{edited.stop()}
})

test('saved water and another selected jurisdiction do not get replaced by current nearby water',async()=>{
 let calls=0
 for(const draft of [
  {...saved(),location_label:'旧水域'},
  {...saved(),province:'浙江省',city:'杭州市',district:'西湖区'}
 ]){
  const state=harness({saved:draft,water:async()=>{calls++;return {name:'新水域',longitude:114.2,latitude:30.49}}})
  try{await state.api.prepareDraft();await settle();assert.equal(state.api.draft.value.location_label,draft.location_label)}finally{state.stop()}
 }
 assert.equal(calls,0)
})

test('native first onLoad/onShow/mounted initializes and fills exactly once after the page is ready', async()=>{
 const state=harness()
 try{
  state.load();await settle();assert.equal(state.requests(),0)
  state.show();await settle();assert.equal(state.requests(),0)
  state.mount();await settle()
  assert.equal(state.requests(),1);assert.equal(state.api.draft.value.district,'蔡甸区')
  state.show();state.mount();await settle();assert.equal(state.requests(),1)
 }finally{state.stop()}
})

test('an early native onShow is recovered on mount, and mount before onShow waits for foreground',async()=>{
 for(const order of ['show-first','mount-first']){
  const state=harness()
  try{
   if(order==='show-first'){state.show();state.mount()}
   else{state.mount();await settle();assert.equal(state.requests(),0);state.show()}
   await settle();assert.equal(state.requests(),1);assert.equal(state.api.draft.value.city,'武汉市')
  }finally{state.stop()}
 }
 const record=harness({nativeOptions:{id:'existing-report',tabbed:'1'}})
 try{record.show();record.mount();await settle();assert.equal(record.api.id.value,'existing-report');assert.equal(record.api.tab.value,'records');assert.equal(record.requests(),0)}finally{record.stop()}
})

test('text or attachment drafts with no incident location receive only the current region', async () => {
  for (const draft of [saved(), { ...saved(), description: '', media: [{ id: 'photo-1', path: 'private/photo.jpg', kind: 'image' }] }]) {
    const state = harness({ saved: draft })
    try {
      await state.api.prepareDraft(); await settle()
      assert.equal(state.api.draft.value.id, draft.id)
      assert.equal(state.api.draft.value.description, draft.description)
      assert.equal(state.api.draft.value.media.length, draft.media.length)
      assert.equal(state.api.draft.value.province, '湖北省')
      assert.equal(state.api.draft.value.city, '武汉市')
      assert.equal(state.api.draft.value.district, '蔡甸区')
      assert.equal(state.api.draft.value.location_label, '')
      assert.equal(state.api.draft.value.longitude, null)
      assert.equal(state.api.draft.value.latitude, null)
    } finally { state.stop() }
  }
})

test('any nonempty incident region or edited record is preserved', async () => {
  for (const manual of [{ province: '浙江省' }, { city: '宁波市' }, { district: '海曙区' }]) {
    const draft = { ...saved(), ...manual }
    const state = harness({ saved: draft })
    try {
      await state.api.prepareDraft(); await settle()
      for (const key of ['province', 'city', 'district', 'location_label', 'longitude', 'latitude'])
        assert.equal(state.api.draft.value[key], draft[key as keyof typeof draft])
    } finally { state.stop() }
  }
  const state = harness()
  try {
    state.api.editing.value = { id: 'editing-an-existing-report' }
    await state.api.currentLocation(true); await settle()
    assert.equal(state.api.draft.value.province, '')
  } finally { state.stop() }
})

test('a retained water name with empty region receives defaults without clearing other draft fields',async()=>{
 const draft={...saved(),location_label:'此前手记的水域名'}
 const state=harness({saved:draft})
 try{
  state.load();state.show();state.mount();await settle()
  assert.equal(state.api.draft.value.city,'武汉市')
  assert.equal(state.api.draft.value.location_label,draft.location_label)
  assert.equal(state.api.draft.value.description,draft.description)
  assert.equal(state.api.draft.value.id,draft.id)
  assert.equal(state.api.draft.value.longitude,null)
 }finally{state.stop()}
})

test('a retained incident point resolves its own region without replacing its name or using current-city labels',async()=>{
 const draft={...saved(),location_label:'此前手选的宁波水面',longitude:121.5,latitude:29.8}
 const state=harness({saved:draft,describe:async()=>({...located,province:'浙江省',city:'宁波市',district:'海曙区',longitude:121.5,latitude:29.8})})
 try{
  await state.api.prepareDraft();await settle()
  assert.equal(state.api.draft.value.city,'宁波市')
  assert.equal(state.api.currentRegion.value.city,'武汉市')
  assert.equal(state.api.draft.value.location_label,draft.location_label)
  assert.equal(state.api.draft.value.longitude,121.5);assert.equal(state.api.draft.value.latitude,29.8)
  assert.deepEqual(Array.from(state.describeCalls[0]),[121.5,29.8])
 }finally{state.stop()}
})

test('map quota failures remain observable without hiding the reason and a later page entry can recover',async()=>{
 let attempts=0
 const state=harness({locate:async()=>{if(++attempts===1)throw Object.assign(new Error('private provider diagnostic'),{code:'MAP_QUOTA_EXCEEDED'});return located}})
 try{
  await state.api.prepareDraft();await settle()
  const status=state.api.exposed.reportLocationState()
  assert.equal(status.locationError,'MAP_QUOTA_EXCEEDED')
  assert.match(status.locationMessage,/地区查询暂时繁忙/)
  assert.equal(status.region.city,'')
  assert.equal('longitude' in status,false);assert.equal('description' in status,false)
  state.hide();state.show();await settle()
  assert.equal(state.api.draft.value.city,'武汉市')
  assert.equal(state.api.exposed.reportLocationState().locationError,'')
 }finally{state.stop()}
})

test('late location cannot overwrite a region or place selected while the lookup was pending', async () => {
  const pending = deferred<typeof located>(), state = harness({ locate: () => pending.promise })
  try {
    await state.api.prepareDraft()
    Object.assign(state.api.draft.value, { province: '浙江省', city: '宁波市', district: '海曙区', location_label: '手选水面' })
    pending.resolve(located); await settle()
    assert.equal(state.api.draft.value.province, '浙江省')
    assert.equal(state.api.draft.value.city, '宁波市')
    assert.equal(state.api.draft.value.location_label, '手选水面')
  } finally { state.stop() }
})

test('foreground resumes an interrupted blank-region lookup once and ignores the previous result', async () => {
  const first = deferred<typeof located>(), second = deferred<typeof located>()
  let attempt = 0
  const state = harness({ saved: saved(), locate: () => (++attempt === 1 ? first.promise : second.promise) })
  try {
    await state.api.prepareDraft()
    assert.equal(state.requests(), 1)
    state.hide(); state.show(); state.show()
    assert.equal(state.requests(), 2)
    first.resolve({ ...located, province: '旧回调地区' }); await settle()
    assert.equal(state.api.draft.value.province, '')
    assert.equal(state.api.locating.value, true)
    second.resolve(located); await settle()
    assert.equal(state.api.draft.value.province, '湖北省')
    assert.equal(state.api.locating.value, false)
    state.hide(); state.show()
    assert.equal(state.requests(), 2)
  } finally { state.stop() }
})

test('account changes and hidden pages reject previous location callbacks', async () => {
  const pending = deferred<typeof located>(), state = harness({ locate: () => pending.promise })
  try {
    await state.api.prepareDraft()
    state.hide()
    pending.resolve(located); await settle()
    assert.equal(state.api.draft.value.province, '')
  } finally { state.stop() }
  const old = deferred<typeof located>(), fresh = deferred<typeof located>()
  let attempt = 0
  const switched = harness({ locate: () => ++attempt === 1 ? old.promise : fresh.promise })
  try {
    await switched.api.prepareDraft()
    switched.changeOwner(); await settle()
    old.resolve({ ...located, province: '上个账号迟到的地区' }); await settle()
    assert.equal(switched.api.draft.value.province, '')
    fresh.resolve(located); await settle()
    assert.equal(switched.api.draft.value.province, '湖北省')
  } finally { switched.stop() }
})

test('a guest current-location refresh preserves a manually chosen public directory region', async () => {
  const state = harness({ guest: true })
  try {
    Object.assign(state.api.publicRegion.value, { province: '浙江省', city: '宁波市', district: '海曙区' })
    await state.api.currentLocation()
    assert.equal(state.api.publicRegion.value.city, '宁波市')
  } finally { state.stop() }
})
