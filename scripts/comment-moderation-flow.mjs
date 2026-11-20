import assert from 'node:assert/strict'
import { setH5TextScale } from './h5-text-scale.mjs'

// Runs unchanged against local PostgreSQL contracts and genuine hosted user sessions.
export async function commentModerationFlow({
  page: author,
  data,
  project,
  button,
  field,
  go,
  replyFor,
  shot,
  check,
  accountPage,
  setPhase,
  offline
}) {
  const reporter = await accountPage('b'),
    reviewer = await accountPage('outsider')
  const { post, root, body, replyBody } = data.commentFixture
  const detail = `/pages/post/detail?id=${post}`
  const rows = (tab) => tab.locator('.post-comments__item')
  const original = (tab) =>
    rows(tab).filter({ has: tab.locator('.body').filter({ hasText: body }) })
  const fits = async (tab, label) =>
    check(
      await tab.evaluate(
        () =>
          Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) <=
          innerWidth + 1
      ),
      label
    )
  setPhase('comment-report-entry')
  const loading = replyFor(reporter, 'post')
  await go(reporter, detail)
  const loaded = await loading
  assert.equal(loaded.status(), 200)
  const publicKey = (await loaded.request().allHeaders()).apikey
  async function rpc(label, kind, action, payload = {}) {
    const token = data.accounts.find((x) => x.label === label)?.session.access_token
    return reporter.evaluate(
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
      { url: `${project}/rest/v1/rpc/fishing_${kind}`, key: publicKey, token, action, payload }
    )
  }
  await rows(reporter).nth(1).waitFor()
  check(
    (await reporter.getByRole('button', { name: /^举报 .+ 的评论$/ }).count()) === 1,
    'H5 report action appears only on another author comment'
  )
  const trigger = reporter.getByRole('button', { name: /^举报 .+ 的评论$/ })
  await trigger.click()
  await field(reporter, '问题说明').waitFor()
  check(
    (await reporter.getByRole('dialog').count()) === 1,
    'H5 opens one shared comment report sheet'
  )
  await button(reporter, '提交举报').click()
  await reporter.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === '问题说明'
  )
  check(
    await reporter.getByText('请说明具体问题，方便审核员核查', { exact: true }).isVisible(),
    'H5 empty report shows inline validation and focuses the field'
  )
  await field(reporter, '问题说明').fill('隔离验收：评论可能包含广告骚扰，请核实。')
  await reporter.keyboard.press('Escape')
  await reporter.waitForFunction(() =>
    document.activeElement?.getAttribute('aria-label')?.startsWith('举报 ')
  )
  check(true, 'H5 cancelling comment report returns keyboard focus to the original action')
  await trigger.click()
  check(
    (await field(reporter, '问题说明').inputValue()).includes('广告骚扰'),
    'H5 closing and reopening the same report retains the unsent explanation'
  )
  const size = await trigger.boundingBox()
  check(size.width >= 44 && size.height >= 44, 'H5 comment report trigger has a full touch target')
  await button(reporter, '提交举报').scrollIntoViewIfNeeded()
  await shot('report-sheet-375', reporter, false)
  for (const [width, height] of [
    [320, 740],
    [440, 956],
    [844, 390],
    [1280, 900]
  ]) {
    await reporter.setViewportSize({ width, height })
    await fits(reporter, `H5 comment report sheet fits ${width}px viewport`)
    await button(reporter, '提交举报').scrollIntoViewIfNeeded()
    check(
      await button(reporter, '提交举报').isVisible(),
      `H5 comment report submit remains reachable at ${width}px`
    )
  }
  for (const skin of ['lake', 'ocean', 'stone'])
    for (const scheme of ['light', 'dark']) {
      await button(reporter, '关闭举报表单').click()
      await reporter.evaluate(
        (skin) =>
          localStorage.setItem(
            'dyj.appearance.skin.v1',
            JSON.stringify({ type: 'string', data: skin })
          ),
        skin
      )
      await reporter.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      await reporter.setViewportSize({ width: 375, height: 812 })
      await reporter.reload()
      await trigger.click()
      await fits(reporter, `H5 comment report respects ${skin} ${scheme} theme`)
      await button(reporter, '提交举报').scrollIntoViewIfNeeded()
      await shot(`report-${skin}-${scheme}`, reporter, false)
    }
  await reporter.setViewportSize({ width: 320, height: 740 })
  await setH5TextScale(reporter, 24)
  check(
    (await reporter.evaluate(() => getComputedStyle(document.documentElement).fontSize)) === '24px',
    'H5 comment report uses actual large text scale'
  )
  await fits(reporter, 'H5 comment report fits 320px dark large text')
  await button(reporter, '提交举报').scrollIntoViewIfNeeded()
  await shot('report-320-dark-large', reporter, false)
  await setH5TextScale(reporter, 16)
  await reporter.setViewportSize({ width: 375, height: 812 })
  await field(reporter, '问题说明').fill('隔离验收：评论可能包含广告骚扰，请核实。')
  setPhase('comment-report-submit')
  await (offline ? offline(true) : reporter.context().setOffline(true))
  await button(reporter, '提交举报').click()
  await reporter.locator('.fishing-sheet-content .error').waitFor()
  check(
    (await field(reporter, '问题说明').inputValue()).includes('广告骚扰'),
    'H5 offline report failure retains the explanation'
  )
  await (offline ? offline(false) : reporter.context().setOffline(false))
  const submitting = replyFor(reporter, 'submit')
  await button(reporter, '提交举报').click()
  const saved = await submitting
  assert.equal(saved.status(), 200)
  const report = await saved.json()
  await reporter.getByText('举报已提交，可在我的社区举报查看进度。', { exact: true }).waitFor()
  check(
    (await rpc('b', 'reports', 'submit', { id: root, type: 'comment', reason: '重复请求' })).json
      .duplicate,
    'H5 lost report receipt can be recovered without a duplicate'
  )
  await button(reporter, '查看社区举报记录').click()
  await reporter.getByText('待处理', { exact: true }).waitFor()
  check(true, 'H5 reporter sees pending comment report in own history')

  setPhase('comment-report-review-hide')
  await go(reviewer, `/pages/content-report/detail?id=${report.id}`)
  await button(reviewer, '隐藏内容并结案').waitFor()
  await button(reviewer, '隐藏内容并结案').click()
  await field(reviewer, '处理说明').fill('隔离验收：广告骚扰，暂时隐藏。')
  const deciding = replyFor(reviewer, 'decide')
  await button(reviewer, '确认隐藏内容并结案').click()
  assert.equal((await deciding).status(), 200)
  await reviewer.getByText('已处理', { exact: true }).waitFor()
  check(true, 'H5 independent reviewer hides comment and closes report')
  await shot('report-resolved-375', reviewer)
  await reporter.reload()
  await reporter.getByText('已处理', { exact: true }).waitFor()
  check(
    await reporter.getByText('隔离验收：广告骚扰，暂时隐藏。', { exact: true }).isVisible(),
    'H5 reporter sees handling outcome without moderator identity'
  )
  await go(reporter, detail)
  await reporter.getByText('原评论已删除或不可见', { exact: true }).waitFor()
  check(
    (await rows(reporter).count()) === 1 &&
      !(await reporter.locator('.post-comments').innerText()).includes(body),
    'H5 hidden comment and quoted original disappear from other users'
  )
  await go(author, detail)
  await author.getByText('暂时隐藏', { exact: true }).waitFor()
  await author.getByText('隔离验收：广告骚扰，暂时隐藏。', { exact: true }).waitFor()
  check(
    await author.getByText('隔离验收：广告骚扰，暂时隐藏。', { exact: true }).isVisible(),
    'H5 author sees own hidden comment and processing reason'
  )
  const hidden = original(author)
  check(
    (await hidden.getByRole('button', { name: /^回复 / }).count()) === 0 &&
      (await hidden.getByRole('button', { name: '删除自己的评论', exact: true }).count()) === 1,
    'H5 hidden own comment can be deleted but cannot be replied to'
  )
  await shot('comment-hidden-author-375', author)
  const raw = await reporter.evaluate(
    async ({ project, key, token, root }) => {
      const r = await fetch(`${project}/rest/v1/comments?id=eq.${root}&select=id,body`, {
        headers: { apikey: key, Authorization: `Bearer ${token}` }
      })
      return { status: r.status, json: await r.json() }
    },
    {
      project,
      key: publicKey,
      token: data.accounts.find((x) => x.label === 'b').session.access_token,
      root
    }
  )
  check(
    raw.status === 200 && raw.json.length === 0,
    'H5 ordinary token cannot bypass hidden comment RLS through raw table'
  )
  setPhase('comment-report-restore')
  await button(reviewer, '查看内容审核状态').click()
  await button(reviewer, '恢复评论').click()
  await field(reviewer, '处理说明').fill('隔离验收：复核完成，恢复展示。')
  const restoring = replyFor(reviewer, 'decide')
  await button(reviewer, '确认恢复评论').click()
  assert.equal((await restoring).status(), 200)
  await reviewer.getByText('已恢复评论，结果已记录。', { exact: true }).waitFor()
  check(true, 'H5 closed report leads to explicit review and restore action')
  await reporter.reload()
  await rows(reporter).nth(1).waitFor()
  check(
    (await reporter.getByText(body, { exact: true }).count()) === 2,
    'H5 restored comment and current quote return within original audience'
  )
  await shot('comment-restored-375', reporter)
  const stale = await rpc('outsider', 'moderation', 'decide', {
    id: root,
    type: 'comment',
    revision: 2,
    decision: 'hidden',
    reason: 'stale',
    request_id: crypto.randomUUID()
  })
  check(
    stale.status !== 200 && stale.json.message === 'REVIEW_CONFLICT',
    'H5 stale reviewer cannot overwrite restored comment'
  )
  setPhase('comment-report-parent-private')
  const withdrawing = await rpc('a', 'write', 'withdraw_content', {
    id: post,
    type: 'post',
    revision: 2,
    request_id: crypto.randomUUID()
  })
  assert.equal(withdrawing.status, 200)
  await reviewer.reload()
  await reviewer.getByText('内容不存在或你暂时无权查看', { exact: true }).waitFor()
  check(
    !(await reviewer.locator('.fishing-content').innerText()).includes(body),
    'H5 parent privacy tightening clears comment from moderation screen'
  )
  await go(reviewer, `/pages/content-report/detail?id=${report.id}`)
  await reviewer.getByText('内容已不可用', { exact: true }).waitFor()
  check(
    !(await reviewer.locator('.fishing-content').innerText()).includes(body),
    'H5 report history cannot reveal comment after parent becomes private'
  )
  await reporter.reload()
  await reporter.getByText('内容不存在或你暂时无权查看', { exact: true }).waitFor()
  check(
    !(await reporter.locator('.fishing-content').innerText()).includes(replyBody),
    'H5 parent privacy tightening clears cached discussion for former viewer'
  )
  await shot('report-private-parent-375', reviewer)
  setPhase('comment-moderation-complete')
}
