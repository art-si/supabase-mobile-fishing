import { createRequire } from 'node:module'
import { writeFile, readFile } from 'node:fs/promises'
const require = createRequire(`${process.cwd()}/artifacts/miniapp-tools/package.json`)
const timer = setTimeout(() => process.exit(2), 25000)
process.on('unhandledRejection', error => { console.error(String(error)); process.exit(2) })
let client
try {
  client = await require('miniprogram-automator').connect({ wsEndpoint: 'ws://127.0.0.1:9440' })
  client.on('error', () => {})
  if (process.argv.includes('--open')) await client.navigateTo('/pages/map/index?pick=1&context=water')
  const wxml = await readFile('dist/build/mp-weixin/pages/map/components/NativeWaterMap.wxml', 'utf8')
  const tag = wxml.match(/<map\b[^>]+>/)?.[0] || ''
  const bindings = Object.fromEntries(['id', 'longitude', 'latitude', 'scale'].map(name => [name, tag.match(new RegExp(`\\b${name}="{{(\\w+)}}"`))?.[1]]))
  const result = await client.evaluate(async ({ bindings, lookup }) => {
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
    let map, mini
    const walk = vm => {
      if (!vm) return
      if (vm.$options.__name === 'NativeWaterMap') map = vm
      if (vm.$options.__name === 'MiniWaterMap') mini = vm
      ;(vm.$children || []).forEach(walk)
    }
    for (let i = 0; i < 12; i++) {
      walk(getCurrentPages().at(-1)?.$vm)
      if (map) break
      await delay(250)
    }
    const diagnostics = require('platforms/map-trace.js').mapDiagnostics
    const trace = diagnostics ? JSON.parse(diagnostics() || '{}') : { productEntryRemoved: true }
    let readIndex, manifest
    try {
      readIndex = require('services/bundled-water-index.js').readBundledWaterIndex
      const value = readIndex('manifest.json')
      manifest = { loaded: true, version: value.version, tiles: value.tiles.length }
    } catch (error) { manifest = { loaded: false, error: String(error.message) } }
    if (!map) return { route: getCurrentPages().at(-1)?.route, map: false, manifest, trace }
    const read = method => new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), 2000)
      wx.createMapContext(map.$scope.data[bindings.id], map.$scope)[method]({ success: r => { clearTimeout(timer); resolve(r) }, fail: () => { clearTimeout(timer); resolve(null) } })
    })
    const scale = await read('getScale')
    let resolution
    if (lookup) {
      const point = map.$props.center
      const services = require('platforms/post-location.js')
      const start = Date.now()
      const original = require('domain/water-geometry.js').waterQueryPoint([point.longitude, point.latitude])
      const key = `${Math.floor(original[0]/0.25)}_${Math.floor(original[1]/0.25)}`
      const value = readIndex?.(`${manifest.version}/${key}.json`)
      const tile = { loaded: !!value, count: value?.length }
      const local = await services.resolveNearbyWater([point.longitude, point.latitude], 2000)
      let places
      try { places = { count: (await services.searchMapWaterPlaces([point.longitude, point.latitude],2000)).length } }
      catch(error) { places = { name: error?.name, message: error?.message, code: error?.code, status: error?.status } }
      try {
        const water = await services.resolveNearbyWater([point.longitude, point.latitude], 2000, services.searchMapWaterPlaces)
        resolution = { ms: Date.now()-start, tile, places, local: !!local, found: !!water, source: water?.source, name: water?.name }
      } catch (error) { resolution = { ms: Date.now()-start, tile, places, local: !!local, error: String(error?.message || error).replace(/https?:\/\/\S+/g,'[URL]') } }
    }
    return { route: getCurrentPages().at(-1)?.route, map: true, manifest,
      nativeScale: scale?.scale, boundScale: map.$scope.data[bindings.scale],
      selected: map.$props.selected?.name, waterSource: map.$props.water?.source, pending: map.$props.operationPending, trace, resolution }
  }, { bindings, lookup: process.argv.includes('--lookup') })
  await writeFile('artifacts/mini-native-map-20261124/native-owner-live.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally {
  try { await client?.disconnect() } catch {}
  clearTimeout(timer)
}
