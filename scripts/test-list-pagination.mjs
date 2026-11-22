// Exercise visible pagination feedback against delayed responses in an isolated H5 build.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { setH5TextScale } from './h5-text-scale.mjs'

const base = new URL(process.env.FISHING_H5_URL || 'http://127.0.0.1:5279').origin
const backend = 'https://fishing-visual-check.invalid'
const output = 'artifacts/list-pagination'
const before = process.argv.includes('--before')
const author = {
  id: '11111111-1111-4111-8111-111111111111',
  nickname: '隔离测试钓友', city: '武汉市', bio: '', method: '台钓', handle: 'DY100001'
}
const date = '2026-11-20T08:00:00+08:00'
const idOf = (index) => '11111111-2222-4222-8222-' + String(index).padStart(12, '0')
const spot = (index) => ({
  id: idOf(index), name: '测试钓位 ' + index, author, city: '武汉市', location_label: '界面测试用地点',
  water_type: '自然水域', species: '鲫鱼', description: '', fee_note: '未核实', access_note: '',
  longitude: 114.18 + index * .003, latitude: 30.48,
  audience: 'public', precision: 'exact', fishing_status: 'allowed', status: 'published',
  observed_on: date.slice(0, 10), created_at: date, saved: false
})
const post = (index) => ({
  id: idOf(index), title: '测试鱼情 ' + index, body: '用于检查续页时原来的内容仍可阅读。', author,
  city: '武汉市', kind: 'experience', species: '', method: '', bait: '', weight_kg: null,
  occurred_on: date.slice(0, 10), location_label: '', audience: 'public', status: 'published',
  created_at: date, like_count: 0, comment_count: 0, saved: false, liked: false, media: []
})
const reviewItem = (index) => ({
  id: idOf(index), title: '测试待审记录 ' + index, type: 'post', author,
  audience: 'public', created_at: date, is_update: false
})
const eight = (make) => Array.from({ length: 8 }, (_, index) => make(index + 1))
const footer = (page) => page.locator('.mobile-list-footer:visible')
const headers = {
  'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
  'access-control-allow-methods': '*'
}
const checks = []
const escaped = []
const errors = []
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })

async function fixture(path, reply, width = 375) {
  const context = await browser.newContext({
    viewport: { width, height: 812 }, locale: 'zh-CN', permissions: ['geolocation'],
    geolocation: { longitude: 114.18, latitude: 30.48, accuracy: 20 }
  })
  await context.addInitScript(id => {
    localStorage.setItem('dyj.feed.city', '武汉市')
    localStorage.setItem('dyj.auth.v1', JSON.stringify({ type: 'object', data: {
      access_token: 'pagination-fixture', refresh_token: 'pagination-fixture',
      expires_at: Date.now() / 1000 + 3600, user: { id }
    } }))
  }, author.id)
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.route('**/*', async route => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.origin === base || !['http:', 'https:'].includes(url.protocol)) return route.continue()
    if (url.origin !== backend) {
      escaped.push(url.hostname)
      return route.abort()
    }
    if (req.method() === 'OPTIONS') return route.fulfill({ headers, json: {} })
    if (req.method() !== 'GET' && req.method() !== 'POST') throw new Error('Unexpected method: ' + req.method())
    const input = req.method() === 'POST' ? req.postDataJSON() : {}
    const response = await reply(url.pathname, input)
    return route.fulfill({ headers, ...response })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base + '/#' + path)
  return { page, context }
}

async function down(page) {
  await page.mouse.move(150, 500)
  await page.mouse.wheel(0, 12000)
}

async function backgroundSpots() {
  const catalog = Promise.withResolvers()
  const requested = Promise.withResolvers()
  const { page, context } = await fixture('/pages/home/index?tab=spots', async (path, input) => {
    if (path.endsWith('/fishing_list_spot_leads')) {
      requested.resolve()
      await catalog.promise
      return { json: [] }
    }
    if (input.action === 'spots') return { json: { items: eight(spot), next: null } }
    return { json: { items: [], next: null } }
  })
  try {
    await page.getByText('测试钓位 8', { exact: true }).waitFor()
    await Promise.race([requested.promise, new Promise((_, reject) => {
      const timeout = setTimeout(() => reject(new Error('Spot catalogue was not requested')), 8000)
      timeout.unref()
    })])
    await down(page)
    if (before) {
      assert.equal(await footer(page).count(), 0)
      await page.screenshot({ path: output + '/before-spots-no-feedback.png' })
      return
    }
    await footer(page).getByText('正在加载更多钓位…', { exact: true }).waitFor()
    assert.equal(await page.locator('.spot-card').count(), 8)
    await page.screenshot({ path: output + '/spots-background-loading-375.png' })
    catalog.resolve()
    await footer(page).getByText('已加载全部 8 条', { exact: true }).waitFor()
    checks.push('钓位已显示时，后台地点解析仍有底部加载反馈')
  } finally {
    catalog.resolve()
    await context.close()
  }
}

