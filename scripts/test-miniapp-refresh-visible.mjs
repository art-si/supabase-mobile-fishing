// Real DevTools refresh UI. No session, location, response or duration fixtures.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const output = resolve('artifacts/mini-native-map-20261124/refresh-live')
await mkdir(output, { recursive: true })
const require = createRequire(resolve('artifacts/miniapp-tools/package.json'))
const deadline = setTimeout(() => { console.error('DevTools refresh observation timed out'); process.exit(2) }, 55000)
const client = await require('miniprogram-automator').connect({ wsEndpoint: 'ws://127.0.0.1:9440' })
const result = { physicalPhone: false, requestFixtures: false, lists: [] }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function indicator() {
  return client.evaluate(() => {
    const page = getCurrentPages().at(-1)
    let shell, contentReady = false
    function walk(vm) {
      if (!vm) return
      if ((vm.$options?.__name || vm.$options?.name) === 'FishingShell') shell = vm
      if (['FeedView', 'SpotsView'].includes(vm.$options?.__name || vm.$options?.name)) contentReady = true
      vm.$children?.forEach(walk)
    }
    walk(page?.$vm)
    if (!shell) return { visible: false, route: page?.route, shell: false }
    const key = require('composables/list-refresh-state.js').listRefreshingKey
    const refreshing = !!page.$vm.$.provides[key]?.value
    return new Promise(resolve => wx.createSelectorQuery()
      .select('>>> .fishing-refresh-indicator').boundingClientRect()
      .exec(values => resolve({ visible: !!values[0]?.height, refreshing, contentReady, rect: values[0], shell: true, route: page.route })))
  })
}
try {
  assert.equal(await client.evaluate(() => wx.getAccountInfoSync().miniProgram.appId), 'wx9f631f76bb1543e0')
  for (const tab of ['feed', 'spots']) {
    await client.callWxMethod('reLaunch', { url: '/pages/home/index?tab=' + tab })
    // A real relaunch rechecks location/session; don't pull while the mandatory
    // gate is still blocking the page and correctly declining refreshes.
    let ready
    for (let n = 0; n < 50; n++) {
      ready = await indicator()
      if (ready.contentReady) break
      await pause(200)
    }
    assert.ok(ready.contentReady, tab + ': real location/session gate has not completed')
    const started = client.callWxMethod('startPullDownRefresh')
    let state
    for (let n = 0; n < 12; n++) {
      state = await indicator()
      if (state.visible) break
      await pause(80)
    }
    await started
    assert.ok(state.visible, tab + ': indicator must be visible during real refresh: ' + JSON.stringify(state))
    await client.screenshot({ path: resolve(output, tab + '-refreshing.png') })
    for (let n = 0; n < 50 && state.visible; n++) { await pause(150); state = await indicator() }
    assert.equal(state.visible, false, tab + ': indicator disappears after completion')
    result.lists.push({ tab, spinnerObserved: true, completed: true })
  }
  result.passed = true
} catch (error) { result.passed = false; result.error = error.message; process.exitCode = 1 }
finally {
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
  await client.disconnect(); clearTimeout(deadline)
}
