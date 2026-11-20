import assert from 'node:assert/strict'

export async function moderationContract({
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
  const reviewer = '33333333-3333-4333-8333-333333333333',
    calls = [],
    escaped = []
  const author = {
    id: '11111111-1111-4111-8111-111111111111',
    nickname: '接口测试钓友',
    handle: 'TEST',
    city: '苏州',
    bio: '',
    method: ''
  }
  const post = {
    id: 'a1111111-1111-4111-8111-111111111111',
    type: 'post',
    title: '待审鱼情（接口测试）',
    body: '这是接口测试内容，不是真实用户发布。',
    author,
    audience: 'public',
    status: 'pending',
    revision: 1,
    created_at: '2026-11-19T00:00:00Z',
    details: { 鱼种: '鲫鱼', 钓法: '台钓' },
    media: [
      {
        id: 'd1111111-1111-4111-8111-111111111111',
        path: 'fixture/review.png',
        width: 100,
        height: 100
      }
    ]
  }
  const spot = {
    ...post,
    id: 'b1111111-1111-4111-8111-111111111111',
    type: 'spot',
    title: '待审钓位（接口测试）',
    media: []
  }
  let allowed = false,
    photoAvailable = false,
    failDecision = true,
    conflict = false,
    signed = 0
  await context.routeWebSocket(/supabase\.co/, socket => socket.close())
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url())
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
    if (request.method() === 'OPTIONS') return reply({})
    if (url.pathname === '/auth/v1/otp') return reply({})
    if (url.pathname === '/auth/v1/verify')
      return reply({
        access_token: 'review-fixture-token',
        refresh_token: 'review-fixture-refresh',
        expires_at: Date.now() / 1000 + 3600,
        user: { id: reviewer }
      })
    if (url.pathname.startsWith('/storage/v1/object/sign/')) {
      if (request.method() === 'POST')
        return photoAvailable
          ? reply({
              signedURL: `/object/sign/fishing-media/fixture/review.png?fixture=${++signed}`
            })
          : reply({ message: 'unavailable' }, 503)
      // Tiny test-only image; this is not a real user catch or a moderation result.
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ1kAAAAASUVORK5CYII=',
          'base64'
        ),
        headers: { 'access-control-allow-origin': '*' }
      })
    }
    const body = request.postDataJSON()
    if (url.pathname === '/rest/v1/rpc/fishing_read')
      return reply({
        post: {
          ...post,
          author: { ...author, id: reviewer },
          status: 'rejected',
          kind: 'catch',
          media: [],
          species: '',
          method: '',
          bait: '',
          location_label: '',
          weight_kg: null,
          occurred_on: '2026-11-19',
          liked: false,
          saved: false,
          like_count: 0,
          comment_count: 0
        },
        comments: []
      })
    if (url.pathname !== '/rest/v1/rpc/fishing_moderation') {
      escaped.push(url.pathname)
      return route.abort()
    }
    assert.equal(request.headers().authorization, 'Bearer review-fixture-token')
    calls.push(body)
    if (body.action === 'access') return reply({ allowed })
    if (body.action === 'own_status')
      return reply({ status: 'rejected', reason: '请补充水域开放与禁钓说明' })
    if (!allowed) return reply({ message: 'FORBIDDEN', code: 'P0001' }, 400)
    if (body.action === 'queue')
      return reply({
        items: body.payload.cursor ? [spot] : [post],
        next: body.payload.cursor
          ? null
          : { id: post.id, type: 'post', created_at: post.created_at }
      })
    if (body.action === 'item') return reply(body.payload.id === spot.id ? spot : post)
    if (body.action === 'decide') {
      if (failDecision) {
        failDecision = false
        return reply({ message: 'temporary' }, 503)
      }
      if (conflict) {
        conflict = false
        post.revision++
        post.body = '作者更新后的内容，需重新阅读。'
        return reply({ message: 'REVIEW_CONFLICT', code: 'P0001' }, 400)
      }
      post.status = body.payload.decision
      post.revision++
      return reply({ status: post.status, revision: post.revision })
    }
    escaped.push(body.action)
    return route.abort()
  })
  await go('/pages/settings/index')
  assert.equal(await page.getByRole('button', { name: /内容审核/ }).count(), 0)
  await go('/pages/moderation/index')
  await visible('仅审核员可访问')
  assert.equal(calls.length, 0)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await fill('手机号码', '13800138000')
  await page.locator('[aria-label="同意用户协议与隐私说明"]').click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByText(/^验证码已发送/).waitFor()
  await fill('短信验证码', '123456')
  await page.getByRole('button', { name: '登录 / 注册', exact: true }).click()
  await visible('你没有执行此操作的权限')
  pass('guest gate and unauthorized member review denial work (fixture Auth, no real SMS)')
  await go('/pages/settings/index')
  await page.reload()
  await page.waitForFunction(() => document.body.innerText.includes('主题皮肤'))
  assert.equal(await page.getByRole('button', { name: /内容审核/ }).count(), 0)
  allowed = true
  await page.reload()
  await page.getByRole('button', { name: /内容审核/ }).click()
  await visible(post.title)
  await page.getByRole('button', { name: '继续查看', exact: true }).click()
  await visible(spot.title)
  await screenshot('moderation-queue-375.png')
  pass('server capability reveals settings entry and cursor pagination works')
  await page.getByRole('button', { name: `审核：${post.title}`, exact: true }).click()
  await visible(post.title)
  await visible('照片暂不可用')
  assert.equal(await page.getByRole('button', { name: '通过审核', exact: true }).isDisabled(), true)
  pass('unreadable review photos prevent approval')
  photoAvailable = true
  await page.getByRole('button', { name: '重新读取照片', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[aria-label*="查看大图"]'))
  const approve = page.getByRole('button', { name: '通过审核', exact: true })
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[role="button"]')].some(
      (el) => el.textContent.trim() === '通过审核' && el.getAttribute('aria-disabled') !== 'true'
    )
  )
  await screenshot('moderation-detail-375.png')
  await approve.click()
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(calls.filter((c) => c.action === 'decide').length, 0)
  pass('photo retry restores approval and Escape cancels without a mutation')
  await page.getByRole('button', { name: '退回内容', exact: true }).click()
  await page.getByRole('button', { name: '确认退回内容', exact: true }).click()
  await visible('请说明原因，作者会看到这段说明')
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === '处理说明'
  )
  assert.equal(calls.filter((c) => c.action === 'decide').length, 0)
  await fill('处理说明', '请补充水域开放与禁钓说明')
  await page.getByRole('button', { name: '确认退回内容', exact: true }).click()
  await visible('服务暂时不可用，请稍后重试')
  assert.equal(
    await page.locator('textarea[aria-label="处理说明"]').inputValue(),
    '请补充水域开放与禁钓说明'
  )
  await page.getByRole('button', { name: '确认退回内容', exact: true }).click()
  await visible('已退回内容，结果已记录。')
  const submitted = calls.filter((c) => c.action === 'decide')
  assert.equal(submitted[0].payload.request_id, submitted[1].payload.request_id)
  pass(
    'rejection validates its reason, retains failed input, and retries with the same idempotency key'
  )
  conflict = true
  await page.getByRole('button', { name: '通过审核', exact: true }).click()
  await page.getByRole('button', { name: '确认通过审核', exact: true }).click()
  await visible('内容已更新或已被处理，请重新读取后再审核')
  assert.equal(await page.getByRole('button', { name: '确认通过审核', exact: true }).count(), 0)
  await page.getByRole('button', { name: '重新读取内容', exact: true }).click()
  await visible('作者更新后的内容，需重新阅读。')
  pass('stale review is stopped and reloads the latest body before a new decision')
  await page.setViewportSize({ width: 320, height: 812 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.getByRole('button', { name: '通过审核', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  await overflow('review sheet dark 320')
  await screenshot('moderation-sheet-dark-320.png')
  await page.getByRole('button', { name: '确认通过审核', exact: true }).click()
  await visible('已通过审核，结果已记录。')
  await page.setViewportSize({ width: 768, height: 450 })
  await overflow('review detail landscape')
  await screenshot('moderation-detail-landscape.png')
  await go(`/pages/post/detail?id=${post.id}`)
  await visible('请补充水域开放与禁钓说明')
  pass('author detail shows the private review explanation')
  await go('/pages/moderation/index')
  await visible(post.title)
  allowed = false
  await page.getByRole('button', { name: '刷新列表', exact: true }).click()
  await visible('你没有执行此操作的权限')
  assert.equal(
    await page.getByRole('button', { name: `审核：${post.title}`, exact: true }).count(),
    0
  )
  assert.deepEqual(escaped, [])
  pass('permission revocation clears privileged list; all service calls were intercepted fixtures')
}
