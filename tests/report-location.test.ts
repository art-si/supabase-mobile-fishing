import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

type Position = { longitude: number; latitude: number }
const point = { longitude: 114.3, latitude: 30.5 }
const address = { province: '湖北省', city: '武汉市', district: '蔡甸区', adcode: '420114', citycode: '027' }

// Compile the actual platform branches with isolated permission/GPS/geocoder fixtures.
// These tests never request device location, authenticate or call a remote map service.
function platformSource(source: string, platform: string) {
  const enabled = [true]
  return source.split('\n').filter(line => {
    const directive = line.match(/^\s*\/\/ #(ifdef|ifndef|endif)(?:\s+(.+))?/)
    if (!directive) return enabled.at(-1)
    if (directive[1] === 'endif') enabled.pop()
    else {
      const matches = directive[2]?.split(/\s*\|\|\s*/).includes(platform)
      enabled.push(Boolean(enabled.at(-1)) && (directive[1] === 'ifdef' ? matches : !matches))
    }
    return false
  }).join('\n')
}

function harness(options: {
  platform?: string; position?: Position | null
  wait?: (entry: { value: Position | null }) => Promise<void>
  capture?: () => Promise<Position>; region?: () => Promise<unknown>
} = {}) {
  const entry = { value: options.position === undefined ? point : options.position }
  let captures = 0, waits = 0, browserCaptures = 0
  const lookups: unknown[][] = [], imports: string[] = []
  const modules: Record<string, unknown> = {
    '@/domain/rules': { validCoordinates: (lng: number, lat: number) => Number.isFinite(lng) && Math.abs(lng) <= 180 && Number.isFinite(lat) && Math.abs(lat) <= 90 },
    '@/domain/regions': { districtOptions: [{ id: '420114', name: '蔡甸区', city: '武汉市' }] },
    '@/services/amap': { lookupMapRegion: async (...args: unknown[]) => { lookups.push(args); return options.region ? options.region() : address } },
    '@/services/entry-location': { entryPosition: entry, waitForEntryLocation: async () => { waits++; await options.wait?.(entry) } },
    './entry-location': { captureEntryLocation: async () => { captures++; return options.capture ? options.capture() : point } },
    './amap': { locate: async () => { browserCaptures++; return { point: [point.longitude, point.latitude] } }, loadAmap: async () => { throw new Error('isolated SDK failure') }, timed: (pending: Promise<unknown>) => pending }
  }
  const api: Record<string, any> = {}
  const source = platformSource(readFileSync(new URL('../src/platforms/report-location.ts', import.meta.url), 'utf8'), options.platform || 'MP-WEIXIN')
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: api, require: (id: string) => { imports.push(id); assert.ok(id in modules, id); return modules[id] }
  })
  return { api, entry, lookups, imports, calls: () => ({ captures, waits, browserCaptures }) }
}

test('WeChat reporting is supported and resolves the authorized entry fix without asking for location again', async () => {
  const state = harness()
  assert.equal(state.api.canLocateReport, true)
  const result = await state.api.locateReport()
  assert.deepEqual({ ...result }, { ...point, province: address.province, city: address.city, district: address.district, areaCode: '027', location_label: '' })
  assert.deepEqual(state.lookups, [[114.3, 30.5]])
  assert.deepEqual(state.calls(), { captures: 0, waits: 1, browserCaptures: 0 })
  assert.equal(state.imports.includes('./amap'), false)
})

test('an in-flight entry request is shared before resolving the report region', async () => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const state = harness({ position: null, wait: async entry => { await pending; entry.value = point } })
  const result = state.api.locateReport()
  assert.equal(state.lookups.length, 0)
  assert.equal(state.calls().captures, 0)
  release()
  assert.equal((await result).district, '蔡甸区')
  assert.equal(state.calls().captures, 0)
})

test('without an entry fix the real WeChat location adapter remains the fallback', async () => {
  const state = harness({ position: null })
  assert.equal((await state.api.locateReport()).city, '武汉市')
  assert.equal(state.calls().captures, 1)
  assert.deepEqual(state.lookups, [[114.3, 30.5]])
  const denied = harness({ position: null, capture: async () => { throw new Error('LOCATION_DENIED') } })
  await assert.rejects(denied.api.locateReport(), { message: 'LOCATION_DENIED' })
  assert.equal(denied.lookups.length, 0)
})

test('invalid coordinates and unresolved regions fail without inventing a report location', async () => {
  const invalid = harness({ position: { longitude: NaN, latitude: 30.5 } })
  await assert.rejects(invalid.api.locateReport(), { message: '水域坐标无效，请重新选点。' })
  assert.equal(invalid.lookups.length, 0)
  const missing = harness({ region: async () => null })
  await assert.rejects(missing.api.locateReport(), { message: '无法识别所选水域的地区。' })
  const fallback = harness({ region: async () => ({ ...address, city: '', district: '' }) })
  assert.equal((await fallback.api.locateReport()).city, '武汉市')
  assert.equal((await fallback.api.locateReport()).district, '蔡甸区')
})

test('H5 retains its browser location path and unsupported platforms do not request GPS', async () => {
  const h5 = harness({ platform: 'H5' })
  assert.equal(h5.api.canLocateReport, true)
  assert.equal((await h5.api.locateReport()).city, '武汉市')
  assert.deepEqual(h5.calls(), { captures: 0, waits: 0, browserCaptures: 1 })
  assert.equal(h5.imports.includes('@/services/entry-location'), false)
  const state = harness({ platform: 'APP-PLUS' })
  assert.equal(state.api.canLocateReport, false)
  await assert.rejects(state.api.locateReport(), { message: '当前环境可手动选择地区和地点。' })
  assert.deepEqual(state.calls(), { captures: 0, waits: 0, browserCaptures: 0 })
  assert.equal(state.lookups.length, 0)
})
