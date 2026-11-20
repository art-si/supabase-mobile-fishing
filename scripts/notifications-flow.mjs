import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setH5TextScale } from './h5-text-scale.mjs'

// Same UI/business assertions against local PostgreSQL and real isolated hosted sessions.
export async function notificationsFlow({
  page,
  data,
  project,
  button,
  go,
  replyFor,
  shot,
  check,
  accountPage,
  setPhase,
  offline
}) {
  const { post, root, replyBody } = data.commentFixture
  const path = '/pages/notifications/index'
  let slowNotices = false
  // Delay requests only; both isolated and hosted runs still use their actual API response.
  await page.route('**/rest/v1/rpc/fishing_notifications', async (route) => {
    if (
      slowNotices &&
      ['refresh', 'set_preference'].includes(route.request().postDataJSON()?.action)
    )
      await new Promise((resolve) => setTimeout(resolve, 2200))
    await route.fallback()
  })
  const rows = () => page.locator('.inbox-row:visible')
  setPhase('notifications-entry')
  const initial = replyFor(page, 'page')
  await go(page, path)
  const response = await initial
  assert.equal(response.status(), 200)
  const publicKey = (await response.request().allHeaders()).apikey
  async function rpc(label, kind, action, payload = {}) {
    const token = data.accounts.find((x) => x.label === label)?.session.access_token
    return page.evaluate(
      async ({ url, key, token, action, payload }) => {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            apikey: key,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ action, payload }),
          signal: AbortSignal.timeout(20000)
        })
        return { status: response.status, json: await response.json() }
      },
      { url: `${project}/rest/v1/rpc/fishing_${kind}`, key: publicKey, token, action, payload }
    )
  }
  const ok = async (...args) => {
    const result = await rpc(...args)
    assert.equal(result.status, 200, `${args[1]}/${args[2]}: ${JSON.stringify(result.json)}`)
    return result.json
  }
  const reload = async () => {
    const response = replyFor(page, 'page')
    await button(page, '刷新通知').click()
    assert.equal((await response).status(), 200)
    await button(page, '刷新通知').waitFor({ state: 'visible' })
  }
  if (!data.run) {
    const emptyInbox = await accountPage('b')
    await go(emptyInbox, path)
    await emptyInbox.getByText('还没有互动通知', { exact: true }).waitFor()
    await ok('a', 'write', 'comment', {
      id: randomUUID(),
      post_id: post,
      reply_to_id: data.commentFixture.reply,
      body: '空收件箱收到第一条回复'
    })
    await button(emptyInbox, '有新通知，刷新查看').waitFor()
    check(
      (await emptyInbox.getByText('还没有互动通知', { exact: true }).count()) === 0,
      'First incoming event replaces the empty message with refresh guidance'
    )
    await button(emptyInbox, '有新通知，刷新查看').click()
    await emptyInbox.locator('.inbox-row').filter({ hasText: '空收件箱收到第一条回复' }).waitFor()
    check(true, 'Refreshing an initially empty inbox displays the first authorized notification')
    await emptyInbox.close()
  }
  await rows().filter({ hasText: replyBody }).waitFor()
  check(true, 'H5 receives live reply event without copied post or comment snapshots')
  check(
    (await response.json()).items.some((x) => x.kind === 'friend_accepted'),
    'Friend acceptance and comment replies share the interaction section'
  )
  const notice = (await ok('a', 'notifications', 'page')).items.find((x) => x.kind === 'reply')
  check(
    (await rpc('outsider', 'notifications', 'open', { id: notice.id })).status === 400,
    'Another identity cannot open a notification by guessing its ID'
  )
  await rows().filter({ hasText: replyBody }).click()
  await page.waitForURL(`**/pages/post/detail?id=${post}`)
  check(
    (await ok('a', 'notifications', 'page')).items.find((x) => x.id === notice.id).read,
    'Opening reauthorizes the target and persists read state'
  )
  await go(page, path)
  await rows().filter({ hasText: replyBody }).waitFor()
  const freshId = randomUUID()
  await ok('b', 'write', 'comment', {
    id: freshId,
    post_id: post,
    body: '通知验收：刚收到的新评论'
  })
  // An empty-v1 realtime event may refresh current rows, but never prepends new rows.
  check(
    (await rows().filter({ hasText: '通知验收：刚收到的新评论' }).count()) === 0,
    'Incoming events do not shift a currently read list'
  )
  await button(page, '已显示的标为已读').click()
  const afterRead = await ok('a', 'notifications', 'page')
  check(
    !afterRead.items.find((x) => x.preview === '通知验收：刚收到的新评论').read,
    'Mark displayed read never marks an unseen concurrent event'
  )
  await reload()
  await rows().filter({ hasText: '通知验收：刚收到的新评论' }).waitFor()
  check(true, 'Explicit refresh reveals the latest notification')

  setPhase('notification-settings')
  await button(page, '通知设置').click()
  const dialog = page.getByRole('dialog')
  const likeToggle = dialog.getByRole('button', { name: /点赞提醒/ })
  await likeToggle.click()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[role="dialog"] [role="button"]')].some(
      (b) => b.textContent.includes('点赞提醒') && b.getAttribute('aria-pressed') === 'false'
    )
  )
  check(
    !(await ok('a', 'notifications', 'preferences')).likes,
    'Preference switch persists server-side instead of only changing its look'
  )
  await ok('b', 'write', 'reaction', { id: post, kind: 'like', enabled: true })
  check(
    !(await ok('a', 'notifications', 'page')).items.some((x) => x.kind === 'like'),
    'Disabled likes suppress subsequent notifications'
  )
  await likeToggle.click()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[role="dialog"] [role="button"]')].some(
      (b) => b.textContent.includes('点赞提醒') && b.getAttribute('aria-pressed') === 'true'
    )
  )
  await ok('b', 'write', 'reaction', { id: post, kind: 'like', enabled: false })
  await ok('b', 'write', 'reaction', { id: post, kind: 'like', enabled: true })
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  check(
    await button(page, '通知设置').evaluate((el) => el === document.activeElement),
    'Closing notification settings restores keyboard focus'
  )
  await reload()
  await rows().filter({ hasText: '赞了你的动态' }).waitFor()
  check(true, 'Reenabled preference receives new events without suppressed history')

  setPhase('notifications-visual')
  const visualCases = [
    ['lake', 'light', 375, 812, 16],
    ['ocean', 'light', 440, 956, 16],
    ['stone', 'light', 320, 740, 16],
    ['lake', 'dark', 375, 812, 16],
    ['ocean', 'dark', 440, 956, 16],
    ['stone', 'dark', 320, 740, 24],
    ['lake', 'light', 320, 740, 32],
    ['lake', 'light', 812, 375, 16],
    ['ocean', 'dark', 1280, 800, 16]
  ]
  for (const [skin, scheme, width, height, scale] of visualCases.filter(
    (_, i) => !data.run || [0, 5, 8].includes(i)
  )) {
    await page.evaluate(
      (skin) =>
        localStorage.setItem(
          'dyj.appearance.skin.v1',
          JSON.stringify({ type: 'string', data: skin })
        ),
      skin
    )
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
    await page.setViewportSize({ width, height })
    await page.reload()
    await rows().filter({ hasText: '赞了你的动态' }).waitFor()
    await setH5TextScale(page, scale)
    await shot(`notifications-${skin}-${scheme}-${width}-${scale}`, page)
    check(
      await page.evaluate(
        () =>
          Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) <=
          innerWidth + 1
      ),
      `Inbox fits ${skin} ${scheme} ${width}px text ${scale}px`
    )
    check(
      await rows().evaluateAll((rows) =>
        rows.every((row) => row.getBoundingClientRect().height >= 44)
      ),
      'Notification rows retain comfortable touch targets'
    )
    const contrast = await page.evaluate(() => {
      const rgb = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
      const luminance = (values) =>
        values
          .map((v) => {
            const x = v / 255
            return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
          })
          .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0)
      const row = document.querySelector('.inbox-row'),
        panel = document.querySelector('.inbox-list')
      const bg = luminance(rgb(getComputedStyle(panel).backgroundColor))
      return ['.name', '.muted', '.caption', '.inbox-unread'].map((selector) => {
        const fg = luminance(rgb(getComputedStyle(row.querySelector(selector)).color))
        return (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05)
      })
    })
    check(
      contrast.every((value) => value >= 4.5),
      `Measured text contrast above 4.5 to 1 in ${skin} ${scheme}: ${contrast.map((v) => v.toFixed(2)).join(' ')}`
    )
    if (scale === 24) {
      await button(page, '通知设置').click()
      await page.getByRole('dialog').waitFor()
      slowNotices = true
      await page.waitForRequest(
        (request) =>
          request.url().endsWith('/fishing_notifications') &&
          request.postDataJSON()?.action === 'refresh'
      )
      const toggle = page.getByRole('dialog').getByRole('button', { name: /点赞提醒/ })
      check(
        await toggle.isEnabled(),
        'Background revalidation leaves notification controls interactive'
      )
      await toggle.click()
      await page.getByText('正在保存设置…', { exact: true }).waitFor()
      check(
        await toggle.isDisabled(),
        'Explicit save alone disables controls and announces progress'
      )
      check(
        await toggle.evaluate((el) => getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)'),
        'Disabled dark settings row keeps its semantic surface without a white flash'
      )
      await shot('notification-settings-saving-stone-dark-320-24', page)
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[role="dialog"] [role="button"]')].some(
          (b) => b.textContent.includes('点赞提醒') && b.getAttribute('aria-pressed') === 'false'
        )
      )
      await toggle.click()
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[role="dialog"] [role="button"]')].some(
          (b) => b.textContent.includes('点赞提醒') && b.getAttribute('aria-pressed') === 'true'
        )
      )
      slowNotices = false
      check(
        (await ok('a', 'notifications', 'preferences')).likes,
        'Explicit settings save wins over a previously delayed refresh'
      )
      await shot('notification-settings-stone-dark-320-24', page)
      check(
        await page.evaluate(
          () =>
            Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) <=
            innerWidth + 1
        ),
        'Settings sheet fits narrow dark large text'
      )
      await page.keyboard.press('Escape')
    }
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'light' })
  await setH5TextScale(page, 16)
  await button(page, '互动').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Space')
  await page.getByText('还没有系统通知', { exact: true }).waitFor()
  check(
    (await button(page, '系统').getAttribute('aria-pressed')) === 'true',
    'Segmented navigation supports keyboard focus and explicit activation'
  )
  await button(page, '互动').click()
  await rows().filter({ hasText: replyBody }).waitFor()

  setPhase('notification-privacy')
  const peer = data.accounts.find((x) => x.label === 'b').session.user.id
  const requestCount = []
  const requestListener = (request) => {
    if (request.url().endsWith('/fishing_notifications')) requestCount.push(request.url())
  }
  page.on('request', requestListener)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(11000)
  const quiet = requestCount.length
  check(
    quiet === 0 && (await rows().count()) === 0,
    'Background stops notification polling and clears private previews'
  )
  await ok('b', 'write', 'delete_comment', { id: freshId, post_id: post })
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await rows().filter({ hasText: replyBody }).waitFor()
  check(
    (await rows().filter({ hasText: '通知验收：刚收到的新评论' }).count()) === 0,
    'Foreground reauthorization cannot revive a deleted comment preview'
  )
  page.off('request', requestListener)
  if (offline) {
    await offline(true)
    await button(page, '刷新通知').click()
    await page.getByText('通知未能更新', { exact: true }).waitFor()
    check((await rows().count()) === 0, 'Failed authorization refresh clears stale private rows')
    await offline(false)
    await button(page, '重试').click()
    await rows().filter({ hasText: replyBody }).waitFor()
    check(true, 'Explicit retry recovers after network failure')
  }

  setPhase('notification-system-results')
  const report = await ok('b', 'reports', 'submit', {
    id: root,
    type: 'comment',
    reason: '通知回执隔离验收'
  })
  const current = await ok('outsider', 'reports', 'item', { id: report.id })
  await ok('outsider', 'reports', 'decide', {
    id: report.id,
    revision: current.report.revision,
    content_revision: current.content.revision,
    decision: 'hide',
    reason: '通知验收：暂时隐藏后复核',
    request_id: randomUUID()
  })
  await button(page, '系统').click()
  await rows().filter({ hasText: '评论已被隐藏' }).waitFor()
  check(true, 'Moderation result appears in the author system inbox')
  const reportNotice = (await ok('b', 'notifications', 'page', { category: 'system' })).items.find(
    (x) => x.kind === 'report_result'
  )
  check(
    reportNotice.target.type === 'reports' &&
      !JSON.stringify(reportNotice).includes('通知回执隔离验收'),
    'Reporter result carries no evidence copy or moderator identity'
  )
  const reporter = await accountPage('b')
  await go(reporter, path)
  await button(reporter, '系统').click()
  await reporter.locator('.inbox-row').filter({ hasText: '举报已有处理结果' }).click()
  await reporter.waitForURL('**/pages/content-report/index')
  await reporter.getByText('通知验收：暂时隐藏后复核', { exact: true }).waitFor()
  check(true, 'Report notification opens reporter-owned outcome without privileged review access')
  await reporter.close()
  await rows().filter({ hasText: '评论已被隐藏' }).click()
  await page.waitForURL(`**/pages/post/detail?id=${post}`)
  check(true, 'Author review notice opens the currently authorized parent detail')
  await go(page, path)
  await button(page, '互动').click()
  await rows().filter({ hasText: '赞了你的动态' }).waitFor()
  await ok('a', 'write', 'block', { id: peer, enabled: true })
  await reload()
  check(
    (await rows().filter({ hasText: replyBody }).count()) === 0 &&
      (await page.locator('.inbox-unread:visible').count()) === 0,
    'Blocking clears previews and unread badges without opening old content'
  )
  await shot('notifications-unavailable-375', page)
  await go(page, '/pages/home/index?tab=messages')
  await page.getByRole('button', { name: /^互动与系统通知/ }).click()
  await page.waitForURL('**/pages/notifications/index')
  check(true, 'Messages entry opens the inbox without adding another main tab')
  await go(page, '/pages/settings/index')
  await page.getByRole('button', { name: /^通知设置/ }).click()
  await page.getByRole('dialog').waitFor()
  check(true, 'Settings entry opens the existing notification preferences sheet')
  await page.keyboard.press('Escape')
  setPhase('notifications-complete')
}
