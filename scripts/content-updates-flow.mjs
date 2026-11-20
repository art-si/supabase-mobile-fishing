import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setH5TextScale } from './h5-text-scale.mjs'

// Shared author/reviewer flow. Local PostgreSQL and hosted runs have distinct evidence labels.
export async function contentUpdatesFlow({
  page: author,
  data,
  project,
  button,
  field,
  go,
  replyFor,
  shot: screenshot,
  check,
  accountPage,
  setPhase,
  offline
}) {
  const shot = async (name, tab, fullPage = true) => {
    await tab.evaluate(async () => {
      await document.fonts.ready
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
    await screenshot(name, tab, fullPage)
  }
  const friend = await accountPage('b'),
    reviewer = await accountPage('outsider')
  const post = data.commentFixture.post,
    detail = `/pages/post/detail?id=${post}`
  setPhase('update-author-load')
  const initial = replyFor(author, 'post')
  await go(author, detail)
  const response = await initial
  assert.equal(response.status(), 200)
  const initialPost = (await response.json()).post
  const publicKey = (await response.request().allHeaders()).apikey
  async function rpc(label, kind, action, payload = {}) {
    return author.evaluate(
      async ({ url, key, token, action, payload }) => {
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            apikey: key,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ action, payload }),
          signal: AbortSignal.timeout(20000)
        })
        return { status: r.status, json: await r.json() }
      },
      {
        url: `${project}/rest/v1/rpc/fishing_${kind}`,
        key: publicKey,
        token: data.accounts.find((a) => a.label === label)?.session.access_token,
        action,
        payload
      }
    )
  }
  const ok = async (label, kind, action, payload = {}) => {
    const result = await rpc(label, kind, action, payload)
    assert.equal(result.status, 200, `${action}: ${JSON.stringify(result.json)}`)
    return result.json
  }
  const fits = async (tab, label) =>
    check(
      await tab.evaluate(
        () =>
          Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) <=
          innerWidth + 1
      ),
      label
    )
  const publishedBody = (tab) => tab.locator('.post-card .body').innerText()
  const loadDetail = async (tab) => {
    await go(tab, detail)
    await tab.locator('.post-card').waitFor()
  }
  const saveEdit = async (body) => {
    await button(author, '编辑这条鱼情').click()
    await field(author, '鱼情与心得').waitFor()
    if (await author.getByText('这条记录已有新版本', { exact: true }).isVisible()) {
      check(
        await button(author, '提交修改审核').isDisabled(),
        'Cached proposal retains its old revision after a review decision'
      )
      await button(author, '重新读取新版本').click()
      await button(author, '读取新版本').click()
      await author.getByText('这条记录已有新版本', { exact: true }).waitFor({ state: 'hidden' })
    }
    await field(author, '鱼情与心得').fill(body)
    const saved = replyFor(author, 'update_content')
    await button(author, '提交修改审核').click()
    assert.equal((await saved).status(), 200)
    await author.getByText('修改待审核', { exact: true }).waitFor()
  }
  await author.locator('.post-card').waitFor()
  await button(author, '编辑这条鱼情').click()
  await author.getByText('修改通过审核后替换当前版本', { exact: true }).waitFor()
  const proposed = '修改稿：补充现场水情与照片，仅在审核后替换。'
  await field(author, '鱼情与心得').fill(proposed)
  const chooser = author.waitForEvent('filechooser'),
    uploaded = author.waitForResponse(
      (r) => r.url() === `${project}/functions/v1/media-upload` && r.request().method() === 'POST'
    )
  await author.getByRole('button', { name: /^添加照片/ }).click()
  await (
    await chooser
  ).setFiles({
    name: 'synthetic-content-update.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data.photo, 'base64')
  })
  const upload = await uploaded
  assert.equal(upload.status(), 200)
  const photo = await upload.json()
  await author.waitForFunction(
    () =>
      ![...document.querySelectorAll('[role="status"]')].some((n) => n.textContent === '上传中…')
  )
  const saved = replyFor(author, 'update_content')
  await button(author, '提交修改审核').click()
  assert.equal((await saved).status(), 200)
  await author.getByText('修改待审核', { exact: true }).waitFor()
  check(
    (await publishedBody(author)) === initialPost.body,
    'Author detail keeps the effective version and shows pending-update state'
  )
  check(
    (await author.locator('.post-card .photo').count()) === 0,
    'Staged photo is not displayed as a current photo'
  )
  await loadDetail(friend)
  check(
    (await publishedBody(friend)) === initialPost.body &&
      (await friend.getByText('修改待审核', { exact: true }).count()) === 0,
    'Friend sees the unchanged current version without author-only review metadata'
  )
  check(
    (await button(friend, '取消这次修改').count()) === 0,
    'Another viewer cannot cancel the author proposal'
  )
  await button(author, '编辑这条鱼情').click()
  await author.getByText('正在编辑已提交的修改', { exact: true }).waitFor()
  await button(author, '分享范围').click()
  await button(author, '仅自己').click()
  await author.getByText('保存后仅自己可见', { exact: true }).waitFor()
  check(
    await button(author, '保存修改').isVisible(),
    'Private edit choice explains immediate withdrawal instead of pending review'
  )
  await author.setViewportSize({ width: 320, height: 740 })
  await setH5TextScale(author, 24)
  await fits(author, 'Private edit explanation fits 320px large text')
  await shot('editor-private-320-large', author)
  await setH5TextScale(author, 16)
  await author.setViewportSize({ width: 375, height: 812 })
  await button(author, '分享范围').click()
  await button(author, '仅好友').click()
  check(
    (await field(author, '鱼情与心得').inputValue()) === proposed,
    'Reopening editor restores the latest submitted proposal'
  )
  check(
    (await author.locator('.compose-photo').count()) === 1,
    'Owner editor resolves the staged photo'
  )
  await loadDetail(author)
  const ownerTargets = await Promise.all(
    ['编辑这条鱼情', '取消这次修改', '撤回分享'].map((label) => button(author, label).boundingBox())
  )
  check(
    ownerTargets.length === 3 && ownerTargets.every((b) => b && b.width >= 44 && b.height >= 44),
    'Owner actions keep at least 44px touch targets'
  )
  await shot('author-pending-375', author)

  setPhase('update-review-compare')
  let blockPhotos = true
  await reviewer.route('**/storage/v1/object/sign/fishing-media/**', (route) =>
    blockPhotos && route.request().method() === 'GET'
      ? route.abort('internetdisconnected')
      : route.fallback()
  )
  await go(reviewer, '/pages/moderation/index')
  await button(reviewer, `审核修改：${initialPost.title}`).click()
  await button(reviewer, '通过修改').waitFor()
  check(
    reviewer.url().includes('update=1'),
    'Queue explicitly routes proposals to the revision-review action'
  )
  await reviewer.getByText('照片暂不可用', { exact: true }).waitFor()
  check(await button(reviewer, '通过修改').isDisabled(), 'Unread proposal photo blocks approval')
  await button(reviewer, '当前版本').click()
  check(
    (await reviewer.locator('.review-body').innerText()) === initialPost.body,
    'Reviewer can compare the original effective body'
  )
  check(
    (await button(reviewer, '通过修改').isDisabled()) &&
      (await button(reviewer, '退回修改').isDisabled()),
    'Both decision buttons are disabled while viewing the current version'
  )
  blockPhotos = false
  await button(reviewer, '本次修改').click()
  await reviewer.waitForFunction(() =>
    [...document.querySelectorAll('[role="button"]')].some(
      (n) =>
        n.textContent?.trim() === '通过修改' &&
        !n.hasAttribute('disabled') &&
        n.getAttribute('aria-disabled') !== 'true'
    )
  )
  check(
    (await reviewer.locator('.review-body').innerText()) === proposed,
    'Returning to proposal shows its text and freshly loaded photo before approval'
  )
  await shot('review-proposal-375', reviewer)
  for (const width of [320, 440, 844, 1280]) {
    await reviewer.setViewportSize({ width, height: width === 844 ? 390 : 900 })
    await fits(reviewer, `Proposal comparison fits ${width}px viewport`)
  }
  for (const skin of ['lake', 'ocean', 'stone'])
    for (const scheme of ['light', 'dark']) {
      await reviewer.evaluate(
        (skin) =>
          localStorage.setItem(
            'dyj.appearance.skin.v1',
            JSON.stringify({ type: 'string', data: skin })
          ),
        skin
      )
      await reviewer.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      await reviewer.setViewportSize({ width: 375, height: 812 })
      await reviewer.reload()
      await button(reviewer, '通过修改').waitFor()
      await fits(reviewer, `Proposal reviewer fits ${skin} ${scheme}`)
      const metrics = await reviewer.evaluate(() => {
        const rgb = (color) =>
          color
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number)
        const lum = (values) =>
          values
            .map((v) => {
              v /= 255
              return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
            })
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
        const panel = document.querySelector('.fishing-content .panel'),
          bg = lum(rgb(getComputedStyle(panel).backgroundColor))
        const ratios = ['.heading', '.review-body', '.caption'].map((selector) => {
          const fg = lum(rgb(getComputedStyle(panel.querySelector(selector)).color))
          return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)
        })
        const buttons = [...document.querySelectorAll('.mobile-segmented__option')].map((n) => {
          const b = n.getBoundingClientRect()
          return { width: b.width, height: b.height }
        })
        return { ratios, buttons }
      })
      check(
        metrics.ratios.length === 3 && metrics.ratios.every((r) => r >= 4.5),
        `Review text contrast above 4.5 to 1 in ${skin} ${scheme}`
      )
      check(
        metrics.buttons.length === 2 &&
          metrics.buttons.every((b) => b.width >= 44 && b.height >= 44),
        `Comparison controls keep 44px targets in ${skin} ${scheme}`
      )
      await shot(`review-${skin}-${scheme}`, reviewer)
    }
  await reviewer.setViewportSize({ width: 320, height: 740 })
  await setH5TextScale(reviewer, 24)
  await fits(reviewer, 'Proposal reviewer fits 320px with 24px text')
  await button(reviewer, '退回修改').focus()
  await reviewer.keyboard.press('Enter')
  const sheet = reviewer.getByRole('dialog', { name: '退回修改', exact: true })
  await sheet.waitFor()
  await button(reviewer, '确认退回修改').click()
  await reviewer.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === '处理说明'
  )
  check(
    await reviewer.getByText('请说明原因，作者会看到这段说明', { exact: true }).isVisible(),
    'Empty rejection explains and focuses the reason field'
  )
  await field(reviewer, '处理说明').fill('请补充拍摄日期，再提交修改。')
  await button(reviewer, '确认退回修改').scrollIntoViewIfNeeded()
  await reviewer.waitForTimeout(350)
  await fits(reviewer, 'Rejection sheet fits small-screen large text')
  await shot('review-reject-320-dark-large', reviewer, false)
  await reviewer.keyboard.press('Escape')
  await sheet.waitFor({ state: 'hidden' })
  check(
    await button(reviewer, '退回修改').evaluate((n) => n === document.activeElement),
    'Closing review sheet restores keyboard focus'
  )
  await setH5TextScale(reviewer, 16)
  await reviewer.setViewportSize({ width: 375, height: 812 })
  await button(reviewer, '退回修改').click()
  await field(reviewer, '处理说明').fill('请补充拍摄日期，再提交修改。')
  const rejected = replyFor(reviewer, 'proposal_decide')
  await button(reviewer, '确认退回修改').click()
  assert.equal((await rejected).status(), 200)
  await reviewer.getByText('已退回修改，结果已记录。', { exact: true }).waitFor()
  check(
    (await button(reviewer, '隐藏内容').count()) === 0 &&
      (await button(reviewer, '通过修改').count()) === 0,
    'Resolved revision does not turn into actions on the underlying post'
  )
  await author.reload()
  await author.getByText('这次修改未通过审核', { exact: true }).waitFor()
  check(
    await author.getByText('请补充拍摄日期，再提交修改。', { exact: true }).isVisible(),
    'Author sees the revision-specific rejection explanation'
  )
  await friend.reload()
  await friend.locator('.post-card').waitFor()
  check(
    (await publishedBody(friend)) === initialPost.body,
    'Rejecting a revision leaves the current post visible'
  )

  setPhase('update-resubmit-approve')
  await saveEdit(`${proposed} 拍摄于 2026-11-19。`)
  await go(reviewer, '/pages/moderation/index')
  await button(reviewer, `审核修改：${initialPost.title}`).click()
  await button(reviewer, '通过修改').waitFor()
  await reviewer.waitForFunction(() =>
    [...document.querySelectorAll('[role="button"]')].some(
      (n) =>
        n.textContent?.trim() === '通过修改' &&
        !n.hasAttribute('disabled') &&
        n.getAttribute('aria-disabled') !== 'true'
    )
  )
  await button(reviewer, '通过修改').click()
  const approved = replyFor(reviewer, 'proposal_decide')
  await button(reviewer, '确认通过修改').click()
  assert.equal((await approved).status(), 200)
  await reviewer.getByText('已通过修改，结果已记录。', { exact: true }).waitFor()
  await friend.reload()
  await friend.locator('.post-card .photo').waitFor()
  check(
    (await publishedBody(friend)).includes('拍摄于 2026-11-19'),
    'Approved body and photo replace the old version together'
  )
  check(
    (await ok('b', 'read', 'post', { id: post })).post.media[0].id === photo.id,
    'Approved photo retains the expected asset identity'
  )
  await author.reload()
  await author.locator('.post-card').waitFor()
  check(
    (await button(author, '取消这次修改').count()) === 0,
    'Approved proposal no longer offers cancellation'
  )

  setPhase('update-discard-and-conflict')
  await saveEdit('这份修改将取消，不应覆盖已审核内容。')
  await button(author, '取消这次修改').click()
  const cancelDialog = author.getByRole('alertdialog', { name: '取消这次修改？', exact: true })
  await cancelDialog.waitFor()
  check(
    (await cancelDialog.innerText()).includes('保留当前展示版本'),
    'Discard confirmation distinguishes proposal removal from unsharing'
  )
  await button(author, '保留修改').click()
  await cancelDialog.waitFor({ state: 'hidden' })
  check(
    await button(author, '取消这次修改').evaluate((n) => n === document.activeElement),
    'Cancel discard restores focus without changing content'
  )
  await button(author, '取消这次修改').click()
  await cancelDialog.waitFor()
  const discarded = replyFor(author, 'discard_content_update')
  await cancelDialog.getByRole('button', { name: '取消这次修改', exact: true }).click()
  assert.equal((await discarded).status(), 200)
  await author.getByText('修改待审核', { exact: true }).waitFor({ state: 'hidden' })
  check(
    (await publishedBody(author)).includes('拍摄于 2026-11-19'),
    'Discard retains the approved current body'
  )
  await saveEdit('这份修改用于核实版本冲突。')
  await button(author, '取消这次修改').click()
  await cancelDialog.waitFor()
  const snapshot = await ok('a', 'read', 'edit_content', { id: post, type: 'post' })
  await ok('a', 'write', 'discard_content_update', {
    id: post,
    type: 'post',
    revision: snapshot.revision,
    request_id: randomUUID()
  })
  const conflicted = replyFor(author, 'discard_content_update')
  await cancelDialog.getByRole('button', { name: '取消这次修改', exact: true }).click()
  assert.notEqual((await conflicted).status(), 200)
  await button(author, '重新读取记录').waitFor()
  check(true, 'Late destructive action shows a conflict rather than applying to a newer version')
  await button(author, '重新读取记录').click()
  await button(author, '重新读取记录').waitFor({ state: 'hidden' })

  setPhase('update-withdraw-latest')
  await saveEdit('撤回时保存的最新修改，仅自己可见。')
  await button(author, '撤回分享').click()
  const withdrawDialog = author.getByRole('dialog', { name: '改为仅自己可见？', exact: true })
  await withdrawDialog.waitFor()
  check(
    (await withdrawDialog.innerText()).includes('最新修改会保存为仅自己可见'),
    'Withdraw confirmation clearly describes retaining the latest revision privately'
  )
  const withdrawn = replyFor(author, 'withdraw_content')
  await withdrawDialog.getByRole('button', { name: '撤回分享', exact: true }).click()
  assert.equal((await withdrawn).status(), 200)
  await author.getByText('修改待审核', { exact: true }).waitFor({ state: 'hidden' })
  check(
    (await publishedBody(author)) === '撤回时保存的最新修改，仅自己可见。',
    'Withdraw installs the latest draft privately'
  )
  check(
    (await rpc('b', 'read', 'post', { id: post })).status !== 200,
    'Former friend cannot read withdrawn content'
  )

  setPhase('update-spot-privacy')
  const spotId = data.commentFixture.spot || randomUUID(),
    spotDraft = {
      id: spotId,
      name: '隔离验收水域',
      city: '苏州',
      water_type: '自然水域',
      species: '',
      description: '原水情',
      fee_note: '',
      access_note: '测试私人入口',
      observed_on: '2026-11-19',
      audience: 'friends',
      precision: 'area',
      longitude: 120.52345,
      latitude: 31.26345
    }
  await ok('a', 'write', 'save_spot', spotDraft)
  const pendingSpot = await ok('outsider', 'moderation', 'item', { id: spotId, type: 'spot' })
  await ok('outsider', 'moderation', 'decide', {
    id: spotId,
    type: 'spot',
    revision: pendingSpot.revision,
    decision: 'published',
    reason: '隔离验收',
    request_id: randomUUID()
  })
  await go(author, `/pages/spot/detail?id=${spotId}`)
  await button(author, '编辑与分享设置').click()
  await field(author, '水域与鱼情').fill('修改后的水情，隐藏位置立即生效。')
  await button(author, '位置精度').click()
  await button(author, '不分享位置').click()
  const spotSaved = replyFor(author, 'update_content')
  await button(author, '提交修改审核').click()
  assert.equal((await spotSaved).status(), 200)
  await author.getByText('修改待审核', { exact: true }).waitFor()
  const friendSpot = await ok('b', 'read', 'spot', { id: spotId })
  check(
    friendSpot.description === '原水情' &&
      friendSpot.longitude === null &&
      friendSpot.latitude === null &&
      !friendSpot.access_note,
    'Spot old description stays effective while hiding coordinates immediately'
  )
  await go(reviewer, '/pages/moderation/index')
  await button(reviewer, '审核修改：隔离验收水域').click()
  await reviewer.getByText('修改后的水情，隐藏位置立即生效。', { exact: true }).waitFor()
  check(
    !(await reviewer.locator('.fishing-content').innerText()).includes('测试私人入口'),
    'Spot reviewer does not receive private access instructions'
  )
  await button(reviewer, '当前版本').click()
  check(
    await reviewer.getByText('原水情', { exact: true }).isVisible(),
    'Spot reviewer can compare the effective description'
  )
  await shot('spot-review-current-375', reviewer)
  await button(author, '取消这次修改').click()
  await author
    .getByRole('alertdialog')
    .getByRole('button', { name: '取消这次修改', exact: true })
    .click()
  await author.getByText('修改待审核', { exact: true }).waitFor({ state: 'hidden' })
  check(
    (await ok('b', 'read', 'spot', { id: spotId })).longitude === null,
    'Discarding spot revision does not relax the tightened location privacy'
  )
  setPhase('update-reviewer-account-switch')
  const otherReviewerTab = await reviewer.context().newPage()
  await go(otherReviewerTab, '/pages/home/index')
  await otherReviewerTab.evaluate(
    (session) =>
      localStorage.setItem('dyj.auth.v1', JSON.stringify({ type: 'object', data: session })),
    data.accounts.find((a) => a.label === 'b').session
  )
  await reviewer.getByText('无法读取审核内容', { exact: true }).waitFor()
  check(
    (await reviewer.locator('.review-body').count()) === 0 &&
      (await button(reviewer, '本次修改').count()) === 0,
    'Cross-tab reviewer account switch clears both current and proposed content'
  )
  await otherReviewerTab.close()

  if (offline) {
    setPhase('update-offline')
    await loadDetail(author)
    await button(author, '编辑这条鱼情').click()
    await field(author, '鱼情与心得').fill('断网时保留的私人修改。')
    await offline(true)
    await button(author, '保存修改').click()
    await author.locator('.error[role="alert"]').waitFor()
    check(
      (await field(author, '鱼情与心得').inputValue()) === '断网时保留的私人修改。',
      'Failed save retains the unsaved edit in its owner-scoped draft'
    )
    await offline(false)
  }
  setPhase('update-author-account-switch')
  if (!offline) {
    await loadDetail(author)
    await button(author, '编辑这条鱼情').click()
  }
  await field(author, '鱼情与心得').fill('原账号未提交的修改不得转移。')
  const otherAuthorTab = await author.context().newPage()
  await go(otherAuthorTab, '/pages/home/index')
  await otherAuthorTab.evaluate(
    (session) =>
      localStorage.setItem('dyj.auth.v1', JSON.stringify({ type: 'object', data: session })),
    data.accounts.find((a) => a.label === 'b').session
  )
  await field(author, '鱼情与心得').waitFor({ state: 'hidden' })
  check(
    (await author.getByText('原账号未提交的修改不得转移。', { exact: true }).count()) === 0,
    'Cross-tab author account switch hides the prior owner edit draft'
  )
  await otherAuthorTab.close()
  setPhase('update-finished')
}
