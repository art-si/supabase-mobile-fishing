// Actual browser/AMap rendering; all identity, business reads and votes are isolated.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { setH5TextScale } from './h5-text-scale.mjs'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178',
  out = process.argv.includes('--profile-only') ? 'artifacts/mine-profile-layout' : 'artifacts/mine-reports'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname))
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const owner = '11111111-1111-4111-8111-111111111111'
const checks = [],
  errors = [],
  contexts = []
const pass = (value) => {
  checks.push(value)
  console.log('PASS', value)
}
const button = (page, name) =>
  page.getByRole('button', { name, exact: true }).filter({ visible: true })
const modes = [
  ['375', 375, 812, false, 16],
  ['320', 320, 740, false, 16],
  ['440', 440, 956, false, 16],
  ['landscape', 844, 390, false, 16],
  ['wide', 1280, 900, false, 16],
  ['dark-large', 320, 812, true, 24],
  ['largest', 320, 812, false, 32]
]
async function setup(failure = false) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    locale: 'zh-CN',
    reducedMotion: 'reduce'
  })
  contexts.push(context)
  const profile = {
    id: owner,
    nickname: '懂了以后',
    bio: '钓鱼人的鱼魂',
    city: '武汉市',
    method: '台钓',
    handle: 'DYTEST'
  }
  const state = {
    version: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    total: 9,
    can_fish: 5,
    cannot_fish: 4,
    percent: 55,
    mine: null,
    note: '',
    released: false,
    changed_at: null,
    minimum: 10,
    threshold: 60
  }
  const zone = {
    id: 'isolated-voting-zone',
    title: '隔离验收围栏',
    description: '本机接口验收样例，不代表此处真实禁钓规定。',
    location_label: '隔离验收水域',
    longitude: 114.2,
    latitude: 30.5,
    radius_m: 0,
    source: 'official',
    issuer: '接口验收',
    source_url: 'https://test.gov.cn/policy',
    boundary_source_url: 'https://test.gov.cn/boundary',
    boundary_note: '本机绘图验收样例',
    boundary: {
      type: 'Polygon',
      coordinates: [
        [
          [114.198, 30.498],
          [114.202, 30.498],
          [114.202, 30.502],
          [114.198, 30.502],
          [114.198, 30.498]
        ]
      ]
    },
    crs: 'GCJ-02',
    status: 'published',
    revision: 1,
    created_at: '2026-11-20T00:00:00Z',
    observed_on: '2026-11-20',
    expires_on: '',
    feedback: state
  }
  const votes = []
  await context.addInitScript(
    ({ owner, failure }) => {
      localStorage.setItem(
        'dyj.auth.v1',
        JSON.stringify({
          type: 'object',
          data: {
            access_token: 'isolated-mine-ui',
            refresh_token: 'fixture',
            expires_at: Date.now() / 1000 + 3600,
            user: { id: owner }
          }
        })
      )
      Object.defineProperty(navigator, 'permissions', {
        value: { query: async () => ({ state: 'denied' }) }
      })
      if (failure) {
        window.mapFailureAttempts = 0
        window.AMap = {
          Map: class {
            constructor() {
              window.mapFailureAttempts++
              throw new Error('isolated provider failure')
            }
          }
        }
      } else {
        let provider
        Object.defineProperty(window, 'AMap', {
          configurable: true,
          get() {
            if (provider?.Map && !provider.Map.__reviewCaptured) {
              const Capture = new Proxy(provider.Map, {
                construct(Target, args) {
                  const map = Reflect.construct(Target, args)
                  window.acceptanceMap = map
                  map.on('complete', () => {
                    window.acceptanceMapComplete = true
                  })
                  return map
                }
              })
              Capture.__reviewCaptured = true
              provider.Map = Capture
            }
            return provider
          },
          set(value) { provider = value }
        })
      }
    },
    { owner, failure }
  )
  await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
  await context.route('https://jupuypvmgjpnpntfetqv.supabase.co/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      headers = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': '*'
      }
    if (url.pathname.includes('/amap-js/')) return route.continue()
    const reply = (json, status = 200) => route.fulfill({ json, status, headers })
    if (request.method() === 'OPTIONS') return reply({})
    const body = request.postDataJSON() || {},
      payload = body.payload || {}
    if (url.pathname.endsWith('fishing_read'))
      return reply(
        body.action === 'profile'
          ? { profile, posts: [], following: false, friend: false, blocked: false }
          : { items: [], next: null }
      )
    if (url.pathname.endsWith('fishing_reports')) return reply({ items: [], next: null })
    if (url.pathname.endsWith('fishing_zones_read'))
      return reply({
        items: state.released ? [] : [zone],
        released: state.released ? [zone] : [],
        truncated: false,
        zoom_in: false
      })
    if (url.pathname.endsWith('fishing_zone_feedback')) {
      if (body.action === 'vote') {
        assert.equal(request.headers().authorization, 'Bearer isolated-mine-ui')
        if (payload.version !== state.version) return reply({ code: 'REVIEW_CONFLICT' }, 409)
        votes.push(payload)
        Object.assign(state, {
          total: 10,
          can_fish: 6,
          cannot_fish: 4,
          percent: 60,
          mine: payload.vote,
          note: payload.note,
          released: true,
          changed_at: new Date().toISOString()
        })
      }
      return reply(state)
    }
    if (url.pathname.endsWith('fishing_write')) throw Error('Unexpected isolated business write')
    return reply({ items: [], next: null })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(60000)
  page.on('pageerror', (e) => errors.push(e.message))
  return { page, context, profile, state, zone, votes }
}
async function capture(page, prefix) {
  for (const [name, width, height, dark, scale] of modes) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
    await setH5TextScale(page, scale)
    await page.evaluate(() => document.fonts.ready)
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `${prefix}-${name}: no horizontal overflow`
    )
    await page.screenshot({ path: `${out}/${prefix}-${name}.png`, fullPage: prefix === 'mine' })
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'light' })
  await setH5TextScale(page, 16)
}
let page
try {
  const mine = await setup(true)
  page = mine.page
  await page.goto(`${base}/#/pages/home/index?tab=mine`, { waitUntil: 'domcontentloaded' })
  await page.getByText(mine.profile.nickname, { exact: true }).waitFor()
  await capture(page, 'mine')
  const avatar = await page.locator('.mine-profile .mobile-avatar').boundingBox(),
    name = await page.locator('.mine-profile__name').boundingBox(),
    edit = await page.locator('.mine-profile__edit').boundingBox()
  assert.ok(avatar.x + avatar.width <= name.x, 'avatar leads the profile identity on the left')
  assert.ok(edit.x >= name.x + name.width, 'edit action sits to the right of the profile copy')
  assert.ok(Math.abs(avatar.y + avatar.height / 2 - edit.y - edit.height / 2) < 4, 'edit action occupies the avatar’s former row')
  await button(page, '编辑钓友资料').focus()
  assert.notEqual(
    await button(page, '编辑钓友资料').evaluate((e) => getComputedStyle(e).outlineStyle),
    'none'
  )
  await page.screenshot({ path: `${out}/mine-focus.png` })
  await button(page, '编辑钓友资料').press('Enter')
  await page.waitForURL(/pages\/mine\/profile/, { waitUntil: 'domcontentloaded' })
  await button(page, '返回上一页').click()
  await page.waitForURL(/pages\/home\/index/, { waitUntil: 'domcontentloaded' })
  await button(page, /我的社区举报/).click()
  await page.getByText('还没有举报记录', { exact: true }).waitFor()
  assert.equal(await page.getByText('请先登录，原账号草稿会保留', { exact: true }).count(), 0)
  await page.goto(`${base}/#/pages/water-report/index?tab=records`, {
    waitUntil: 'domcontentloaded'
  })
  await page.getByText('还没有保存的上报记录。', { exact: true }).waitFor()
  pass(
    'profile balances identity and avatar; seven viewport/text modes, keyboard edit, distinct report entries and authenticated empty lists work'
  )
  if (!process.argv.includes('--profile-only')) {
  await page.goto(`${base}/#/pages/map/index`, { waitUntil: 'domcontentloaded' })
  await page.getByText('地图暂时未能加载', { exact: true }).waitFor()
  assert.equal(await button(page, '标记禁钓区').count(), 0)
  assert.equal(await page.getByText('操作未完成，请稍后重试', { exact: true }).count(), 0)
  await capture(page, 'map-error')
  const tries = await page.evaluate(() => window.mapFailureAttempts)
  await button(page, '重新加载地图').click()
  await page.getByText('地图暂时未能加载', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.mapFailureAttempts), tries + 1)
  assert.equal(await button(page, '查看钓位列表').count(), 0)
  pass(
    'provider failure has a centered recovery state, hides unusable map actions and retries without a saved-spot entry'
  )
  const map = await setup()
  page = map.page
  await page.goto(`${base}/#/pages/map/index`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.acceptanceMapComplete === true)
  await page.locator('.mobile-map__loading').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.map-data-status,.map-spot-pin').count(), 0)
  assert.ok((await page.locator('.amap-layer').count()) > 0)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${out}/map-empty-375.png` })
  pass('water map retains real AMap tiles and forbidden zones without saved-spot counts or empty states')
  await page.evaluate((zone) => {
    window.acceptanceMap.setCenter([zone.longitude, zone.latitude])
    window.acceptanceMap.setZoom(16)
  }, map.zone)
  const fence = page.getByRole('button', { name: /查看禁钓区域：隔离验收围栏/ })
  await fence.click()
  await page.getByText('这里能垂钓吗？', { exact: true }).waitFor()
  await capture(page, 'feedback')
  await button(page, '可以垂钓').click()
  await page
    .getByText('已按钓友反馈解除地图围栏。原标注与来源保留，不代表管理规定已变更。', {
      exact: true
    })
    .waitFor()
  await page.waitForFunction(
    () => document.querySelectorAll('.mobile-map__fence-label').length === 0
  )
  assert.equal(map.votes.length, 1)
  await page.screenshot({ path: `${out}/feedback-released-375.png` })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${out}/map-released-375.png` })
  await button(page, '地图内禁钓区域').click()
  await page.getByText('钓友反馈已解除', { exact: true }).waitFor()
  await page.screenshot({ path: `${out}/feedback-released-list-375.png` })
  pass(
    'six of ten displays 60%, removes the actual SDK fence immediately and preserves an entry in the released list'
  )
  await button(page, /隔离验收围栏/).click()
  await page.getByText('这里能垂钓吗？', { exact: true }).waitFor()
  Object.assign(map.state, {
    version: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    total: 0,
    can_fish: 0,
    cannot_fish: 0,
    percent: 0,
    mine: null,
    released: false
  })
  map.zone.description = '依据更新后的本机接口样例，不是真实管理规定。'
  await button(page, '仍需禁钓').click()
  await button(page, '刷新区域信息').waitFor()
  assert.ok(await button(page, '可以垂钓').isDisabled())
  assert.equal(map.votes.length, 1)
  await button(page, '刷新区域信息').click()
  await page.getByText(map.zone.description, { exact: true }).waitFor()
  await page.getByText('0 / 0 位钓友认为可以垂钓', { exact: true }).waitFor()
  await button(page, '可以垂钓').click({ trial: true })
  pass(
    'source-version conflict blocks a stale vote until the full boundary/source and fresh voting round reload together'
  )
  }
  assert.deepEqual(errors, [])
  await writeFile(
    `${out}/ui-result.json`,
    JSON.stringify(
      {
        passed: true,
        checks,
        errors,
        boundary:
          'Local isolated identity/business/vote contracts; actual AMap SDK/tiles for successful map cases. No real GPS, votes or hosted writes.'
      },
      null,
      2
    )
  )
} catch (error) {
  if (page) await page.screenshot({ path: `${out}/ui-failure.png`, fullPage: true }).catch(() => {})
  await writeFile(
    `${out}/ui-result.json`,
    JSON.stringify({ passed: false, checks, errors, error: error.message }, null, 2)
  )
  throw error
} finally {
  for (const context of contexts) await context.close()
  await browser.close()
}
