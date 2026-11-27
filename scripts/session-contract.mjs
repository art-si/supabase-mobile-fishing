import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pageManifest } from './miniapp-package.mjs'

// Contract fixtures only. No real SMS, remote accounts, tokens or content are used.
export async function sessionContract({
  page,
  context,
  base,
  go,
  fill,
  visible,
  pass,
  screenshot,
  overflow
}) {
  const ids = {
    A: '11111111-1111-4111-8111-111111111111',
    B: '22222222-2222-4222-8222-222222222222'
  }
  const profiles = Object.fromEntries(
    Object.entries(ids).map(([who, id]) => [
      who,
      {
        id,
        nickname: `账号${who}（接口测试）`,
        handle: `TEST-${who}`,
        city: '苏州',
        bio: '接口测试资料',
        method: '台钓'
      }
    ])
  )
  const trip = {
    id: 'a1111111-1111-4111-8111-111111111111',
    title: '仅A可见的私人日志',
    body: '账号A的私人记录，不应出现在账号B。',
    occurred_on: '2026-11-19',
    species: '鲫鱼',
    method: '台钓',
    bait: '蚯蚓',
    weight_kg: null,
    count: null,
    media: []
  }
  let serial = 0,
    libraryGate,
    profileSaveGate,
    logoutGate,
    rejectA = false,
    failLogout = false
  const refreshGates = new Map(),
    requests = [],
    escaped = [],
    errors = []
  const deferred = () => {
    let release
    const promise = new Promise((resolve) => {
      release = resolve
    })
    return { promise, release }
  }
  const makeSession = (who) => ({
    access_token: `fixture-${who}-${++serial}`,
    refresh_token: `refresh-${who}-${serial}`,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: ids[who], phone: who === 'A' ? '8613800138000' : '8613800138001' }
  })
  await context.routeWebSocket(/supabase\.co/, socket => socket.close())
  await context.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url())
    if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
    if (url.origin === 'https://tiles.openfreemap.org') return route.abort()
    if (url.origin !== 'https://jupuypvmgjpnpntfetqv.supabase.co') {
      escaped.push(url.href)
      return route.abort()
    }
    const reply = (json, status = 200) =>
      route.fulfill({
        status,
        json,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET,POST,OPTIONS'
        }
      })
    if (req.method() === 'OPTIONS') return reply({})
    const body = req.postDataJSON() || {},
      who = /fixture-([AB])-/.exec(req.headers().authorization || '')?.[1]
    requests.push({ path: url.pathname, who, body })
    if (url.pathname === '/auth/v1/otp') return reply({})
    if (url.pathname === '/auth/v1/verify')
      return reply(makeSession(body.phone.endsWith('1') ? 'B' : 'A'))
    if (url.pathname === '/auth/v1/token') {
      const owner = /refresh-([AB])-/.exec(body.refresh_token)?.[1]
      const gate = refreshGates.get(owner)
      if (gate) await gate.promise
      return reply(makeSession(owner))
    }
    if (url.pathname === '/auth/v1/logout') {
      if (logoutGate) await logoutGate.promise
      return reply({}, failLogout ? 503 : 200)
    }
    if (rejectA && who === 'A') return reply({ message: 'JWT expired' }, 401)
    if (url.pathname === '/rest/v1/rpc/fishing_password_configured') return reply(true)
    if (url.pathname === '/functions/v1/amap') return reply({ code: 'MAP_SERVICE_UNAVAILABLE' }, 503)
    if (url.pathname === '/rest/v1/rpc/fishing_moderation') return reply({ allowed: false })
    if (url.pathname === '/rest/v1/rpc/fishing_read') {
      switch (body.action) {
        case 'feed':
        case 'spots':
          return reply({ items: [], next: null })
        case 'library_trips': {
          const result = { items: who === 'A' ? [trip] : [], next: null }
          if (who === 'A' && libraryGate) await libraryGate.promise
          return reply(result)
        }
        case 'library_trips': {
          if (who === 'A' && libraryGate) await libraryGate.promise
          return reply({ items: who === 'A' ? [trip] : [], next: null })
        }
        case 'library_posts':
        case 'library_spots':
          return reply({ items: [], next: null })
        case 'profile':
          return reply({
            profile: profiles[who || 'B'],
            posts: [],
            following: false,
            friend: false,
            blocked: false
          })
        default:
          return reply({ message: 'NOT_FOUND' }, 404)
      }
    }
    if (url.pathname === '/rest/v1/rpc/fishing_write') {
      if (!who) return reply({ message: 'NOT_AUTHENTICATED' }, 401)
      if (body.action === 'update_profile') {
        if (profileSaveGate) await profileSaveGate.promise
        return reply({ id: ids[who] })
      }
      return reply({ id: body.payload?.id || 'saved-fixture' })
    }
    escaped.push(`${url.pathname}:unexpected`)
    return route.abort()
  })
  const other = await context.newPage()
  other.on('pageerror', (e) => errors.push(e.message))
  const routeTo = async (target, route) => {
    await target.goto(`${base}/#${route}`)
    await target.locator('.fishing-page').waitFor()
  }
  async function login(target, who) {
    await routeTo(target, '/pages/login/index')
    // Each fixture authentication is a fresh page; do not reuse an earlier SMS countdown.
    await target.reload()
    await target.locator('.fishing-page').waitFor()
    const smsSwitch = target.getByRole('button', { name: '使用短信验证码登录', exact: true })
    if (await smsSwitch.isVisible()) await smsSwitch.click()
    await target
      .locator('input[aria-label="手机号码"]')
      .fill(who === 'A' ? '13800138000' : '13800138001')
    const consent = target.getByRole('checkbox', { name: '同意用户协议与隐私说明' })
    if ((await consent.getAttribute('aria-checked')) !== 'true') await consent.click()
    await target.getByRole('button', { name: '获取验证码', exact: true }).click()
    await target.getByText(/^验证码已发送/).waitFor()
    await target.locator('input[aria-label="短信验证码"]').fill('123456')
    await target.getByRole('button', { name: '登录 / 注册', exact: true }).click()
    await target.waitForURL((url) => !url.hash.startsWith('#/pages/login/index'))
  }
  async function waitUntil(predicate) {
    const end = Date.now() + 12000
    while (!predicate()) {
      assert.ok(Date.now() < end, 'expected fixture request did not arrive')
      await new Promise((r) => setTimeout(r, 20))
    }
  }
  const stored = async (target, key) =>
    target.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), key)
  const countRefresh = (who) =>
    requests.filter(
      (r) => r.path === '/auth/v1/token' && r.body.refresh_token.startsWith(`refresh-${who}-`)
    ).length
  async function expireFromOther() {
    await other.evaluate(() => {
      const key = 'dyj.auth.v1',
        wrapped = JSON.parse(localStorage.getItem(key))
      wrapped.data.expires_at = 1
      wrapped.data.refresh_token += '-expired-fixture'
      localStorage.setItem(key, JSON.stringify(wrapped))
    })
  }

  try {
    await login(page, 'A')
    await go('/pages/mine/library?type=trips')
    await visible(trip.title)
    const libraryBefore = requests.filter(
      (r) => r.body.action === 'library_trips' && r.who === 'A'
    ).length
    libraryGate = deferred()
    await go('/pages/home/index')
    await go('/pages/mine/library?type=trips')
    await waitUntil(
      () =>
        requests.filter((r) => r.body.action === 'library_trips' && r.who === 'A').length > libraryBefore
    )
    await login(other, 'B')
    await visible('账号已在另一页面切换，旧账号内容已清空。')
    libraryGate.release()
    libraryGate = undefined
    await visible('还没有出钓日志')
    assert.equal(await page.getByText(trip.title, { exact: true }).count(), 0)
    pass('cross-tab account switch clears a private library and rejects a late A response')

    await login(other, 'A')
    await go('/pages/post/compose?mode=trip')
    await fill('标题', 'A的待保存私人草稿')
    await fill('出钓记录', '账号A的饵料记录，不应进入账号B。')
    await login(other, 'B')
    await page.waitForFunction(
      () => document.querySelector('input[aria-label="标题"]')?.value === ''
    )
    const keyA = `dyj.live.draft.${ids.A}.trip`,
      keyB = `dyj.live.draft.${ids.B}.trip`
    assert.equal((await stored(page, keyA)).data.title, 'A的待保存私人草稿')
    assert.ok(!JSON.stringify(await stored(page, keyB)).includes('A的待保存'))
    await fill('标题', 'B自己的草稿')
    await fill('出钓记录', '账号B单独填写。')
    await page.reload()
    assert.equal(await page.locator('input[aria-label="标题"]').inputValue(), 'B自己的草稿')
    pass('private editor switches to the new account without copying or overwriting the old draft')

    await login(other, 'A')
    await page.waitForFunction(
      () => document.querySelector('input[aria-label="标题"]')?.value === 'A的待保存私人草稿'
    )
    rejectA = true
    await routeTo(other, '/pages/mine/library?type=trips')
    await page.getByText('原账号草稿已隐藏。登录原账号后可继续编辑。', { exact: true }).waitFor()
    assert.equal(await page.locator('input[aria-label="标题"]').count(), 0)
    assert.equal((await stored(page, keyA)).data.title, 'A的待保存私人草稿')
    rejectA = false
    await login(other, 'A')
    await page.waitForFunction(
      () => document.querySelector('input[aria-label="标题"]')?.value === 'A的待保存私人草稿'
    )
    pass(
      'expired authorization hides private fields, retains the owner draft and restores it only for that owner'
    )

    await go('/pages/mine/profile')
    await page.waitForFunction(() => document.querySelector('input[aria-label="昵称"]')?.value === '账号A（接口测试）')
    await fill('一句话介绍自己', '账号A尚未保存的介绍')
    profileSaveGate = deferred()
    await page.getByRole('button', { name: '保存资料', exact: true }).click()
    await waitUntil(() => requests.some((r) =>
      r.who === 'A' && r.body.action === 'update_profile' && r.body.payload.bio === '账号A尚未保存的介绍'))
    await login(other, 'B')
    await page.waitForFunction(() => document.querySelector('input[aria-label="昵称"]')?.value === '账号B（接口测试）')
    profileSaveGate.release()
    profileSaveGate = undefined
    await page.waitForFunction(() => !document.querySelector('textarea[aria-label="一句话介绍自己"]')?.disabled)
    assert.ok(new URL(page.url()).hash.startsWith('#/pages/mine/profile'))
    assert.equal(await page.locator('textarea[aria-label="一句话介绍自己"]').inputValue(), profiles.B.bio)
    assert.equal(
      requests.filter((r) => r.who === 'B' && r.body.action === 'update_profile').length,
      0
    )
    pass(
      'switching accounts while saving a profile preserves the new editor and never writes A’s changes as B'
    )

    // Messaging was removed from the product. Keep the private-library and
    // draft races above, and make sure acceptance never revives a retired page.
    const routes = pageManifest(JSON.parse(readFileSync('src/pages.json', 'utf8'))).routes
    assert.ok(!routes.some(route => route.startsWith('pages/chat/')))
    assert.equal(requests.filter(r => r.body.action === 'send_message').length, 0)
    pass('the current route manifest and session flow do not expose the retired chat service')

    await login(other, 'A')
    await routeTo(other, '/pages/login/index')
    const baselineA = countRefresh('A'),
      baselineB = countRefresh('B')
    const gateA = deferred(),
      gateB = deferred()
    refreshGates.set('A', gateA)
    await expireFromOther()
    await go('/pages/mine/library?type=trips')
    await waitUntil(() => countRefresh('A') > baselineA)
    assert.equal(countRefresh('A'), baselineA + 1)
    await login(other, 'B')
    await visible('还没有出钓日志')
    refreshGates.set('B', gateB)
    await expireFromOther()
    await go('/pages/home/index')
    await waitUntil(() => countRefresh('B') > baselineB)
    gateA.release()
    refreshGates.delete('A')
    await go('/pages/mine/library?type=trips')
    gateB.release()
    refreshGates.delete('B')
    await visible('还没有出钓日志')
    assert.equal(countRefresh('B'), baselineB + 1)
    assert.equal((await stored(page, 'dyj.auth.v1')).data.user.id, ids.B)
    pass(
      'refresh single-flight is account-bound; late A refresh cannot replace B or clear B refresh work'
    )

    await login(other, 'A')
    await page.evaluate(({ A, B }) => {
      const set = (key, value) =>
        localStorage.setItem(key, JSON.stringify({ type: 'object', data: value }))
      set(`dyj.live.chat.${A}.c`, { body: '待发送草稿' })
      set(`dyj.live.spot-draft.${A}`, { id: 'spot-draft' })
      set('dyj.live.draft.guest.post', { id: 'guest-draft' })
      set('dyj.map.selection.fixture', { longitude: 120, latitude: 30 })
      set(`dyj.live.draft.${B}.post`, { id: 'keep-B' })
      set(`dyj.demo.draft.${A}.post`, { id: 'keep-demo' })
      localStorage.setItem('unrelated-fixture', 'keep')
    }, ids)
    await routeTo(other, '/pages/post/compose?mode=trip')
    await other.locator('input[aria-label="标题"]').waitFor()
    assert.equal(await other.locator('input[aria-label="标题"]').inputValue(), 'A的待保存私人草稿')
    await go('/pages/settings/index')
    await page.getByRole('button', { name: '退出登录', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click()
    assert.ok(await stored(page, 'dyj.auth.v1'))
    assert.ok(await stored(page, keyA))
    pass('cancelling logout keeps the session and unsent drafts')
    await page.setViewportSize({ width: 320, height: 812 })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.getByRole('button', { name: '退出登录', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await dialog.waitFor()
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '取消')
    const dialogBounds = await dialog.boundingBox()
    assert.ok(
      dialogBounds && dialogBounds.y >= 16 && dialogBounds.y + dialogBounds.height <= 812 - 16,
      'logout dialog stays inside the actual viewport, even after the page scrolls'
    )
    await screenshot('logout-confirm-dark-320.png')
    await overflow('logout confirmation dark 320')
    logoutGate = deferred()
    failLogout = true
    await page.getByRole('button', { name: '清除草稿并退出', exact: true }).click()
    await waitUntil(() => requests.some((r) => r.path === '/auth/v1/logout'))
    assert.equal(await stored(page, 'dyj.auth.v1'), null)
    for (const key of [
      keyA,
      `dyj.live.chat.${ids.A}.c`,
      `dyj.live.spot-draft.${ids.A}`,
      'dyj.live.draft.guest.post',
      'dyj.map.selection.fixture'
    ])
      assert.equal(await stored(page, key), null, key)
    for (const key of [keyB, `dyj.live.draft.${ids.B}.post`, `dyj.demo.draft.${ids.A}.post`])
      assert.ok(await stored(page, key), key)
    assert.equal(await page.evaluate(() => localStorage.getItem('unrelated-fixture')), 'keep')
    logoutGate.release()
    logoutGate = undefined
    await visible('已退出本机，但未能确认服务器会话撤销。已签发的访问令牌仍可能在到期前有效。')
    await screenshot('logout-offline-dark-320.png')
    assert.equal(await page.getByRole('button', { name: '退出登录', exact: true }).count(), 0)
    pass(
      'offline logout clears local credentials and only in-scope drafts immediately, with honest revocation feedback'
    )
    await go('/pages/post/compose?mode=trip')
    await page.reload()
    await visible('登录后记录鱼情，草稿只归属于你的账号。')
    assert.equal(await page.locator('input[aria-label="标题"]').count(), 0)
    await go('/pages/spot/create')
    await visible('登录后记录钓位，草稿只归属于你的账号。')
    assert.equal(await page.locator('input[aria-label="钓位名称"]').count(), 0)
    pass('unsigned private editors do not restore or adopt guest drafts')
    await login(page, 'A')
    await other.waitForFunction(
      () => document.querySelector('input[aria-label="标题"]')?.value === ''
    )
    pass(
      'logging back into the same account cannot resurrect an explicitly cleared in-memory draft'
    )
    await go('/pages/mine/profile')
    await page.waitForFunction(
      () => document.querySelector('input[aria-label="昵称"]')?.value === '账号A（接口测试）'
    )
    await login(other, 'B')
    await page.waitForFunction(
      () => document.querySelector('input[aria-label="昵称"]')?.value === '账号B（接口测试）'
    )
    assert.equal(
      await page.getByRole('button', { name: '保存资料', exact: true }).isEnabled(),
      true
    )
    pass(
      'visible profile editor reloads the new account instead of retaining or saving the former profile'
    )
    assert.deepEqual(escaped, [])
    assert.deepEqual(errors, [])
    pass('session contract made no external service requests and exposed no uncaught errors')
  } finally {
    libraryGate?.release()
    profileSaveGate?.release()
    logoutGate?.release()
    for (const gate of refreshGates.values()) gate.release()
    await other.close()
  }
}
