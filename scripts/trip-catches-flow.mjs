import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setH5TextScale } from './h5-text-scale.mjs'

// Shared browser flow. The caller labels its evidence as either real hosted or intercepted contract.
export async function tripCatchesFlow({
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
  const title = '多条渔获隔离验收（随后清理）'
  const writes = []
  page.on('request', (request) => {
    if (request.url() === `${project}/rest/v1/rpc/fishing_write`)
      writes.push(request.postDataJSON())
  })
  const input = (index, name) => field(page, `渔获 ${index} ${name}`)
  const value = (index, name) => input(index, name).inputValue()
  setPhase('catches-compose')
  await go(page, '/pages/post/compose?mode=trip')
  await field(page, '标题').fill(title)
  await field(page, '鱼情与心得').fill('隔离验收，不是真实渔获。日志仅自己可见。')
  await button(page, '渔获与钓法').click()
  await input(1, '鱼种').fill('鲫鱼')
  await input(1, '尾数').fill('3')
  await input(1, '重量（kg）').fill('0.3')
  await button(page, '添加一条渔获').click()
  await input(2, '鱼种').fill('鲤鱼')
  await input(2, '尾数').fill('1')
  await button(page, '移除渔获 1').click()
  assert.equal(await value(1, '鱼种'), '鲤鱼')
  await button(page, '撤销移除').click()
  check(
    (await value(1, '鱼种')) === '鲫鱼' && (await value(2, '尾数')) === '1',
    'H5 catch remove and undo preserve row order and values'
  )
  await input(2, '尾数').fill('1.5')
  await button(page, '保存私人日志').click()
  await page.locator('#compose-errors').waitFor()
  check(
    writes.length === 0 &&
      (await page.evaluate(() => document.activeElement?.id === 'compose-errors')),
    'H5 invalid catch count focuses error summary without a write'
  )
  check(
    (await field(page, '标题').inputValue()) === title,
    'H5 catch validation retains the whole draft'
  )
  await shot('catches-invalid-375')
  await input(2, '尾数').fill('1')
  await page.locator('#compose-errors').waitFor({ state: 'hidden' })
  await page.reload()
  await page.getByText('已恢复这台设备上的草稿。', { exact: true }).waitFor()
  await button(page, '渔获与钓法').click()
  check(
    (await value(1, '尾数')) === '3' && (await value(2, '重量（kg）')) === '',
    'H5 reload restores all private catch rows with unknown weight intact'
  )
  setPhase('catches-visual')
  for (const [width, height] of [
    [320, 812],
    [375, 812],
    [440, 956],
    [844, 390],
    [1280, 800]
  ]) {
    await page.setViewportSize({ width, height })
    await setH5TextScale(page, 16)
    await fits(`H5 multi-catch editor fits ${width} viewport`)
    const controls = await page.locator('.trip-catches button').evaluateAll((items) =>
      items
        .filter((item) => !item.disabled)
        .map((item) => ({
          width: item.getBoundingClientRect().width,
          height: item.getBoundingClientRect().height
        }))
    )
    check(
      controls.every((item) => item.width >= 44 && item.height >= 44),
      `H5 catch actions have usable targets at ${width}`
    )
    await shot(`catches-edit-${width}`)
  }
  await page.setViewportSize({ width: 320, height: 812 })
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await setH5TextScale(page, 24)
  await fits('H5 catch editor fits dark small screen with large text')
  check(
    await input(1, '鱼种').evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 24),
    'H5 catch input honors enlarged text instead of only enlarging labels'
  )
  await shot('catches-edit-dark-large-320')
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'light' })
  await setH5TextScale(page, 16)

  for (const skin of ['lake', 'ocean', 'stone']) {
    await page.evaluate(
      (value) =>
        localStorage.setItem(
          'dyj.appearance.skin.v1',
          JSON.stringify({ type: 'string', data: value })
        ),
      skin
    )
    await page.reload()
    await button(page, '渔获与钓法').click()
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme })
      await fits(`H5 catch editor fits ${skin} ${colorScheme} skin`)
      await shot(`catches-${skin}-${colorScheme}`)
    }
  }
  await page.emulateMedia({ colorScheme: 'light' })

  setPhase('catches-save')
  const saving = replyFor(page, 'save_trip')
  await button(page, '保存私人日志').click()
  const saved = await saving
  check(saved.status() === 200, 'H5 saves a multi-catch log through the normal user RPC')
  const log = await saved.json(),
    original = saved.request().postDataJSON().payload
  const publicKey = (await saved.request().allHeaders()).apikey
  const records = [
    { species: '鲫鱼', count: 3, weight_kg: 0.3 },
    { species: '鲤鱼', count: 1, weight_kg: null }
  ]
  assert.deepEqual(log.catch_records, records)
  check(
    log.count === 4 && log.weight_kg === null && !('audience' in original),
    'H5 saved catch summary preserves unknown total and private scope'
  )
  await page.waitForURL((url) => url.hash.startsWith('#/pages/mine/library'))
  await page.getByText('合计 4 尾 · 部分未称重', { exact: true }).waitFor()
  await shot('catches-library-375')

  async function api(label, path, body) {
    const token = data.accounts.find((account) => account.label === label)?.session.access_token
    return page.evaluate(
      async ({ url, publicKey, token, body }) => {
        const abort = new AbortController(),
          timer = setTimeout(() => abort.abort(), 25000)
        try {
          const reply = await fetch(url, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {
              apikey: publicKey,
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              'Content-Type': 'application/json'
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            credentials: 'omit',
            redirect: 'error',
            signal: abort.signal
          })
          return { status: reply.status, json: await reply.json() }
        } finally {
          clearTimeout(timer)
        }
      },
      { url: project + path, publicKey, token, body }
    )
  }
  const rpc = (label, kind, action, payload) =>
    api(label, `/rest/v1/rpc/fishing_${kind}`, { action, payload })
  setPhase('catches-privacy')
  for (const label of ['b', 'outsider']) {
    const hidden = await rpc(label, 'read', 'edit_content', { type: 'trip', id: log.id })
    const direct = await api(label, `/rest/v1/trips?id=eq.${log.id}&select=catch_records`)
    check(
      hidden.status === 400 &&
        hidden.json.message === 'NOT_FOUND' &&
        direct.status === 200 &&
        direct.json.length === 0,
      `H5 private catches reject actor ${label} via RPC and direct RLS`
    )
  }
  const anon = await rpc(null, 'read', 'edit_content', { type: 'trip', id: log.id })
  check(
    anon.status === 400 && anon.json.message === 'AUTH_REQUIRED',
    'H5 anonymous visitor cannot read private catch details'
  )

  setPhase('catches-edit-retry')
  await button(page, '编辑日志').click()
  await input(2, '尾数').fill('2')
  await input(2, '重量（kg）').fill('1.2')
  await (offline ? offline(true) : page.context().setOffline(true))
  await button(page, '保存修改').click()
  await page.locator('.error[role="alert"]').waitFor()
  check((await value(2, '尾数')) === '2', 'H5 offline catch edit keeps local entries for retry')
  await shot('catches-offline-375')
  await (offline ? offline(false) : page.context().setOffline(false))
  const editing = replyFor(page, 'update_content')
  await button(page, '保存修改').click()
  const edited = await editing,
    command = edited.request().postDataJSON().payload
  check(edited.status() === 200, 'H5 catch edit retries successfully after connectivity returns')
  const attempts = writes.filter((item) => item.action === 'update_content')
  check(
    attempts.length >= 2 && attempts.at(-2).payload.request_id === command.request_id,
    'H5 unchanged catch edit retry uses the same idempotency key'
  )
  await page.waitForURL((url) => url.hash.startsWith('#/pages/mine/library'))
  await page.getByText('合计 5 尾 · 共 1.5 kg', { exact: true }).waitFor()
  const retry = await rpc('a', 'write', 'update_content', command)
  check(
    retry.status === 200 && retry.json.revision === 2,
    'H5 duplicate accepted catch edit returns its original revision'
  )
  const stale = await rpc('a', 'write', 'update_content', { ...command, request_id: randomUUID() })
  check(
    stale.json.message === 'EDIT_CONFLICT',
    'H5 stale catch revision cannot overwrite the current log'
  )
  const { catch_records, ...legacy } = command
  const legacyResult = await rpc('a', 'write', 'update_content', {
    ...legacy,
    revision: 2,
    request_id: randomUUID()
  })
  check(
    legacyResult.json.message === 'CATCH_DETAILS_REQUIRED',
    'H5 old client cannot flatten multiple catches'
  )

  setPhase('catches-share-repeat')
  await button(page, '再记一次').click()
  await input(1, '鱼种').waitFor()
  check(
    (await value(1, '鱼种')) === '鲫鱼' &&
      (await value(2, '鱼种')) === '鲤鱼' &&
      (await value(1, '尾数')) === '' &&
      (await value(2, '重量（kg）')) === '',
    'H5 repeat copies species but clears all previous catch quantities'
  )
  await go(page, '/pages/mine/library?type=trips')
  await button(page, '生成分享草稿').click()
  await field(page, '总重量（kg）').waitFor()
  check(
    (await page.locator('.trip-catches').count()) === 0 &&
      (await field(page, '总重量（kg）').inputValue()) === '' &&
      (await field(page, '鱼种').inputValue()) === '',
    'H5 sharing does not copy private catch detail or derived totals'
  )

  setPhase('catches-delete')
  await go(page, '/pages/mine/library?type=trips')
  await button(page, '删除日志').click()
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  check(
    (await button(page, '编辑日志').count()) === 1,
    'H5 cancelling log deletion retains private catches'
  )
  await button(page, '删除日志').click()
  const removing = replyFor(page, 'delete_content')
  await dialog.getByRole('button', { name: '删除记录', exact: true }).click()
  check((await removing).status() === 200, 'H5 confirmed deletion removes the private log')
  const late = await rpc('a', 'write', 'save_trip', original)
  check(
    late.status === 400 && late.json.message === 'NOT_FOUND',
    'H5 delayed create retry cannot resurrect deleted catch details'
  )
}
