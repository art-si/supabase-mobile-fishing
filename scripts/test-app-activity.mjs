// Capacitor bridge + HTTP/WebSocket fixtures in Chrome. NOT an APK/IPA or device test.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setH5TextScale } from './h5-text-scale.mjs'

const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5179'
const output = resolve(
  'artifacts/app-activity',
  new URL(base).port === '5181' ? 'production-contract' : 'contract'
)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const checks = [],
  errors = [],
  unexpected = []
const user = '11111111-1111-4111-8111-111111111111'
const peer = '22222222-2222-4222-8222-222222222222'
const conversationId = '33333333-3333-4333-8333-333333333333'
const profile = {
  id: peer,
  nickname: '隔离生命周期钓友',
  handle: 'ISOLATED',
  city: '苏州',
  bio: '',
  method: '台钓'
}
let activePage
async function fixture(platform) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    locale: 'zh-CN'
  })
  const requests = [],
    sockets = []
  let messageGate,
    extra = false
  const messages = () =>
    [1, ...(extra ? [2] : [])].map((sequence) => ({
      id: `message-${sequence}`,
      client_id: `isolated-${sequence}`,
      conversation_id: conversationId,
      sender_id: peer,
      sequence,
      body: `隔离消息${sequence}`,
      kind: 'text',
      created_at: '2026-11-19T10:00:00Z'
    }))
  await context.routeWebSocket(/supabase\.co/, (socket) => {
    const item = { socket, closed: false, joined: false }
    sockets.push(item)
    socket.onClose(() => {
      item.closed = true
    })
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw))
      if (frame.event === 'phx_join') {
        assert.equal(frame.topic, `realtime:fishing:user:${user}`)
        assert.equal(frame.payload.config.private, true)
        item.joined = true
      }
      if (!['phx_join', 'phx_leave', 'heartbeat', 'access_token'].includes(frame.event))
        unexpected.push(`websocket:${frame.event}`)
      socket.send(
        JSON.stringify({
          topic: frame.topic,
          ref: frame.ref,
          event: 'phx_reply',
          payload: { status: 'ok', response: { postgres_changes: [] } }
        })
      )
    })
  })
  await context.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url())
    if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
    if (url.origin !== 'https://jupuypvmgjpnpntfetqv.supabase.co') {
      unexpected.push(url.origin)
      return route.abort()
    }
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*'
    }
    const reply = (json) => route.fulfill({ json, headers })
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const body = req.postDataJSON() || {}
    requests.push({ path: url.pathname, ...body })
    if (url.pathname.endsWith('/fishing_moderation')) return reply({ allowed: false })
    if (url.pathname.endsWith('/fishing_read')) {
      switch (body.action) {
        case 'profile':
          return reply({ profile: { ...profile, id: user }, posts: [] })
        case 'social':
          return reply({
            friends: [],
            requests: [],
            conversations: [
              {
                id: conversationId,
                peer: profile,
                last_message: '隔离消息1',
                last_at: '2026-11-19T10:00:00Z',
                unread: 1,
                can_send: true,
                peer_read_sequence: 0
              }
            ]
          })
        case 'messages': {
          if (messageGate) await messageGate
          return reply(messages().filter((m) => m.sequence > (body.payload.after || 0)))
        }
        case 'people':
          return reply([profile])
        case 'feed':
        case 'spots':
          return reply({ items: [], next: null })
      }
    }
    if (url.pathname.endsWith('/fishing_write') && body.action === 'read_conversation')
      return reply({})
    unexpected.push(`${url.pathname}:${body.action || 'unknown'}`)
    return route.abort()
  })
  await context.addInitScript(
    ({ platform, user }) => {
      const session = {
        access_token: 'isolated-lifecycle-token',
        refresh_token: 'isolated-lifecycle-refresh',
        expires_at: Date.now() / 1000 + 3600,
        user: { id: user }
      }
      if (platform === 'web') {
        localStorage.setItem('dyj.auth.v1', JSON.stringify({ type: 'object', data: session }))
        return
      }
      localStorage.setItem('dyj.auth.install.v1', JSON.stringify({ type: 'boolean', data: true }))
      if (platform === 'android') window.androidBridge = {}
      else window.webkit = { messageHandlers: { bridge: {} } }
      let stateCallback,
        snapshotResolve,
        serial = 0
      const fixture = (window.activityFixture = {
        getStateCalls: 0,
        stateListeners: 0,
        emit(isActive) {
          stateCallback?.({ isActive })
        },
        snapshot(isActive) {
          snapshotResolve?.({ isActive })
        }
      })
      window.Capacitor = {
        PluginHeaders: [
          {
            name: 'App',
            methods: [
              { name: 'getState', rtype: 'promise' },
              { name: 'addListener', rtype: 'callback' },
              { name: 'removeListener', rtype: 'promise' }
            ]
          },
          {
            name: 'SecureStorage',
            methods: [
              'internalGetItem',
              'internalSetItem',
              'internalRemoveItem',
              'setSynchronizeKeychain'
            ].map((name) => ({ name, rtype: 'promise' }))
          }
        ],
        nativeCallback(plugin, method, options, callback) {
          if (plugin !== 'App' || method !== 'addListener')
            throw new Error('Unexpected native callback')
          if (options.eventName === 'appStateChange') {
            stateCallback = callback
            fixture.stateListeners++
          }
          return String(++serial)
        },
        async nativePromise(plugin, method) {
          if (plugin === 'App' && method === 'getState') {
            fixture.getStateCalls++
            return new Promise((resolve) => {
              snapshotResolve = resolve
            })
          }
          if (plugin === 'App' && method === 'removeListener') return
          if (plugin === 'SecureStorage') {
            if (method === 'internalGetItem') return { data: JSON.stringify(session) }
            if (method === 'internalRemoveItem') return { success: true }
            return
          }
          throw new Error('Unexpected native promise')
        }
      }
    },
    { platform, user }
  )
  const page = await context.newPage()
  activePage = page
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error) => errors.push(error.message))
  const count = (action) => requests.filter((r) => r.action === action).length
  const visible = async (value) =>
    page.evaluate((value) => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: value ? 'visible' : 'hidden'
      })
      document.dispatchEvent(new Event('visibilitychange'))
    }, value)
  const emit = (value) =>
    platform === 'web'
      ? visible(value)
      : page.evaluate((value) => window.activityFixture.emit(value), value)
  const until = async (check) => {
    const end = Date.now() + 15000
    while (!check()) {
      assert.ok(Date.now() < end, 'fixture observation timeout')
      await new Promise((r) => setTimeout(r, 30))
    }
  }
  await page.goto(`${base}/#/pages/chat/index?id=${conversationId}`)
  if (platform !== 'web') {
    await page.waitForFunction(() => window.activityFixture?.getStateCalls === 1)
    await emit(false)
    await page.evaluate(() => window.activityFixture.snapshot(true))
    await page.waitForTimeout(200)
    assert.equal(count('messages'), 0)
    assert.equal(sockets.length, 0)
    await emit(true)
  }
  await page.getByText('隔离消息1', { exact: true }).waitFor()
  await until(() => sockets.some((s) => s.joined))
  await until(() =>
    requests.some((r) => r.action === 'read_conversation' && r.payload.sequence === 1)
  )
  // Wait out the join's coalesced catch-up before measuring duplicate notifications.
  await page.waitForTimeout(350)
  const input = page.locator('.chat-input textarea')
  await input.fill('尚未发送的草稿')
  const beforeDuplicate = count('messages')
  if (platform !== 'web') {
    await emit(true)
    await emit(true)
    await page.waitForTimeout(300)
    assert.equal(count('messages'), beforeDuplicate)
    assert.equal(await page.evaluate(() => window.activityFixture.stateListeners), 1)
  }
  await emit(false)
  await until(() => sockets.every((s) => s.closed))
  const paused = count('messages'),
    reads = count('read_conversation')
  await page.waitForTimeout(5300)
  assert.equal(count('messages'), paused)
  assert.equal(count('read_conversation'), reads)
  assert.equal(await input.inputValue(), '尚未发送的草稿')
  checks.push(
    `${platform}: actual root wiring, inactive startup/snapshot race, single listener, background socket/poll/read pause and draft retention`
  )
  if (platform === 'android') {
    let release
    messageGate = new Promise((resolve) => {
      release = resolve
    })
    await emit(true)
    await until(() => count('messages') > paused)
    await emit(false)
    extra = true
    release()
    messageGate = undefined
    await page.waitForTimeout(250)
    assert.equal(await page.getByText('隔离消息2', { exact: true }).count(), 0)
    assert.ok(!requests.some((r) => r.action === 'read_conversation' && r.payload.sequence === 2))
    await emit(true)
    await page.getByText('隔离消息2', { exact: true }).waitFor()
    await until(() =>
      requests.some((r) => r.action === 'read_conversation' && r.payload.sequence === 2)
    )
    assert.equal(await input.inputValue(), '尚未发送的草稿')
    checks.push(
      'late HTTP after native hide cannot display or mark new messages read; resume catches up without losing draft'
    )
    await visible(false)
    await emit(true)
    await until(() => sockets.every((s) => s.closed))
    const hidden = count('messages')
    await page.waitForTimeout(300)
    assert.equal(count('messages'), hidden)
    await visible(true)
    await until(() => count('messages') > hidden)
    checks.push('native active cannot override hidden document; either event order resumes safely')
    for (const route of ['/pages/people/index', '/pages/home/index?tab=messages']) {
      await emit(false)
      // Hash navigation also works in production without dev-only global uni APIs.
      await page.evaluate((url) => {
        window.location.hash = url
      }, route)
      await page.waitForURL(
        (url) =>
          url.hash === `#${route}` ||
          (route === '/pages/home/index?tab=messages' && url.hash === '#/?tab=messages')
      )
      await page.waitForTimeout(250)
      const before = count('social'),
        chatBefore = count('messages')
      await page.waitForTimeout(10200)
      assert.equal(count('social'), before)
      await emit(true)
      await until(() => count('social') > before)
      await page.waitForTimeout(300)
      assert.equal(count('messages'), chatBefore)
      checks.push(
        `${route}: hidden polling paused; resume refreshes only the visible route, not an old chat`
      )
    }
    await page.evaluate((url) => {
      window.location.hash = url
    }, `/pages/chat/index?id=${conversationId}`)
    await page.getByText('隔离消息2', { exact: true }).waitFor()
    assert.equal(await input.inputValue(), '尚未发送的草稿')
    for (const [name, width, height, dark, font] of [
      ['375', 375, 812, false, 16],
      ['320-dark-large', 320, 812, true, 24],
      ['440', 440, 956, false, 16],
      ['landscape', 812, 375, false, 16],
      ['wide', 1280, 900, false, 16]
    ]) {
      await page.setViewportSize({ width, height })
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' })
      await setH5TextScale(page, font)
      // Uni debounces its resize hook. Capture the actual viewport, not a full-page resize of a fixed chat composer.
      await page.waitForTimeout(150)
      await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: false })
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        name
      )
      const measuredFont = await input.evaluate((node) =>
        parseFloat(getComputedStyle(node).fontSize)
      )
      assert.ok(measuredFont >= font - 0.1, `${name}: actual composer text scales`)
      const send = await page.getByRole('button', { name: '发送', exact: true }).boundingBox()
      assert.ok(
        send &&
          send.width >= 44 &&
          send.height >= 44 &&
          send.y >= 0 &&
          send.y + send.height <= height + 1,
        `${name}: send stays reachable`
      )
      assert.equal(await input.inputValue(), '尚未发送的草稿')
    }
    checks.push(
      'resumed chat preserved draft across 320-large-dark/375/440/landscape/wide, reduced-motion and viewport reflow'
    )
  } else {
    await emit(true)
    await until(() => count('messages') > paused)
    assert.equal(await input.inputValue(), '尚未发送的草稿')
  }
  await context.close()
}
try {
  for (const platform of ['android', 'ios', 'web']) await fixture(platform)
  assert.deepEqual(errors, [])
  assert.deepEqual(unexpected, [])
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(
      {
        passed: true,
        base,
        evidence: 'isolated Capacitor bridge + HTTP/WS in Chrome; not device or real Supabase',
        checks
      },
      null,
      2
    )
  )
  console.log(JSON.stringify({ passed: checks.length, output }))
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: resolve(output, 'failure-current.png'), fullPage: true })
    console.log(
      JSON.stringify({
        route: new URL(activePage.url()).hash,
        text: (await activePage.locator('body').innerText()).slice(-1800),
        errors,
        unexpected
      })
    )
  }
  throw error
} finally {
  await browser.close()
}
