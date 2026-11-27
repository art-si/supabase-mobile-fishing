// Actual WeChat renderer, with local QA theme and long-text fixtures.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readBuildFiles } from './miniapp-package.mjs'
import { assertLocalConfig, requireLocalWechat } from './ui-contract-target.mjs'

const build = resolve(process.env.MINIAPP_UI_BUILD_DIR || 'dist/ui-local/mp-weixin')
const configuration = [...readBuildFiles(build).values()].map(data => data.toString())
  .find(text => text.includes('supabaseUrl:') && text.includes('phoneAuth:'))
assertLocalConfig(configuration || '')
const require = createRequire(resolve('artifacts/miniapp-tools/package.json'))
const client = await require('miniprogram-automator').connect({ wsEndpoint: process.env.MINIAPP_ENDPOINT || 'ws://127.0.0.1:9423' })
const output = resolve(process.env.UI_OUTPUT_DIR || 'artifacts/ui-polish/native-states')
await mkdir(output, { recursive: true })
const pause = ms => new Promise(done => setTimeout(done, ms))
const results = [], exceptions = []
client.on('exception', event => exceptions.push(String(event.message || event.text)))
const watchdog = setTimeout(() => { console.error('Native state capture timed out'); process.exit(2) }, 120000)
async function go(url) {
  await client.callWxMethod('reLaunch', { url })
  await pause(900)
  assert.equal(await client.evaluate(() => getCurrentPages().at(-1).route), url.split('?')[0].slice(1))
}
async function shot(name) {
  await pause(350)
  await client.screenshot({ path: resolve(output, name + '.png') })
  results.push({ name, screenshot: name + '.png', review: 'pending' })
  console.log('SAVED ' + name)
}
try {
  await go('/pages/home/index')
  await requireLocalWechat(client, configuration)
  for (const skin of ['lake', 'stone', 'ocean']) {
    for (const dark of [false, true]) {
      await client.evaluate(({ skin, dark }) => {
        const theme = getCurrentPages().at(-1).$vm.$pinia._s.get('fishing-appearance')
        theme.skin = skin; theme.dark = dark
        return true
      }, { skin, dark })
      await shot(`feed-${skin}-${dark ? 'dark' : 'light'}`)
    }
  }
  await go('/pages/post/detail?id=a1111111-1111-4111-8111-111111111111')
  const geometry = await client.evaluate(async () => {
    const all = [], seen = new Set()
    const visit = vm => { if (!vm || seen.has(vm)) return; seen.add(vm); all.push(vm); for (const child of vm.$children || []) visit(child) }
    visit(getCurrentPages().at(-1).$vm)
    const theme = getCurrentPages().at(-1).$vm.$pinia._s.get('fishing-appearance')
    theme.skin = 'lake'; theme.dark = true
    const comment = all.find(vm => vm.$options?.__name === 'DiscussionComment')
    wx.__uiPolishComment = { item: comment.$props.item, nickname: comment.$props.item.author.nickname, body: comment.$props.item.body }
    comment.$props.item.author.nickname = '喜欢安静钓鱼的长昵称测试钓友'
    comment.$props.item.body = 'LongUnbrokenComment1234567890'.repeat(4) + '。长评论与举报入口应完整显示。'
    comment.$forceUpdate()
    await new Promise(done => setTimeout(done, 250))
    return new Promise(done => {
      const query = wx.createSelectorQuery().in(comment.$scope)
      for (const selector of ['.discussion-comment__header', '.discussion-comment__identity', '.discussion-comment__management', '.discussion-comment__text']) query.selectAll(selector).boundingClientRect()
      query.exec(items => done(items.map(rows => rows[0])))
    })
  })
  const [header, identity, management, message] = geometry
  assert.ok(identity.right <= management.left && management.right <= header.right + 1)
  assert.ok(message.top >= header.bottom - 1)
  await client.callWxMethod('pageScrollTo', { scrollTop: header.top - 130, duration: 0 })
  await shot('comments-dark-long')
  results.push({ name: 'long-comment-layout', geometry, passed: true })
  for (const pick of [false, true]) {
    await go(pick ? '/pages/map/index?pick=1&requestId=ui-polish' : '/pages/map/index')
    const bounds = await client.evaluate(() => {
      const find = vm => vm?.$options?.__name === 'MiniWaterMap' ? vm : vm?.$children?.map(find).find(Boolean)
      const map = find(getCurrentPages().at(-1).$vm)
      return new Promise(done => {
        const query = wx.createSelectorQuery().in(map.$scope)
        query.select('.mini-water-map__canvas').boundingClientRect()
        query.select('.mini-water-map__controls').boundingClientRect()
        query.exec(([canvas, controls]) => done({ canvas, controls }))
      })
    })
    assert.ok(bounds.canvas?.height > 0 && bounds.controls?.height > 0)
    await shot(pick ? 'map-pick' : 'map-browse')
  }
  assert.deepEqual(exceptions, [])
} finally {
  await client.evaluate(() => {
    if (wx.__uiPolishComment) {
      const previous = wx.__uiPolishComment
      previous.item.author.nickname = previous.nickname; previous.item.body = previous.body
      delete wx.__uiPolishComment
    }
    const theme = getCurrentPages().at(-1)?.$vm?.$pinia?._s.get('fishing-appearance')
    if (theme) { theme.skin = 'lake'; theme.refreshSystem() }
    return true
  }).catch(() => {})
  clearTimeout(watchdog)
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ scope: 'local Supabase QA account; theme fixtures, not device setting or remote data validation', results, exceptions }, null, 2))
  await client.disconnect()
}
