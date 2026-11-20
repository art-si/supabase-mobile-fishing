import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setH5TextScale } from './h5-text-scale.mjs'

// Ordinary real user sessions; no HTTP fixtures, public posts, SMS or GPS.
export async function spotPhotosFlow({
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
  accountPage,
  setPhase
}) {
  const id = data.commentFixture.spot,
    owner = data.accounts.find((a) => a.label === 'a').session.user.id
  const friend = await accountPage('b'),
    reviewer = await accountPage('outsider')
  const detail = `/pages/spot/detail?id=${id}`
  let publicKey
  async function rpc(label, kind, action, payload = {}) {
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
          signal: AbortSignal.timeout(30000)
        })
        return { status: response.status, json: await response.json() }
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
  async function ok(label, kind, action, payload = {}) {
    const result = await rpc(label, kind, action, payload)
    assert.equal(result.status, 200)
    return result.json
  }
  const sign = (label, asset) =>
    page.evaluate(
      async ({ url, key, token }) => {
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            apikey: key,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ expiresIn: 60 }),
          signal: AbortSignal.timeout(20000)
        })
        const body = await r.json()
        return { status: r.status, signed: !!body.signedURL }
      },
      {
        url: `${project}/storage/v1/object/sign/fishing-media/${asset.path}`,
        key: publicKey,
        token: data.accounts.find((a) => a.label === label)?.session.access_token
      }
    )
  const photos = (tab) => tab.getByRole('button', { name: /钓位现场照片，查看大图/ })
  async function addPhoto() {
    const response = page.waitForResponse(
      (r) => r.url() === `${project}/functions/v1/media-upload` && r.request().method() === 'POST',
      { timeout: 55000 }
    )
    const chooser = page.waitForEvent('filechooser')
    await button(page, '添加照片').click()
    await (
      await chooser
    ).setFiles({
      name: 'synthetic-spot.png',
      mimeType: 'image/png',
      buffer: Buffer.from(data.photo, 'base64')
    })
    const uploaded = await response
    assert.equal(uploaded.status(), 200)
    publicKey = (await uploaded.request().allHeaders()).apikey
    const asset = await uploaded.json()
    await page.waitForFunction(() => !document.querySelector('.mobile-media-uploader__progress'))
    return asset
  }
  async function editPayload(media, audience = 'friends') {
    const snapshot = await ok('a', 'read', 'edit_content', { type: 'spot', id })
    return {
      ...snapshot.item,
      id,
      type: 'spot',
      audience,
      media: media.map(({ id }) => ({ id })),
      revision: snapshot.revision,
      request_id: randomUUID()
    }
  }
  async function approve(action = 'decide') {
    const snapshot = await ok('a', 'read', 'edit_content', { type: 'spot', id })
    return ok('outsider', 'moderation', action, {
      id,
      type: 'spot',
      revision: snapshot.revision,
      request_id: randomUUID(),
      decision: 'published',
      reason: '隔离钓位照片验收，随后精确清理'
    })
  }
  setPhase('spot-photo-create')
  await go(page, '/pages/spot/create')
  // Set only the internal id of the isolated local draft before exercising the real form.
  await page.evaluate(
    ({ owner, id }) => {
      const key = `dyj.live.spot-draft.${owner}`
      const draft = {
        id,
        name: '',
        city: '',
        water_type: '自然水域',
        species: '',
        description: '',
        fee_note: '未核实',
        access_note: '',
        observed_on: new Date().toISOString().slice(0, 10),
        audience: 'private',
        precision: 'hidden',
        longitude: null,
        latitude: null,
        media: []
      }
      localStorage.setItem(key, JSON.stringify({ type: 'object', data: draft }))
    },
    { owner, id }
  )
  await page.reload()
  await field(page, '钓位名称').fill('照片验收水域（虚构）')
  await button(page, '选择所在城市').click()
  const citySheet = page.getByRole('dialog', { name: '选择所在城市', exact: true })
  await citySheet.getByRole('textbox', { name: '搜索城市', exact: true }).fill('苏州市')
  await citySheet.getByRole('button', { name: '选择苏州市', exact: true }).click()
  await field(page, '水域与鱼情').fill('自动验收临时钓位，不是真实水域。')
  const first = await addPhoto(),
    second = await addPhoto()
  check(first.id !== second.id, 'Real spot uploads create separate private assets')
  const created = replyFor(page, 'save_spot')
  await button(page, '保存钓位').click()
  assert.equal((await created).status(), 200)
  await page.waitForURL(/pages\/spot\/detail/)
  await photos(page).first().waitFor()
  check(
    (await photos(page).count()) === 2,
    'H5 private spot detail displays both uploaded photographs'
  )
  await shot('spot-photo-private-375', page)
  for (const viewer of ['b', 'outsider', 'guest'])
    check(
      !(await sign(viewer, first)).signed,
      'Private spot photo signature is denied to nonowners'
    )
  check(
    (await ok('a', 'read', 'spot', { id })).media.length === 2,
    'Real spot read returns persisted photo metadata'
  )
  setPhase('spot-photo-edit-share')
  await button(page, '编辑与分享设置').click()
  await page.locator('.mobile-evidence__item:visible').first().waitFor()
  await page.locator('.mobile-evidence__remove:visible').first().click()
  const third = await addPhoto()
  await button(page, '钓位分享范围').click()
  await button(page, '仅好友').click()
  const updated = replyFor(page, 'update_content')
  await button(page, '提交修改审核').click()
  assert.equal((await updated).status(), 200)
  await page.waitForURL(/pages\/spot\/detail/)
  check(
    (await ok('a', 'read', 'spot', { id })).media.map((m) => m.id).join() ===
      [second.id, third.id].join(),
    'H5 edit removes one photograph and saves the new order'
  )
  check(!(await sign('b', third)).signed, 'Shared spot photographs remain private before review')
  await go(reviewer, `/pages/moderation/detail?type=spot&id=${id}`)
  await reviewer
    .getByRole('button', { name: /待审内容照片，查看大图/ })
    .first()
    .waitFor()
  await shot('spot-photo-review-375', reviewer)
  check(
    (await reviewer.getByRole('button', { name: /待审内容照片，查看大图/ }).count()) === 2,
    'Real review screen displays complete spot photographs'
  )
  await approve()
  await go(friend, detail)
  await photos(friend).first().waitFor()
  await shot('spot-photo-friend-375', friend)
  check(
    (await photos(friend).count()) === 2 && (await sign('b', third)).signed,
    'Friend sees and signs photographs after real review approval'
  )
  check(!(await sign('guest', third)).signed, 'Approval does not widen a friends-only audience')
  setPhase('spot-photo-proposal')
  // Reuse the detached, owner-only first upload as a different proposed photograph.
  await ok('a', 'write', 'update_content', await editPayload([first]))
  check(
    (await ok('b', 'read', 'spot', { id })).media[0].id === second.id &&
      !(await sign('b', first)).signed,
    'Pending spot replacement preserves the effective photos and hides new ones'
  )
  const proposal = await ok('outsider', 'moderation', 'proposal_item', { type: 'spot', id })
  check(
    proposal.media[0].id === first.id && proposal.current.media.length === 2,
    'Real proposal review compares new and effective photographs'
  )
  await approve('proposal_decide')
  check(
    (await ok('b', 'read', 'spot', { id })).media[0].id === first.id &&
      !(await sign('b', second)).signed,
    'Approval installs proposed photos and revokes removed photo signatures'
  )
  await go(page, detail)
  await photos(page).first().waitFor()
  await page.setViewportSize({ width: 320, height: 740 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await setH5TextScale(page, 24)
  await fits('Real spot detail fits a narrow screen with large text', page)
  await shot('spot-photo-final-320-dark', page)
  setPhase('spot-photo-withdraw')
  await button(page, '撤回分享').click()
  const dialog = page.getByRole('dialog', { name: '改为仅自己可见？', exact: true })
  await dialog.waitFor()
  const withdrawn = replyFor(page, 'withdraw_content')
  await dialog.getByRole('button', { name: '撤回分享', exact: true }).click()
  assert.equal((await withdrawn).status(), 200)
  check(
    !(await sign('b', first)).signed && !(await sign('outsider', first)).signed,
    'H5 withdrawal immediately denies new friend and reviewer signatures'
  )
  await ok('a', 'write', 'delete_content', { type: 'spot', id })
  check(
    !(await sign('a', first)).signed,
    'Real content deletion denies new owner signatures as well'
  )
}
