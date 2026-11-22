// Isolated password/session and business API contract. Never sends SMS or real writes.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { setH5TextScale } from './h5-text-scale.mjs'

const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname))
const output = process.env.FISHING_LOGIN_RETURN_ARTIFACTS || 'artifacts/login-return'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const owner = '11111111-1111-4111-8111-111111111111',
  author = '22222222-2222-4222-8222-222222222222'
const id = '33333333-3333-4333-8333-333333333333',
  spotId = '44444444-4444-4444-8444-444444444444'
const title = '续接验收鱼情',
  spotTitle = '续接验收钓位'
const checks = [],
  errors = [],
  escaped = [],
  contexts = []
const button = (page, name) =>
  page.getByRole('button', { name, exact: true }).filter({ visible: true })
const pass = (value) => {
  checks.push(value)
  console.log('PASS', value)
}
let current

async function fixture(options = {}) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    locale: 'zh-CN',
    reducedMotion: 'reduce'
  })
  contexts.push(context)
  const state = {
    writes: [],
    saved: !!options.alreadySaved,
    liked: false,
    spotSaved: false,
    unavailable: false,
    failWrite: false
  }
  const profile = {
    id: owner,
    nickname: '接口验收钓友',
    city: '苏州市',
    handle: 'TESTUSER',
    method: '台钓',
    bio: ''
  }
  const post = (signed) => ({
    id,
    author: { ...profile, id: author },
    title,
    body: '用于本机登录续接检查，不是真实社区内容。',
    kind: 'experience',
    species: '',
    method: '',
    bait: '',
    weight_kg: null,
    count: null,
    topic: '',
    audience: 'public',
    status: 'published',
    location_label: '苏州市',
    occurred_on: '2026-11-20',
    created_at: '2026-11-20T00:00:00Z',
    media: [],
    liked: signed && state.liked,
    saved: signed && state.saved,
    like_count: Number(state.liked),
    comment_count: 0
  })
  const spot = (signed) => ({
    id: spotId,
    author: { ...profile, id: author },
    name: spotTitle,
    city: '苏州市',
    water_type: '自然水域',
    species: '',
    description: '本机接口样例',
    fee_note: '未核实',
    access_note: '',
    observed_on: '2026-11-20',
    audience: 'public',
    precision: 'hidden',
    longitude: null,
    latitude: null,
    created_at: '2026-11-20T00:00:00Z',
    status: 'published',
    media: [],
    saved: signed && state.spotSaved
  })
  await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url())
    if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
    const reply = (json, status = 200) =>
      route.fulfill({
        status,
        json,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*'
        }
      })
    if (url.origin !== 'https://jupuypvmgjpnpntfetqv.supabase.co') {
      escaped.push(url.origin)
      return route.abort()
    }
    if (request.method() === 'OPTIONS') return reply({})
    const signed = request.headers().authorization === 'Bearer login-return-fixture'
    if (url.pathname === '/auth/v1/token') {
      assert.equal(url.searchParams.get('grant_type'), 'password')
      return reply({
        access_token: 'login-return-fixture',
        refresh_token: 'fixture-refresh',
        expires_in: 3600,
        expires_at: Date.now() / 1000 + 3600,
        user: { id: owner, phone: '8613800000000' }
      })
    }
    if (url.pathname === '/auth/v1/user') return reply({ id: owner, phone: '8613800000000' })
    if (url.pathname === '/auth/v1/logout') return reply({})
    if (url.pathname.includes('/auth/')) {
      escaped.push(url.pathname)
      return route.abort()
    }
    if (url.pathname.endsWith('fishing_moderation')) return reply({ allowed: false })
    if (url.pathname.endsWith('fishing_read')) {
      const { action, payload } = request.postDataJSON()
      if (action === 'profile') return reply(payload?.id ? { profile: { ...profile, id: payload.id }, posts: [], following: false, friend: false, blocked: false } : profile)
      if (action === 'post')
        return signed && state.unavailable
          ? reply({ code: 'P0001', message: 'NOT_FOUND' }, 400)
          : reply({ post: post(signed), comments: [], comments_next: null })
      if (action === 'spot') return reply(spot(signed))
      if (action === 'feed') return reply({ items: [post(signed)], next: null })
      if (action === 'social')
        return reply({
          friends: [],
          requests: [],
          conversations: [],
          notifications: { interaction: 0, system: 0 }
        })
      return reply({ items: [], next: null })
    }
    if (url.pathname.endsWith('fishing_write')) {
      const { action, payload } = request.postDataJSON()
      assert.ok(signed, 'guest must never write a reaction')
      assert.ok(['reaction', 'spot_bookmark'].includes(action))
      state.writes.push({ action, payload })
      if (state.unavailable) return reply({ code: 'P0001', message: 'NOT_FOUND' }, 400)
      if (state.failWrite) return reply({ message: '保存失败，请稍后重试' }, 503)
      if (action === 'spot_bookmark') {
        assert.equal(payload.id, spotId)
        state.spotSaved = payload.enabled
        return reply({ ok: true })
      }
      assert.equal(payload.id, id)
      if (payload.kind === 'like') state.liked = payload.enabled
      else state.saved = payload.enabled
      return reply(post(true))
    }
    if (url.pathname.startsWith('/rest/')) return reply([])
    escaped.push(url.pathname)
    return route.abort()
  })
  const page = await context.newPage()
  current = page
  page.on('pageerror', (error) => errors.push(error.message))
  return { page, state }
}
const open = (page, path) => page.goto(`${base}/#${path}`)
async function login(page) {
  await page.waitForURL(/pages\/login\/index/)
  // Route changes precede component mount; wait for the actual entry before switching.
  await button(page, '使用密码登录').click()
  await page.locator('input[aria-label="账号或手机号"]:visible').fill('13800000000')
  await page.locator('input[aria-label="登录密码"]:visible').fill('ContractOnly!234')
  const consent = page
    .getByRole('checkbox', { name: '同意用户协议与隐私说明', exact: true })
    .filter({ visible: true })
  if ((await consent.getAttribute('aria-checked')) !== 'true') await consent.click()
  await button(page, '登录').click()
  await page.waitForURL((url) => !url.hash.includes('/pages/login/'))
}
async function waitWrites(state, count) {
  for (let i = 0; i < 100 && state.writes.length < count; i++)
    await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(state.writes.length, count)
}
const detail = `/pages/post/detail?id=${id}`
async function screenshot(page, name) {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true })
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    'no horizontal overflow'
  )
}
try {
  for (const route of ['detail', 'feed', 'spot']) {
    const { page, state } = await fixture({ alreadySaved: route === 'detail' })
    await open(
      page,
      route === 'feed'
        ? '/pages/home/index'
        : route === 'spot'
          ? `/pages/spot/detail?id=${spotId}`
          : detail
    )
    await button(page, route === 'spot' ? '收藏这个钓位' : `收藏：${title}`).click()
    assert.equal(state.writes.length, 0)
    await login(page)
    await waitWrites(state, 1)
    assert.equal(state.writes[0].payload.enabled, true)
    await button(page, route === 'spot' ? '取消收藏' : `取消收藏：${title}`).waitFor()
    if (route === 'detail') {
      await screenshot(page, 'saved-detail-375')
      for (const [width, height, font, dark] of [
        [320, 740, 24, true],
        [440, 956, 16, false],
        [812, 375, 16, false],
        [1280, 800, 16, true]
      ]) {
        await page.setViewportSize({ width, height })
        await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
        await setH5TextScale(page, font)
        await screenshot(page, `saved-${width}-${font}`)
      }
      await button(page, '查看接口验收钓友的主页').click()
      await page.waitForURL(/pages\/people\/detail/)
      await button(page, '返回上一页').click()
      await page.waitForURL(/pages\/post\/detail/)
      await button(page, `取消收藏：${title}`).waitFor()
      assert.equal(state.writes.length, 1)
      const savedAction = button(page, `取消收藏：${title}`)
      await page.keyboard.press('Tab')
      await savedAction.focus()
      assert.ok(await savedAction.evaluate((element) => element === document.activeElement))
      assert.ok(
        await savedAction.evaluate((element) => getComputedStyle(element).outlineStyle !== 'none')
      )
      await screenshot(page, 'saved-action-focus')
      await savedAction.press('Enter')
      await waitWrites(state, 2)
      assert.equal(state.writes[1].payload.enabled, false)
      await button(page, `收藏：${title}`).waitFor()
    }
    pass(
      `${route}: guest save returns and completes exactly once; existing saved state stays enabled`
    )
  }
  {
    const { page, state } = await fixture()
    await open(page, detail)
    await button(page, `点赞：${title}`).click()
    await login(page)
    await waitWrites(state, 1)
    assert.equal(state.writes[0].payload.kind, 'like')
    await button(page, `取消点赞：${title}`).waitFor()
    pass('guest like resumes with the original content id and kind')
  }
  {
    const { page, state } = await fixture()
    await open(page, detail)
    await button(page, `收藏：${title}`).click()
    await page.waitForURL(/pages\/login\/index/)
    await button(page, '返回上一页').click()
    await page.waitForURL(/pages\/post\/detail/)
    await button(page, '举报这条内容').click()
    await login(page)
    await button(page, `收藏：${title}`).waitFor()
    assert.equal(state.writes.length, 0)
    pass('cancelling login prevents a later unrelated login from replaying the save')
  }
  {
    const { page, state } = await fixture()
    await open(page, detail)
    await button(page, `收藏：${title}`).click()
    await page.waitForURL(/pages\/login\/index/)
    // A full browser navigation destroys the original page and its in-memory intent.
    await open(page, detail)
    await button(page, '举报这条内容').click()
    await login(page)
    await button(page, `收藏：${title}`).waitFor()
    assert.equal(state.writes.length, 0)
    pass('removing the originating page destroys its pending action')
  }
  {
    const { page, state } = await fixture()
    await open(page, detail)
    await button(page, `收藏：${title}`).click()
    state.failWrite = true
    await login(page)
    await waitWrites(state, 1)
    await page.locator('.error:visible').first().waitFor()
    assert.equal(state.saved, false)
    state.failWrite = false
    await button(page, `收藏：${title}`).click()
    await waitWrites(state, 2)
    await button(page, `取消收藏：${title}`).waitFor()
    pass(
      'failed continuation shows the existing error state and manual retry saves only the intended item'
    )
  }
  {
    const { page, state } = await fixture()
    await open(page, detail)
    await button(page, `收藏：${title}`).click()
    state.unavailable = true
    await login(page)
    await waitWrites(state, 1)
    assert.equal(state.saved, false)
    assert.equal(await button(page, `取消收藏：${title}`).count(), 0)
    await page
      .getByText('内容不存在或你暂时无权查看', { exact: true })
      .filter({ visible: true })
      .waitFor()
    assert.equal(
      await page.locator('.error:visible').count(),
      0,
      'read failure must not repeat the same mutation error'
    )
    await screenshot(page, 'unavailable-return-375')
    pass('content that became unavailable is not reported as successfully saved')
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(escaped, [])
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        passed: true,
        checks,
        errors,
        escaped,
        boundary:
          'Isolated password/session and API contracts only. No OTP, real credentials, hosted writes, or device authentication evidence.'
      },
      null,
      2
    )
  )
} catch (error) {
  if (current)
    await current.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {})
  const routes = current
    ? await current
        .evaluate(() => getCurrentPages().map((p) => ({ route: p.route, path: p.$page?.fullPath })))
        .catch(() => [])
    : []
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      { passed: false, checks, error: error.message, routes, errors, escaped },
      null,
      2
    )
  )
  throw error
} finally {
  for (const context of contexts) await context.close()
  await browser.close()
}
