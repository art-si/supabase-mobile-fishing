import assert from 'node:assert/strict'

// UI contract fixtures. Database authorization is tested separately against PostgreSQL.
export async function authorContract({
  page,
  context,
  base,
  go,
  fill,
  visible,
  pass,
  overflow,
  screenshot
}) {
  const owner = '11111111-1111-4111-8111-111111111111',
    other = '22222222-2222-4222-8222-222222222222'
  const author = {
    id: owner,
    nickname: '接口测试钓友',
    handle: 'TEST',
    city: '苏州',
    bio: '',
    method: ''
  }
  const post = {
    id: 'a1111111-1111-4111-8111-111111111111',
    author,
    title: '芦苇湾的清晨',
    body: '接口测试记录：风小，近岸见口。',
    kind: 'experience',
    species: '鲫鱼',
    method: '台钓',
    bait: '蚯蚓',
    weight_kg: 0,
    occurred_on: '2026-11-18',
    location_label: '苏州',
    audience: 'public',
    status: 'published',
    review_revision: 1,
    like_count: 3,
    comment_count: 0,
    liked: false,
    saved: false,
    media: [],
    created_at: '2026-11-19T00:00:00Z'
  }
  const spot = {
    id: 'b1111111-1111-4111-8111-111111111111',
    author,
    name: '芦苇岸边',
    city: '苏州',
    water_type: '自然水域',
    species: '鲫鱼',
    description: '接口测试钓位',
    fee_note: '未核实',
    access_note: '私人入口',
    observed_on: '2026-11-18',
    audience: 'public',
    precision: 'area',
    longitude: 120.123456,
    latitude: 31.123456,
    status: 'published',
    review_revision: 1,
    saved: false,
    created_at: post.created_at
  }
  const trip = {
    id: 'c1111111-1111-4111-8111-111111111111',
    title: '私人的周末日志',
    body: '接口测试日志',
    occurred_on: '2026-11-18',
    species: '鲫鱼',
    method: '台钓',
    bait: '蚯蚓',
    weight_kg: null,
    count: 0,
    media: [],
    revision: 1,
    created_at: post.created_at
  }
  const calls = [],
    escaped = [],
    receipts = new Map()
  let failSave = true,
    lostWithdraw = true,
    spotConflict = true,
    readFailure = false
  await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
  await context.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url())
    if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
    if (url.origin !== 'https://tlfmfokyhahlpzmpliad.supabase.co') {
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
      uid = req.headers().authorization?.includes('author-B') ? other : owner
    if (url.pathname === '/rest/v1/rpc/fishing_moderation')
      return reply(
        body.action === 'own_status' ? { status: post.status, reason: '' } : { allowed: false }
      )
    const p = body.payload || {},
      item = p.type === 'trip' ? trip : p.type === 'spot' ? spot : post
    if (url.pathname === '/rest/v1/rpc/fishing_read') {
      switch (body.action) {
        case 'edit_content':
          if (readFailure) return reply({ message: 'unavailable' }, 503)
          if (uid !== owner || p.id !== item.id) return reply({ message: 'NOT_FOUND' }, 404)
          return reply({ item, revision: item.review_revision || item.revision })
        case 'post':
          return reply({ post, comments: [] })
        case 'spot':
          return reply(spot)
        case 'library':
          return reply({ posts: [post], trips: [trip], spots: [spot] })
        case 'profile':
          return reply({
            profile: author,
            posts: [],
            friend: false,
            following: false,
            blocked: false
          })
        case 'feed':
        case 'spots':
          return reply({ items: [], next: null })
        default:
          return reply({ message: 'NOT_FOUND' }, 404)
      }
    }
    if (url.pathname === '/rest/v1/rpc/fishing_write') {
      calls.push(body)
      if (!['update_content', 'withdraw_content'].includes(body.action))
        return reply({ message: 'INVALID_INPUT' }, 400)
      if (receipts.has(p.request_id)) return reply(receipts.get(p.request_id))
      if (failSave) {
        failSave = false
        return reply({ message: 'fixture offline' }, 503)
      }
      if (p.type === 'spot' && spotConflict) {
        spotConflict = false
        spot.review_revision++
        spot.name = '另一台设备更新的钓位'
        return reply({ message: 'EDIT_CONFLICT' }, 409)
      }
      if (p.revision !== (item.review_revision || item.revision))
        return reply({ message: 'EDIT_CONFLICT' }, 409)
      if (body.action === 'withdraw_content') {
        item.audience = 'private'
        item.status = 'published'
      } else {
        Object.assign(item, p)
        item.weight_kg = p.weight === '' ? null : Number(p.weight)
        if (p.type === 'trip') item.count = p.count === '' ? null : Number(p.count)
        else item.status = p.audience === 'private' ? 'published' : 'pending'
      }
      if (p.type === 'trip') item.revision = p.revision + 1
      else item.review_revision = p.revision + 1
      const receipt = { id: item.id, revision: p.revision + 1 }
      receipts.set(p.request_id, receipt)
      if (body.action === 'withdraw_content' && lostWithdraw) {
        lostWithdraw = false
        return reply({ message: 'response lost after commit' }, 503)
      }
      return reply(receipt)
    }
    escaped.push(url.href)
    return route.abort()
  })
  const button = (name) => page.getByRole('button', { name, exact: true })
  const field = (name) => page.locator(`input[aria-label="${name}"],textarea[aria-label="${name}"]`)
  const writes = (action) => calls.filter((c) => c.action === action)
  async function waitCalls(count) {
    const deadline = Date.now() + 10000
    while (calls.length < count) {
      assert.ok(Date.now() < deadline, 'fixture write missing')
      await new Promise((r) => setTimeout(r, 20))
    }
  }
  // This suite tests author workflows, not phone verification. Use an explicit
  // isolated session; unexpected Auth requests remain rejected by the route guard.
  await context.addInitScript(
    ({ base, owner }) => {
      if (location.origin === base && !localStorage.getItem('dyj.auth.v1'))
        localStorage.setItem(
          'dyj.auth.v1',
          JSON.stringify({
            type: 'object',
            data: {
              access_token: 'author-A',
              refresh_token: 'fixture-refresh-A',
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              user: { id: owner }
            }
          })
        )
    },
    { base, owner }
  )
  await go('/pages/post/compose')
  await fill('标题', '独立的新鱼情草稿')
  await fill('鱼情与心得', '新记录草稿不应被编辑覆盖')
  await go(`/pages/post/detail?id=${post.id}`)
  await button('编辑这条鱼情').click()
  await button('提交修改审核').waitFor()
  assert.equal(await field('标题').inputValue(), post.title)
  assert.equal(await field('总重量（kg）').inputValue(), '0')
  await fill('鱼情与心得', '补充：上午更适合轻口钓法。')
  await button('提交修改审核').click()
  await waitCalls(1)
  await page.locator('.error[role="alert"]').waitFor()
  assert.equal(await field('鱼情与心得').inputValue(), '补充：上午更适合轻口钓法。')
  await button('提交修改审核').click()
  await page.waitForURL((u) => u.hash.startsWith('#/pages/post/detail'))
  assert.equal(
    writes('update_content')[0].payload.request_id,
    writes('update_content')[1].payload.request_id
  )
  assert.equal(post.review_revision, 2)
  assert.equal(post.like_count, 3)
  assert.equal(post.status, 'pending')
  pass('author edit retries the same command, keeps interactions, and resubmits shared content')
  await go('/pages/post/compose')
  assert.equal(await field('标题').inputValue(), '独立的新鱼情草稿')
  pass('editing an existing post never replaces the independent new-post draft')
  await go(`/pages/post/detail?id=${post.id}`)
  await button('撤回分享').click()
  await button('继续分享').click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(writes('withdraw_content').length, 0)
  await button('撤回分享').click()
  await page.getByRole('dialog').getByRole('button', { name: '撤回分享', exact: true }).click()
  await waitCalls(3)
  await page.locator('.error[role="alert"]').waitFor()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await button('撤回分享').click()
  await page.getByRole('dialog').getByRole('button', { name: '撤回分享', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await button('撤回分享').waitFor({ state: 'hidden' })
  assert.equal(
    writes('withdraw_content')[0].payload.request_id,
    writes('withdraw_content')[1].payload.request_id
  )
  assert.equal(post.review_revision, 3)
  assert.equal(post.audience, 'private')
  await page.getByText('已改为仅自己可见', { exact: true }).waitFor({ state: 'hidden' })
  pass('withdraw cancellation writes nothing; lost-success retry uses its original receipt')
  await page.setViewportSize({ width: 320, height: 700 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await go(`/pages/spot/create?id=${spot.id}`)
  await button('提交修改审核').waitFor()
  await fill('钓位名称', '本机尚未保存的钓位名')
  await button('提交修改审核').click()
  await visible('这条记录已有新版本')
  assert.ok(await button('提交修改审核').isDisabled())
  assert.equal(await field('钓位名称').inputValue(), '本机尚未保存的钓位名')
  await page.evaluate(() => (document.documentElement.style.fontSize = '20px'))
  await overflow('edit conflict / 320px dark / enlarged text')
  await screenshot('author-conflict-dark-320.png')
  await button('重新读取新版本').click()
  const dialog = page.getByRole('alertdialog')
  await dialog.waitFor()
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent?.trim()),
    '保留当前修改'
  )
  await screenshot('author-reload-confirm-dark-320.png')
  await button('保留当前修改').click()
  assert.equal(await field('钓位名称').inputValue(), '本机尚未保存的钓位名')
  // Full reload must preserve the old expected revision instead of silently upgrading it.
  await page.reload()
  await visible('这条记录已有新版本')
  assert.equal(await field('钓位名称').inputValue(), '本机尚未保存的钓位名')
  await button('重新读取新版本').click()
  await button('读取新版本').click()
  await page.waitForFunction(
    () => document.querySelector('input[aria-label="钓位名称"]')?.value === '另一台设备更新的钓位'
  )
  await fill('钓位名称', '核实后的岸边入口')
  await button('提交修改审核').click()
  await page.waitForURL((u) => u.hash.startsWith('#/pages/spot/detail'))
  assert.equal(spot.review_revision, 3)
  pass(
    'stale edits survive reload; cancel preserves input; confirmed refresh uses the new revision'
  )
  await page.setViewportSize({ width: 440, height: 956 })
  await page.emulateMedia({ colorScheme: 'light' })
  await go('/pages/mine/library?type=trips')
  await button('编辑日志').click()
  await button('保存修改').waitFor()
  assert.equal(await field('渔获 1 尾数').inputValue(), '0')
  assert.equal(await field('渔获 1 重量（kg）').inputValue(), '')
  await fill('鱼情与心得', '补充私人日志')
  await overflow('trip editor / 440px light')
  await screenshot('author-trip-light-440.png')
  await button('保存修改').click()
  await page.waitForURL((u) => u.hash.startsWith('#/pages/mine/library'))
  const last = writes('update_content').at(-1).payload
  assert.equal(last.type, 'trip')
  assert.ok(!('audience' in last) && !('location_label' in last))
  assert.equal(trip.count, 0)
  assert.equal(trip.weight_kg, null)
  pass('private log editing preserves date and zero catch without adding sharing fields')
  readFailure = true
  await go(`/pages/post/compose?edit=${post.id}`)
  await button('重试读取记录').waitFor()
  assert.equal(await field('标题').count(), 0)
  readFailure = false
  await button('重试读取记录').click()
  await button('保存修改').waitFor()
  pass('failed owner read exposes retry, never a writable empty editor')
  await fill('标题', '账号A未保存的修改')
  const otherPage = await context.newPage()
  await otherPage.goto(base)
  await otherPage.evaluate((other) => {
    const key = 'dyj.auth.v1',
      value = JSON.parse(localStorage.getItem(key))
    value.data.access_token = 'author-B'
    value.data.refresh_token = 'fixture-refresh-B'
    value.data.user.id = other
    localStorage.setItem(key, JSON.stringify(value))
  }, other)
  await button('重试读取记录').waitFor()
  assert.equal(await field('标题').count(), 0)
  assert.equal(await page.getByText('账号A未保存的修改', { exact: true }).count(), 0)
  await otherPage.close()
  pass('cross-tab account switch hides the previous author editor and cannot transfer its draft')
  assert.deepEqual(escaped, [])
}
