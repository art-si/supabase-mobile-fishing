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
const mode = value('--mode', 'demo')
const client = await automator.connect({ wsEndpoint: value('--endpoint', 'ws://127.0.0.1:9422') })
const routes = [
  ['feed', '/pages/home/index'],
  ['spots', '/pages/home/index?tab=spots'],
  ['messages', '/pages/home/index?tab=messages'],
  ['mine', '/pages/home/index?tab=mine'],
  ['login', '/pages/login/index'],
  ['security', '/pages/account/security'],
  ['password', '/pages/account/password'],
  ['phone', '/pages/account/phone'],
  ['settings', '/pages/settings/index'],
  ['privacy', '/pages/settings/legal?type=privacy'],
  ['terms', '/pages/settings/legal?type=terms'],
  ['contact', '/pages/settings/legal?type=contact'],
  ['post', '/pages/post/detail?id=a1111111-1111-4111-8111-111111111111'],
  ['compose', '/pages/post/compose'],
  ['spot', '/pages/spot/detail?id=b1111111-1111-4111-8111-111111111111'],
  ['spot-create', '/pages/spot/create'],
  ['map', '/pages/map/index'],
  ['map-search', '/pages/map/search'],
  ['map-marks', '/pages/map/marks'],
  ['map-bridge', '/pages/map/bridge'],
  ['chat', '/pages/chat/index?id=e1111111-1111-4111-8111-111111111111'],
  ['notifications', '/pages/notifications/index'],
  ['people', '/pages/people/index'],
  ['person', '/pages/people/detail?id=22222222-2222-4222-8222-222222222222'],
  ['library', '/pages/mine/library?type=posts'],
  ['profile', '/pages/mine/profile'],
  ['moderation', '/pages/moderation/index'],
  ['moderation-detail', '/pages/moderation/detail?type=post&id=a1111111-1111-4111-8111-111111111111'],
  ['content-reports', '/pages/content-report/index'],
  ['content-report-detail', '/pages/content-report/detail?id=missing-fixture'],
  ['water-report', '/pages/water-report/index'],
  ['water-report-history', '/pages/water-report/history']
]
const selected = value('--only', '').split(',').filter(Boolean)
const results = []
const exceptions = []
client.on('exception', (event) => exceptions.push({ message: String(event.message || event.text || 'Runtime exception') }))
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
let consecutiveFailures = 0
await mkdir(output, { recursive: true })
try {
  const info = await client.systemInfo()
  for (const [name, url] of routes) {
    if (selected.length && !selected.includes(name)) continue
    console.log(`CAPTURE ${name}`)
    try {
      // In DevTools 2.02 the legacy automator waits for a navigation callback
      // belonging to the destroyed page. Dispatch with wx, then verify the new
      // page independently instead of hanging that protocol request.
      await client.evaluate((target) => {
        // Let the automation reply leave the old page before destroying it.
        setTimeout(() => wx.reLaunch({ url: target }), 250)
        return true
      }, url)
      const expected = name === 'map-bridge' ? 'pages/map/search' : url.split('?')[0].slice(1)
      const query = Object.fromEntries(new URLSearchParams(url.split('?')[1] || ''))
      let page
      const deadline = Date.now() + 20000
      do {
        await pause(500)
        page = await client.currentPage()
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
    await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ mode, environment: 'WeChat DevTools simulator', info, results, exceptions }, null, 2))
    if (consecutiveFailures >= 2) throw new Error('Simulator is not responding reliably; stopped without claiming remaining pages passed.')
  }
} finally {
  await client.disconnect()
}
