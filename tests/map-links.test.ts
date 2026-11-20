import test from 'node:test'
import assert from 'node:assert/strict'
import { mapLinks } from '../src/_mobile-core/map-links'
test('exact spot navigation preserves destination and approximate locations remain searches', () => {
  const place = { label: '桥头 & 安全入口', longitude: 114.18, latitude: 30.48, navigation: true }
  const amap = new URL(mapLinks('amap', place).app),
    baidu = new URL(mapLinks('baidu', place).app)
  assert.equal(amap.pathname, '/navigation')
  assert.equal(amap.searchParams.get('to'), `114.18,30.48,${place.label}`)
  assert.equal(amap.searchParams.get('coordinate'), 'gaode')
  assert.equal(baidu.pathname, '/direction')
  assert.equal(baidu.searchParams.get('destination'), `latlng:30.48,114.18|name:${place.label}`)
  assert.equal(baidu.searchParams.get('coord_type'), 'gcj02')
  assert.equal(new URL(mapLinks('amap', { ...place, approximate: true }).app).pathname, '/search')
})
test('map links preserve GCJ-02 and provider coordinate order without injecting query values', () => {
  const place = { label: '河段 & 桥头 #1', longitude: 114.18, latitude: 30.48 }
  const amap = new URL(mapLinks('amap', place).app)
  assert.equal(amap.origin, 'https://uri.amap.com')
  assert.equal(amap.pathname, '/marker')
  assert.equal(amap.searchParams.get('position'), '114.18,30.48')
  assert.equal(amap.searchParams.get('coordinate'), 'gaode')
  assert.equal(amap.searchParams.get('name'), place.label)
  assert.equal(amap.searchParams.get('callnative'), '1')
  const baidu = mapLinks('baidu', place, 'ios'),
    app = new URL(baidu.app),
    web = new URL(baidu.web)
  assert.equal(app.protocol, 'baidumap:')
  assert.equal(app.searchParams.get('location'), '30.48,114.18')
  assert.equal(app.searchParams.get('coord_type'), 'gcj02')
  assert.equal(app.searchParams.get('title'), place.label)
  assert.equal(web.origin, 'https://api.map.baidu.com')
  assert.equal(web.searchParams.get('output'), 'html')
})
test('approximate post positions and legacy labels search the shared name instead of faking exact navigation', () => {
  const place = { label: '湖北武汉某湖附近', longitude: 114.18, latitude: 30.48, approximate: true }
  const amap = new URL(mapLinks('amap', place).app),
    baidu = new URL(mapLinks('baidu', place).app)
  assert.equal(amap.pathname, '/search')
  assert.equal(amap.searchParams.get('keyword'), place.label)
  assert.equal(amap.searchParams.has('position'), false)
  assert.equal(baidu.pathname, '/geocoder')
  assert.equal(baidu.searchParams.get('address'), place.label)
  assert.equal(baidu.searchParams.has('location'), false)
  assert.equal(new URL(mapLinks('amap', { label: '只有文字的地点' }).web).pathname, '/search')
  assert.equal(
    new URL(mapLinks('baidu', { label: '坐标异常', longitude: Infinity, latitude: 30 }).web)
      .pathname,
    '/geocoder'
  )
  assert.throws(() => mapLinks('amap', { label: '  ' }))
})
