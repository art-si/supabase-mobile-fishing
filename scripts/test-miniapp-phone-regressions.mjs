// Read-only checks in the real, already-authenticated formal DevTools project.
// No injected account/GPS, draft edits, uploads or business writes. Not a phone result.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { confirmedAppId } from './miniapp-release-config.mjs'
const require = createRequire(`${process.cwd()}/artifacts/miniapp-tools/package.json`)
const client = await require('miniprogram-automator').connect({ wsEndpoint: 'ws://127.0.0.1:9440' })
const output = 'artifacts/weixin-resume-20261123/phone-native-pages'
await mkdir(output, { recursive: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function state() {
  return client.evaluate(() => {
    const page = getCurrentPages().slice(-1)[0], fields = [], videos = []
    function visit(vm) {
      if (!vm) return
      const name = vm.$options.__name, props = vm.$props || {}
      if (name === 'MobileField') fields.push({ label: props.label, valueFilled: !!String(props.modelValue || '').trim() })
      if (name === 'MobileMediaGallery' && props.media?.some(asset => asset.kind === 'video')) {
        let poster = false
        function inspect(value) {
          if (typeof value === 'string' && value.startsWith('data:image/png;base64,')) poster = true
          else if (Array.isArray(value)) value.forEach(inspect)
          else if (value && typeof value === 'object') Object.values(value).forEach(inspect)
        }
        inspect(vm.$scope.data)
        videos.push({ count: props.media.filter(asset => asset.kind === 'video').length, poster })
      }
      if (name === 'ReportRegionFields') fields.push({ label: 'incident-region',
        valueFilled: !!props.province && !!props.city && !!props.district })
      ;(vm.$children || []).forEach(visit)
    }
    visit(page?.$vm)
    return { route: page?.route, ready: !!page?.$vm, fields, videos }
  })
}
async function waitFor(route, predicate = () => true, attempts = 45) {
  for (let n = 0; n < attempts; n++) {
    const current = await state()
    if (current.ready && current.route === route && predicate(current)) return current
    await sleep(400)
  }
  throw new Error(`DevTools page did not settle: ${route}`)
}
const result = { checkedAt: new Date().toISOString(), boundary: 'Real formal DevTools project and existing session/data. Native API support and decoded posters are observations; physical-phone decoding/rotation/gestures remain unverified. No account, GPS or business data fixtures, no field edits, uploads or remote business writes.' }
try {
  const identity = await client.evaluate(() => ({ platform: wx.getDeviceInfo().platform, appId: wx.getAccountInfoSync().miniProgram.appId }))
  assert.equal(identity.platform, 'devtools'); assert.equal(identity.appId, confirmedAppId)
  await client.callWxMethod('reLaunch', { url: '/pages/home/index' })
  await waitFor('pages/home/index')
  let home
  for (let n = 0; n < 45; n++) {
    home = await state()
    if (home.videos.some(item => item.poster)) break
    await sleep(400)
  }
  result.feed = { videos: home.videos, note: 'Only already-rendered feed items; no new post was created.' }
  await client.screenshot({ path: `${output}/feed.png` })
  await client.callWxMethod('navigateTo', { url: '/pages/post/compose' })
  const compose = await waitFor('pages/post/compose', value => value.fields.some(field => field.label === '标题'))
  assert.ok(compose.fields.some(field => field.label === '今天的渔获'))
  result.compose = { rendered: true, titleAndBody: true }
  await client.screenshot({ path: `${output}/compose.png` })
  await client.callWxMethod('reLaunch', { url: '/pages/home/index' })
  await waitFor('pages/home/index')
  await client.callWxMethod('navigateTo', { url: '/pages/water-report/index?tabbed=1' })
  const report = await waitFor('pages/water-report/index', value => value.fields.some(field => field.label === 'incident-region' && field.valueFilled))
  result.report = { rendered: true, incidentRegionFilled: true, note: 'Existing owner draft preserved. New-draft and overwrite guards are separately covered by isolated page tests.' }
  await client.screenshot({ path: `${output}/report.png` })
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  await client.screenshot({ path: `${output}/failure.png` }).catch(() => {})
  result.error = error.message
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2))
  console.error(JSON.stringify(result)); process.exitCode = 1
} finally {
  await client.callWxMethod('reLaunch', { url: '/pages/home/index' }).catch(() => {})
  client.disconnect()
}
