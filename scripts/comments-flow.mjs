import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setH5TextScale } from './h5-text-scale.mjs'

// Used by isolated HTTP contracts and real hosted acceptance; the caller labels its evidence.
export async function commentsFlow({
  page,
  data,
  project,
  button,
  field,
  go,
  replyFor,
  shot,
  fits,
  check,
  setPhase,
  offline
}) {
  const writes = []
  page.on('request', (request) => {
    if (request.url() === `${project}/rest/v1/rpc/fishing_write`)
      writes.push(request.postDataJSON())
  })
  setPhase('comments-create-private')
  await go(page, '/pages/post/compose')
  await field(page, '标题').fill('评论回复隔离验收（随后清理）')
  await field(page, '鱼情与心得').fill('仅自己可见的临时验收内容，不是真实鱼情。')
  await button(page, '分享范围').click()
  await button(page, '仅自己').click()
  const saving = replyFor(page, 'save_post')
  await button(page, '保存并发布').click()
  const saved = await saving
  assert.equal(saved.status(), 200)
  const post = await saved.json(),
    publicKey = (await saved.request().allHeaders()).apikey
  await page.waitForURL((url) => url.hash.startsWith('#/pages/post/detail'))
  async function api(label, path, payload) {
    const token = data.accounts.find((a) => a.label === label)?.session.access_token
    return page.evaluate(
      async ({ url, key, token, payload }) => {
        const response = await fetch(url, {
          method: payload === undefined ? 'GET' : 'POST',
          headers: {
            apikey: key,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'Content-Type': 'application/json'
          },
          ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
          signal: AbortSignal.timeout(20000)
        })
        return { status: response.status, json: await response.json() }
      },
      { url: project + path, key: publicKey, token, payload }
    )
  }
  const rpc = (label, kind, action, payload) =>
    api(label, `/rest/v1/rpc/fishing_${kind}`, { action, payload })
  await go(page, `/pages/post/detail?id=${post.id}`)
  await field(page, '写一条评论').fill('草边轻口，试试小漂。')
  const sending = replyFor(page, 'comment')
  await button(page, '发表评论').click()
  assert.equal((await sending).status(), 200)
  await page.locator('.post-comments__item').waitFor()
  const root = writes.filter((w) => w.action === 'comment').at(-1).payload
  check(true, 'H5 creates comment on private post through ordinary user RPC')
  const replyAction = () =>
    page
      .locator('.post-comments__item')
      .first()
      .getByRole('button', { name: /^回复 / })
  await replyAction().click()
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === '写一条回复'
  )
  check(true, 'H5 selecting reply focuses the labeled composer')
  await field(page, '写一条回复').fill('谢谢，我试试靠草的位置。')
  await button(page, '取消回复').click()
  check(
    (await field(page, '写一条评论').inputValue()) === '谢谢，我试试靠草的位置。',
    'H5 cancelling reply preserves entered text'
  )
  await replyAction().click()
  await (offline ? offline(true) : page.context().setOffline(true))
  await button(page, '发表回复').click()
  await page.locator('.post-comments .error').first().waitFor()
  check(
    (await field(page, '写一条回复').inputValue()).includes('谢谢'),
    'H5 offline reply retains body and target'
  )
  await (offline ? offline(false) : page.context().setOffline(false))
  const retrying = replyFor(page, 'comment')
  await button(page, '发表回复').click()
  assert.equal((await retrying).status(), 200)
  await page.waitForFunction(() => document.querySelectorAll('.post-comments__item').length === 2)
  const commands = writes.filter((w) => w.action === 'comment'),
    reply = commands.at(-1).payload
  check(
    commands.at(-2).payload.id === reply.id && reply.reply_to_id === root.id,
    'H5 unchanged offline retry preserves comment identity and reply target'
  )
  check(
    await page.locator('.post-comments__item').first().locator('.post-comments__quote').isVisible(),
    'H5 reply shows authorized original reference'
  )
  check(
    (await rpc('a', 'write', 'comment', reply)).status === 200,
    'H5 duplicate accepted reply returns success without another row'
  )
  check(
    (await rpc('a', 'read', 'comments', { id: post.id })).json.total === 2,
    'H5 duplicate comment receipt leaves exact total'
  )
  check(
    await page
      .locator('.post-actions')
      .getByRole('button', { name: /^查看评论/ })
      .getByText('2', { exact: true })
      .isVisible(),
    'H5 post card comment count updates without reloading'
  )
  check(
    (await rpc('a', 'write', 'comment', { ...reply, body: '改变原请求' })).json.message ===
      'COMMENT_REQUEST_REUSED',
    'H5 changed payload cannot silently reuse accepted comment identity'
  )

  setPhase('comments-visual')
  for (const [width, height] of [
    [320, 812],
    [375, 812],
    [440, 956],
    [844, 390],
    [1280, 800]
  ]) {
    await page.setViewportSize({ width, height })
    await setH5TextScale(page, 16)
    await fits(`H5 comments fit ${width} viewport`)
    const sizes = await page
      .locator('.post-comments button')
      .evaluateAll((nodes) =>
        nodes
          .filter((n) => n.getClientRects().length)
          .map((n) => ({ w: n.getBoundingClientRect().width, h: n.getBoundingClientRect().height }))
      )
    check(
      sizes.every((s) => s.w >= 44 && s.h >= 44),
      `H5 comment actions meet touch targets at ${width}`
    )
    await shot(`comments-${width}`)
  }
  await page.setViewportSize({ width: 320, height: 812 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await setH5TextScale(page, 24)
  await replyAction().click()
  await fits('H5 reply composer fits dark small screen and large text')
  check(
    await field(page, '写一条回复').evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize) >= 24
    ),
    'H5 comment field honors enlarged text'
  )
  await shot('comments-dark-large-320')
  await button(page, '取消回复').click()
  await page.setViewportSize({ width: 375, height: 812 })
  await setH5TextScale(page, 16)
  for (const skin of ['lake', 'ocean', 'stone']) {
    await page.evaluate(
      (skin) =>
        localStorage.setItem(
          'dyj.appearance.skin.v1',
          JSON.stringify({ type: 'string', data: skin })
        ),
      skin
    )
    await page.reload()
    await page.locator('.post-comments__item').first().waitFor()
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme })
      await fits(`H5 comments fit ${skin} ${colorScheme} skin`)
      await shot(`comments-${skin}-${colorScheme}`)
    }
  }
  await page.emulateMedia({ colorScheme: 'light' })

  setPhase('comments-delete')
  const original = page
    .locator('.post-comments__item')
    .filter({ has: page.locator('.body', { hasText: root.body }) })
  await original.getByRole('button', { name: '删除自己的评论' }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.waitFor()
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '取消')
  check(true, 'H5 destructive comment confirmation starts on cancel')
  await shot('comments-delete-confirm-375', page, false)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  check(
    (await rpc('a', 'read', 'comments', { id: post.id })).json.total === 2,
    'H5 cancelling deletion leaves both comments intact'
  )
  await original.getByRole('button', { name: '删除自己的评论' }).click()
  const deleting = replyFor(page, 'delete_comment')
  await dialog.getByRole('button', { name: '删除评论', exact: true }).click()
  assert.equal((await deleting).status(), 200)
  await page.getByText('原评论已删除或不可见', { exact: true }).waitFor()
  check(
    !(await page.locator('.post-comments').getByText(root.body, { exact: true }).count()),
    'H5 delete removes original and local quoted body'
  )
  check(
    await page
      .locator('.post-actions')
      .getByRole('button', { name: /^查看评论/ })
      .getByText('1', { exact: true })
      .isVisible(),
    'H5 post card count follows successful comment deletion'
  )
  check(
    (await rpc('a', 'write', 'comment', root)).json.message === 'NOT_FOUND',
    'H5 delayed create cannot resurrect erased comment'
  )
  for (const actor of ['b', 'outsider', null]) {
    const hidden = await rpc(actor, 'read', 'comments', { id: post.id })
    const direct = await api(actor, `/rest/v1/comments?post_id=eq.${post.id}&select=id,body`)
    check(
      hidden.json.message === 'NOT_FOUND' && direct.status === 200 && direct.json.length === 0,
      `H5 private comments reject ${actor || 'anonymous'} by RPC and direct RLS`
    )
  }

  setPhase('comments-pagination')
  for (let i = 0; i < 32; i++)
    assert.equal(
      (
        await rpc('a', 'write', 'comment', {
          id: randomUUID(),
          post_id: post.id,
          body: `分页验收 ${i + 1}`
        })
      ).status,
      200
    )
  await page.reload()
  await button(page, '加载更多评论').waitFor()
  check(
    (await page.locator('.post-comments__item').count()) === 30,
    'H5 first comment page is bounded'
  )
  await button(page, '加载更多评论').click()
  await page.waitForFunction(() => document.querySelectorAll('.post-comments__item').length === 33)
  check(
    !(await button(page, '加载更多评论').count()),
    'H5 loading older comments reaches final page without duplicates'
  )
  setPhase('comments-return')
  await page
    .locator('.post-comments__item')
    .last()
    .getByRole('button', { name: /^回复 / })
    .click()
  await field(page, '写一条回复').fill('返回后仍应回复同一条评论')
  await page
    .locator('.post-card')
    .getByRole('button', { name: /^查看.+的主页$/ })
    .click()
  await page.waitForURL((url) => url.hash.startsWith('#/pages/people/detail'))
  await button(page, '返回上一页').click()
  await page.waitForURL((url) => url.hash.startsWith('#/pages/post/detail'))
  await page.getByText('回复对象待确认', { exact: true }).waitFor()
  check(
    (await field(page, '写一条回复').inputValue()).includes('同一条评论') &&
      (await button(page, '发表回复').isDisabled()),
    'H5 returning preserves reply draft without silently changing its target'
  )
  await button(page, '加载更多评论').click()
  await page.getByText('回复对象待确认', { exact: true }).waitFor({ state: 'hidden' })
  check(
    await button(page, '发表回复').isEnabled(),
    'H5 reloading original comment restores verified reply context'
  )
  await button(page, '取消回复').click()
}