async function pageFlight({ path, action, make, label, name, permissionLoss = false }) {
  const first = Promise.withResolvers()
  const second = Promise.withResolvers()
  let requests = 0
  const cursor = action === 'queue' ? { id: idOf(8), type: 'post', created_at: date } : 'fixture-page-2'
  const { page, context } = await fixture(path, async (url, input) => {
    if (url.endsWith('/fishing_list_spot_leads')) return { json: [] }
    if (input.action !== action) return { json: { items: [], next: null } }
    if (!input.payload?.cursor) return { json: { items: eight(make), next: cursor } }
    requests++
    if (requests === 1) {
      await first.promise
      return { status: permissionLoss ? 403 : 503, json: { message: 'fixture' } }
    }
    await second.promise
    return { json: { items: [make(8), make(9)], next: null } }
  }, 320)
  const rowLabel = (index) => make(index).title || make(index).name
  try {
    await page.getByText(rowLabel(8), { exact: true }).waitFor()
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await setH5TextScale(page, 24)
    await down(page)
    await footer(page).getByText(label, { exact: true }).waitFor()
    assert.equal(await page.getByText(rowLabel(8), { exact: true }).count(), 1)
    await down(page)
    assert.equal(requests, 1, 'Repeated scroll does not start a duplicate request')
    await page.screenshot({ path: output + '/' + name + '-loading-320-dark.png' })
    if (name === 'spots') {
      await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })
      for (const [format, width, height] of [
        ['375', 375, 812], ['440', 440, 956], ['landscape', 844, 390], ['wide', 1280, 900]
      ]) {
        await page.setViewportSize({ width, height })
        await setH5TextScale(page, 16)
        await footer(page).scrollIntoViewIfNeeded()
        assert.ok(await footer(page).evaluate(node => {
          const { left, top, width, height } = node.getBoundingClientRect()
          return document.documentElement.scrollWidth <= innerWidth + 1 &&
            node.contains(document.elementFromPoint(left + width / 2, top + height / 2))
        }), format + ': loading footer fits above navigation')
        await page.screenshot({ path: output + '/spots-loading-' + format + '.png' })
      }
    }
    first.resolve()
    if (permissionLoss) {
      await page.getByText(rowLabel(8), { exact: true }).waitFor({ state: 'detached' })
      assert.equal(requests, 1)
      checks.push('审核授权失效时清除已加载的待审内容')
      return
    }
    const retry = page.getByRole('button', { name: '重试', exact: true }).last()
    await retry.waitFor()
    assert.equal(await page.getByText(rowLabel(8), { exact: true }).count(), 1)
    await page.screenshot({ path: output + '/' + name + '-retry.png' })
    await retry.focus()
    await page.keyboard.press('Enter')
    await footer(page).getByText(label, { exact: true }).waitFor()
    second.resolve()
    await page.getByText(rowLabel(9), { exact: true }).waitFor()
    await footer(page).getByText('已加载全部 9 条', { exact: true }).waitFor()
    assert.equal(await page.getByText(rowLabel(8), { exact: true }).count(), 1)
    await down(page)
    assert.equal(requests, 2)
    await page.screenshot({ path: output + '/' + name + '-finished.png' })
    checks.push(name + '自动续页，失败保留已有记录，重试成功后去重并标记读完')
  } catch (error) {
    await page.screenshot({ path: output + '/' + name + '-failed.png' })
    console.log('List footer at failure:', await page.locator('.mobile-list-footer').allTextContents())
    throw error
  } finally {
    first.resolve()
    second.resolve()
    await context.close()
  }
}

try {
  await backgroundSpots()
  if (!before) {
    await pageFlight({ path: '/pages/home/index?tab=spots', action: 'spots', make: spot,
      label: '正在加载更多钓位…', name: 'spots' })
    await pageFlight({ path: '/pages/home/index', action: 'feed', make: post,
      label: '正在加载更多鱼情…', name: 'feed' })
    await pageFlight({ path: '/pages/moderation/index', action: 'queue', make: reviewItem,
      label: '正在加载更多待审内容…', name: 'moderation' })
    await pageFlight({ path: '/pages/moderation/index', action: 'queue', make: reviewItem,
      label: '正在加载更多待审内容…', name: 'moderation-permission', permissionLoss: true })
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(escaped, [])
} finally {
  await writeFile(output + '/' + (before ? 'before' : 'result') + '.json',
    JSON.stringify({ checks, errors, escaped }, null, 2))
  await browser.close()
}
