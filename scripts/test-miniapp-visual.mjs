// Run against the actual WeChat simulator. Screenshots are evidence for manual
// review, not an automatic claim that the UI or real-device flows passed.
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const value = (key, fallback) => {
  const index = process.argv.indexOf(key)
  return index < 0 ? fallback : process.argv[index + 1]
}
const sdkRoot = resolve(value('--sdk-root', 'artifacts/miniapp-tools'))
const require = createRequire(resolve(sdkRoot, 'package.json'))
const automator = require('miniprogram-automator')
const output = resolve(value('--output', 'artifacts/miniapp-acceptance/pages'))
const detail = (path, id) => id ? `${path}?id=${encodeURIComponent(id)}` : path
const client = await automator.connect({ wsEndpoint: value('--endpoint', 'ws://127.0.0.1:9422') })
const routes = [
  ['feed', '/pages/home/index'],
  ['spots', '/pages/home/index?tab=spots'],
  ['report-tab', '/pages/water-report/index?tabbed=1'],
  ['mine', '/pages/home/index?tab=mine'],
  ['login', '/pages/login/index'],
  ['security', '/pages/account/security'],
  ['password', '/pages/account/password'],
  ['phone', '/pages/account/phone'],
  ['connections', '/pages/account/connections'],
  ['settings', '/pages/settings/index'],
  ['privacy', '/pages/settings/legal?type=privacy'],
  ['terms', '/pages/settings/legal?type=terms'],
  ['contact', '/pages/contact/index'],
  ['post', detail('/pages/post/detail', process.env.FISHING_VISUAL_POST_ID)],
  ['compose', '/pages/post/compose'],
  ['spot', detail('/pages/spot/detail', process.env.FISHING_VISUAL_SPOT_ID)],
  ['spot-create', '/pages/spot/create'],
  ['spot-discover', '/pages/spot/discover'],
  ['map', '/pages/map/index'],
  ['map-pick', '/pages/map/index?pick=1&requestId=simulator-review'],
  ['map-search', '/pages/map/search'],
  ['map-marks', '/pages/map/marks'],
  ['map-bridge', '/pages/map/bridge'],
  ['notifications', '/pages/notifications/index'],
  ['person', detail('/pages/people/detail', process.env.FISHING_VISUAL_PERSON_ID)],
  ['library', '/pages/mine/library?type=posts'],
  ['profile', '/pages/mine/profile'],
  ['moderation', '/pages/moderation/index'],
  ['moderation-detail', detail('/pages/moderation/detail', process.env.FISHING_VISUAL_POST_ID)],
  ['content-reports', '/pages/content-report/index'],
  ['content-report-detail', detail('/pages/content-report/detail', process.env.FISHING_VISUAL_REPORT_ID)],
  ['water-report', '/pages/water-report/index'],
  ['water-report-history', '/pages/water-report/history']
]
const selected = value('--only', '').split(',').filter(Boolean)
const destinations = {
  'map-bridge': '/pages/map/index',
  'spot-discover': '/pages/home/index?tab=spots',
  'water-report-history': '/pages/water-report/index?tab=records'
}
const results = []
const exceptions = []
client.on('exception', (event) => exceptions.push({ message: String(event.message || event.text || 'Runtime exception') }))
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
let consecutiveFailures = 0
await mkdir(output, { recursive: true })
try {
  const info = await client.evaluate(() => wx.getSystemInfoSync())
  if (process.argv.includes('--signed-in')) {
    const signedIn = await client.evaluate(() => Boolean(getCurrentPages().at(-1)?.$vm?.$pinia?._s.get('fishing-auth')?.signedIn))
    if (!signedIn) throw new Error('请先在小程序中正常登录，再采集已登录界面。')
  }
  for (const [name, url] of routes) {
    if (selected.length && !selected.includes(name)) continue
    console.log(`CAPTURE ${name}`)
    try {
      // Use the native callback for navigation. Running wx.reLaunch through
      // App.callFunction can leave a stale webview in DevTools 2.02; the SDK's
      // higher-level reLaunch also reads legacy page metadata afterwards.
      await client.callWxMethod('reLaunch', { url })
      const [path, search = ''] = (destinations[name] || url).split('?')
      const expected = path.slice(1)
      const query = Object.fromEntries(new URLSearchParams(search))
      let page
      const deadline = Date.now() + 20000
      do {
        await pause(500)
        // Read the app's own route state. DevTools 2.02 can temporarily lose its
        // legacy webview metadata even while the application is running.
        page = await client.evaluate(() => {
          const current = getCurrentPages().at(-1)
          return current ? { path: current.route, query: current.options || {} } : null
        }).catch(() => null)
        if (page?.path === expected && Object.entries(query).every(([key, value]) => page.query[key] === value)) break
      } while (Date.now() < deadline)
      if (page?.path !== expected || !Object.entries(query).every(([key, value]) => page.query[key] === value)) {
        throw new Error(`Navigation did not complete: ${page?.path}, expected ${expected}`)
      }
      await pause(700)
      // glass-easel's document proxy reports only the viewport through the
      // legacy SDK Page.size(). Use WeChat's own selector API for long pages.
      const viewport = await client.evaluate(() => new Promise((done) => {
        wx.createSelectorQuery().selectViewport().scrollOffset().exec((items) => done(items[0]))
      }))
      const size = { width: viewport.scrollWidth, height: viewport.scrollHeight }
      const screens = []
      const maximum = Math.max(0, size.height - info.windowHeight)
      const positions = [0]
      // Every section of a long form must be seen; do not only inspect its ends.
      for (let top = info.windowHeight * 0.75; top < maximum; top += info.windowHeight * 0.75) positions.push(Math.round(top))
      if (maximum > 8) positions.push(Math.ceil(maximum))
      for (const [index, top] of positions.entries()) {
        await client.evaluate((scrollTop) => { wx.pageScrollTo({ scrollTop, duration: 0 }); return true }, top)
        await pause(160)
        const filename = `${name}-${index}.png`
        await client.screenshot({ path: resolve(output, filename) })
        const actualTop = await client.evaluate(() => new Promise((done) => {
          wx.createSelectorQuery().selectViewport().scrollOffset().exec((items) => done(items[0].scrollTop))
        }))
        screens.push({ file: filename, scrollTop: actualTop })
      }
      results.push({ name, requested: url, actual: page.path, size, screens, review: 'pending' })
      consecutiveFailures = 0
      console.log(`SAVED ${name} (${screens.length} views; ${size.width} x ${size.height})`)
    } catch (error) {
      results.push({ name, requested: url, error: String(error.message || error), review: 'blocked' })
      consecutiveFailures++
      console.log(`FAILED ${name}: ${String(error.message || error).slice(0,160)}`)
    }
    await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ environment: 'WeChat DevTools simulator', info, results, exceptions }, null, 2))
    if (consecutiveFailures >= 2) throw new Error('Simulator is not responding reliably; stopped without claiming remaining pages passed.')
  }
} finally {
  await client.disconnect()
}
if (results.some(result => result.error) || exceptions.length) process.exitCode = 1
