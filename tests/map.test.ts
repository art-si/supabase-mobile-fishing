import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { placeSelection, validSelection } from '../src/domain/map'
import { consumeSelection, returnMapSelection } from '../src/platforms/map-navigation'
import { amapServiceHost } from '../src/platforms/amap-service-host'
test('AMap receives only a first-level proxy and never a nested Edge URL', async t => {
  const backend = 'https://jupuypvmgjpnpntfetqv.supabase.co', hosted = `${backend}/functions/v1/amap-js/_AMapService`
  assert.equal(await amapServiceHost('/_AMapService', backend, 'http://127.0.0.1:5178/', false), 'http://127.0.0.1:5178/_AMapService')
  const external = 'https://map.example.com/_AMapService'
  assert.equal(await amapServiceHost(external, backend, 'capacitor://localhost/', true), external)
  await assert.rejects(amapServiceHost(hosted, backend, 'capacitor://localhost/', true))
  for (const invalid of ['', 'http://localhost/_AMapService', `${hosted}?key=value`, `${hosted}#fragment`])
    await assert.rejects(amapServiceHost(invalid, backend, 'https://localhost/', true))
  const secure = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext')
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true })
  t.after(() => { if (secure) Object.defineProperty(globalThis, 'isSecureContext', secure); else Reflect.deleteProperty(globalThis, 'isSecureContext'); Reflect.deleteProperty(navigator, 'serviceWorker') })
  for (const [page, native, configured] of [['https://localhost/', true, '/_AMapService'], ['https://art-si.github.io/supabase-mobile-fishing/', false, hosted]] as const) {
    const workers = Object.assign(new EventTarget(), { controller: { scriptURL: '' }, getRegistration: async () => undefined,
      register: async (url: string) => { workers.controller.scriptURL = url } })
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: workers })
    assert.equal(await amapServiceHost(configured, backend, page, native), new URL('/_AMapService', page).href)
    assert.equal(workers.controller.scriptURL, new URL('amap-service-worker.js', page).href)
  }
})
test('static map relay forwards only its own SDK requests, without cookies, headers or cached locations', async () => {
  const listeners = new Map(), calls: { target: string; init: RequestInit }[] = []
  const origin = 'https://art-si.github.io'
  runInNewContext(readFileSync(new URL('../src/platforms/amap-service-worker.js', import.meta.url), 'utf8'), {
    URL, Response, self: { location: { origin }, addEventListener: (name: string, listener: unknown) => listeners.set(name, listener) },
    fetch: async (target: string, init: RequestInit) => { calls.push({ target, init }); return Response.json({ ok: true }) }
  })
  const check = (url: string, method = 'GET', mode = 'cors') => {
    let answer: Promise<Response> | undefined
    listeners.get('fetch')({ request: { url, method, mode, headers: { Authorization: 'private' } }, respondWith: (value: Promise<Response>) => { answer = value } })
    return answer
  }
  const path = '/_AMapService/v3/assistant/inputtips?city=420100'
  for (const result of [check('https://other.invalid'+path), check(origin+'/auth/login'), check(origin+path, 'POST'), check(origin+path, 'GET','navigate')]) assert.equal(result, undefined)
  const response = await check(origin+path)
  assert.deepEqual(await response?.json(), { ok: true }); assert.equal(response?.headers.get('Cache-Control'), 'no-store')
  assert.equal(calls.length, 1); assert.equal(calls[0].target, 'https://jupuypvmgjpnpntfetqv.supabase.co/functions/v1/amap-js'+path)
  assert.equal(calls[0].init.credentials,'omit'); assert.equal(calls[0].init.redirect,'error'); assert.equal(calls[0].init.headers, undefined)
})
test('a selected POI fits the draft contract without inventing an address for an unnamed point', () => {
  const point: [number, number] = [120.69, 31.31]
  const place = placeSelection(point, { name: ' 名'.repeat(130), address: '路'.repeat(260), adcode: '320500' })
  assert.ok(validSelection(place)); assert.equal(place.name.length, 120)
  assert.equal(place.address?.length, 240); assert.equal(place.adcode, '320500')
  const manual = placeSelection(point)
  assert.ok(validSelection(manual)); assert.equal(manual.name, '已选位置'); assert.equal(manual.address, undefined)
})

test('map draft handoff accepts only fresh finite GCJ-02 coordinates', () => {
  const place = {
    longitude: 120.12,
    latitude: 31.12,
    name: '河',
    crs: 'GCJ-02',
    created_at: 1000000
  }
  assert.equal(validSelection(place, 1000001), true)
  for (const invalid of [
    null,
    {},
    { ...place, crs: 'WGS84' },
    { ...place, latitude: Infinity },
    { ...place, longitude: '120' },
    { ...place, name: '' },
    { ...place, created_at: 2000000 },
    { ...place, created_at: NaN }
  ])
    assert.equal(validSelection(invalid, 1000001), false)
  assert.equal(validSelection(place, 1600000), false)
})
test('map selections only reach a calling form and failed navigation cannot leak an old choice', t => {
  const stored = new Map<string, unknown>(), notices: string[] = []
  let stack = 1, canReturn = true, quotaFull = false
  Object.assign(globalThis, { getCurrentPages: () => Array(stack), uni: {
    setStorageSync(key: string, value: unknown) { if (quotaFull) throw new Error('quota'); stored.set(key, value) },
    getStorageSync: (key: string) => stored.get(key), removeStorageSync: (key: string) => stored.delete(key),
    navigateBack(options: { fail(): void }) { if (!canReturn) options.fail() }
  } })
  t.after(() => { Reflect.deleteProperty(globalThis, 'uni'); Reflect.deleteProperty(globalThis, 'getCurrentPages') })
  const submit = () => returnMapSelection('test', { name: '测试水域', crs: 'GCJ-02', latitude: 30, longitude: 114, created_at: 0 }, message => notices.push(message))
  submit(); assert.match(notices.pop()!, /重新打开地图/); assert.equal(stored.size, 0)
  stack = 2; quotaFull = true; submit(); assert.match(notices.pop()!, /未能暂存/); assert.equal(stored.size, 0)
  quotaFull = false; canReturn = false; submit(); assert.match(notices.pop()!, /返回失败/); assert.equal(stored.size, 0)
  canReturn = true; submit(); assert.equal(consumeSelection('test')?.name, '测试水域'); assert.equal(consumeSelection('test'), null)
  assert.deepEqual(notices, [])
})
