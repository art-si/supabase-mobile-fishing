// Real H5 + hosted owner workflow. Only pending/withdrawn test records are created.
// No moderator grant, public safety overlay, fake provider response or device GPS.
import { randomUUID } from 'node:crypto'
import { setH5TextScale } from './h5-text-scale.mjs'

export async function zones({
  page,
  data,
  project,
  accountPage,
  button,
  field,
  go,
  replyFor,
  shot,
  fits,
  check,
  setPhase
}) {
  await page.context().addInitScript(() => {
    Object.defineProperty(navigator, 'permissions', {
      value: { query: async () => ({ state: 'denied' }) }
    })
  })
  const writes = []
  page.on('request', (request) => {
    if (
      request.url() === `${project}/rest/v1/rpc/fishing_zones_write` &&
      request.method() === 'POST'
    )
      writes.push(request.postDataJSON()) // In-memory only; never serialize coordinates or auth.
  })
  setPhase('zone-map-search')
  await go(page, '/pages/map/index')
  await field(page, '搜索高德地点').fill('苏州金鸡湖')
  await page.getByRole('option').first().waitFor({ timeout: 40000 })
  const nearbyReply = replyFor(page, 'nearby')
  await page.getByRole('option').first().click()
  check(
    (await nearbyReply).status() === 200,
    'Real AMap selection loads hosted zone data without GPS'
  )
  await button(page, '圈选提醒').click()
  const title = '隔离验收·不公开的标记'
  const description = '这是临时功能验收材料，不是真实禁钓信息，保持待审核并在验收后清理。'
  await field(page, '参考半径（米）').fill('1000')
  await field(page, '提醒名称').fill(title)
  await field(page, '地点说明').fill('测试地点，非真实管控信息')
  await field(page, '现场依据').fill(description)

  setPhase('zone-consent-and-offline')
  await button(page, '提交审核').click()
  await page.getByText('请确认审核后公开的范围与说明。', { exact: true }).waitFor()
  check(writes.length === 0, 'Zone submission requires explicit consent before any remote write')
  await page.getByRole('checkbox').click()
  await page.context().setOffline(true)
  try {
    await button(page, '提交审核').click()
    await page.getByText('网络连接中断，请检查网络后重试', { exact: true }).first().waitFor()
    check(
      (await field(page, '现场依据').inputValue()) === description,
      'Offline zone submission keeps the entered evidence and draft'
    )
    await shot('zone-offline-375')
  } finally {
    await page.context().setOffline(false)
  }
  setPhase('zone-submit-retry')
  const submitted = replyFor(page, 'submit')
  await button(page, '提交审核').click()
  const response = await submitted
  check(response.status() === 200, 'Zone retry persists through the real ordinary-user RPC')
  const saved = await response.json()
  const submittedBody = response.request().postDataJSON()
  const original = submittedBody.payload
  const publicKey = (await response.request().allHeaders()).apikey
  check(
    saved.id === original.id && saved.status === 'pending' && saved.revision === 1,
    'New zone is pending and never implicitly published'
  )
  check(
    original.crs === 'GCJ-02' &&
      original.radius_m === 1000 &&
      original.consent === true &&
      Number.isFinite(original.longitude) &&
      Number.isFinite(original.latitude),
    'Real zone save preserves confirmed circle and coordinate system'
  )
  check(
    writes.length === 2 && JSON.stringify(writes[0]) === JSON.stringify(writes[1]),
    'Offline retry reuses the exact zone and idempotency request identifiers'
  )
  await page
    .getByText('已提交审核，暂不公开。可在“我的标记”查看或撤回。', { exact: true })
    .waitFor()

  async function api(label, operation, action, payload = {}) {
    const session = data.accounts.find((account) => account.label === label)?.session
    return page.evaluate(
      async ({ url, key, token, action, payload }) => {
        const abort = new AbortController()
        const timeout = setTimeout(() => abort.abort(), 25000)
        try {
          const reply = await fetch(url, {
            method: 'POST',
            credentials: 'omit',
            redirect: 'error',
            signal: abort.signal,
            headers: {
              apikey: key,
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ action, payload })
          })
          return { status: reply.status, json: await reply.json() }
        } finally {
          clearTimeout(timeout)
        }
      },
      {
        url: `${project}/rest/v1/rpc/fishing_zones_${operation}`,
        key: publicKey,
        token: session?.access_token,
        action,
        payload
      }
    )
  }
  const own = async () => {
    const result = await api('a', 'read', 'mine')
    check(result.status === 200, 'Owner zone history remains readable through the real API')
    return result.json.items.filter((zone) => zone.id === saved.id)
  }
  const rejected = (result, code) =>
    [400, 401, 403, 404].includes(result.status) && result.json.message === code

  setPhase('zone-owner-history')
  await button(page, '我的标记').click()
  await page.getByText('待审核 · 尚未公开', { exact: true }).waitFor()
  await page.getByText(title, { exact: true }).waitFor()
  check((await own()).length === 1, 'Owner sees exactly one pending zone after retry')
  setPhase('zone-saved-map-preview')
  const staticCalls = []
  const trackStatic = (request) => {
    if (request.url().includes('/functions/v1/amap') && !request.url().includes('/amap-js/'))
      staticCalls.push(request.url().split('?')[0])
  }
  page.on('request', trackStatic)
  await button(page, '预览参考范围').click()
  const preview = page.locator('.zone-preview__map[aria-busy="false"]')
  await preview.waitFor({ timeout: 40000 })
  check(
    (await preview.locator('canvas').count()) > 0,
    'Saved circle preview uses the actual AMap renderer'
  )
  await page.getByRole('button', { name: '放大范围地图', exact: true }).click()
  await page.getByRole('button', { name: '缩小范围地图', exact: true }).click()
  await button(page, '完整范围').focus()
  await page.keyboard.press('Enter')
  check(
    staticCalls.length === 0,
    'H5 saved circle preview does not depend on a static Web-service key'
  )
  page.off('request', trackStatic)
  for (const [name, width, height, dark, large] of [
    ['375', 375, 812, false, false],
    ['320-dark-large', 320, 720, true, true],
    ['440', 440, 956, false, false],
    ['landscape', 812, 375, false, false],
    ['wide', 1280, 900, false, false]
  ]) {
    setPhase(`zone-history-${name}`)
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
    await setH5TextScale(page, large ? 24 : 16)
    check(
      await page.evaluate(
        (expected) => getComputedStyle(document.documentElement).fontSize === expected,
        large ? '24px' : '16px'
      ),
      `Zone history ${name} applies the tested font size`
    )
    await fits(`Zone history ${name} has no horizontal overflow`)
    await shot(`zone-mine-${name}`)
    await page.locator('.zone-preview__map').scrollIntoViewIfNeeded()
    await page.waitForTimeout(1600)
    await shot(`zone-range-visible-${name}`, page, false)
    check(
      await page
        .locator('.zone-description')
        .evaluate(
          (el, expected) => getComputedStyle(el).fontSize === expected,
          large ? '24px' : '16px'
        ),
      `Zone history ${name} keeps actual body text scale through the screenshot`
    )
  }
  await button(page, '收起范围预览').click()
  check(
    (await page.locator('.zone-preview').count()) === 0,
    'Closing the saved range removes its map instance container'
  )

  setPhase('zone-privacy-and-idempotency')
  const anonymous = await api(null, 'read', 'mine')
  check(
    rejected(anonymous, 'NOT_AUTHENTICATED'),
    'Anonymous callers cannot read personal zone history'
  )
  const outsider = await api('outsider', 'read', 'mine', {
    author_id: data.accounts[0].session.user.id
  })
  check(
    outsider.status === 200 && !outsider.json.items.some((zone) => zone.id === saved.id),
    'A forged author filter cannot expose another account pending zone'
  )
  const bounds = {
    west: original.longitude - 0.1,
    east: original.longitude + 0.1,
    south: original.latitude - 0.1,
    north: original.latitude + 0.1
  }
  const publicZones = await api(null, 'read', 'nearby', bounds)
  check(
    publicZones.status === 200 && !publicZones.json.items.some((zone) => zone.id === saved.id),
    'Pending test zone is absent from actual public map results'
  )
  const repeated = await api('a', 'write', 'submit', original)
  check(
    repeated.status === 200 && repeated.json.id === saved.id && repeated.json.revision === 1,
    'Confirmed submission replay returns the original result without a second zone'
  )
  const changed = await api('a', 'write', 'submit', { ...original, title: '修改后的重复请求' })
  check(
    rejected(changed, 'EDIT_REQUEST_REUSED'),
    'Changed payload cannot reuse a committed submission receipt'
  )
  const unauthorized = await api('outsider', 'write', 'withdraw', {
    id: saved.id,
    request_id: randomUUID(),
    revision: 1
  })
  check(
    rejected(unauthorized, 'FORBIDDEN'),
    'Another account cannot withdraw the private pending zone'
  )
  const selfApprove = await api('a', 'write', 'decide', {
    id: saved.id,
    request_id: randomUUID(),
    revision: 1,
    decision: 'published',
    reason: '仅验证拒绝'
  })
  check(rejected(selfApprove, 'FORBIDDEN'), 'Ordinary author cannot approve or publish a zone')
  const official = await api('a', 'write', 'submit', {
    ...original,
    id: randomUUID(),
    request_id: randomUUID(),
    source: 'official',
    status: 'published'
  })
  check(
    rejected(official, 'INVALID_INPUT'),
    'Submission cannot forge official provenance or published status'
  )
  const stale = await api('a', 'write', 'withdraw', {
    id: saved.id,
    request_id: randomUUID(),
    revision: 0
  })
  check(
    rejected(stale, 'REVIEW_CONFLICT') && (await own())[0]?.status === 'pending',
    'A stale withdrawal fails without changing the current zone'
  )

  setPhase('zone-withdraw-confirmation')
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'light' })
  await setH5TextScale(page, 16)
  await button(page, '撤回标记').click()
  const dialog = page.getByRole('alertdialog', { name: '撤回这条标记？' })
  await shot('zone-withdraw-confirm-375', page, false)
  const beforeCancel = writes.length
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  check(
    writes.length === beforeCancel && (await own())[0]?.status === 'pending',
    'Cancelling withdrawal leaves the real pending zone unchanged'
  )
  await button(page, '撤回标记').click()
  const withdrawnReply = replyFor(page, 'withdraw')
  await dialog.getByRole('button', { name: '撤回标记', exact: true }).click()
  const withdrawnResponse = await withdrawnReply
  check(
    withdrawnResponse.status() === 200,
    'Confirmed withdrawal persists through the actual user RPC'
  )
  const withdrawal = withdrawnResponse.request().postDataJSON().payload
  await page.getByText('已撤回', { exact: true }).waitFor()
  await page.reload()
  await page.getByText('已撤回', { exact: true }).waitFor()
  const after = await own()
  check(
    after.length === 1 && after[0].status === 'withdrawn' && after[0].revision === 2,
    'Reloaded owner history retains the withdrawn record and incremented revision'
  )
  const repeatedWithdrawal = await api('a', 'write', 'withdraw', withdrawal)
  check(
    repeatedWithdrawal.status === 200 && repeatedWithdrawal.json.revision === 2,
    'Withdrawal replay is idempotent and does not increment revision again'
  )
  await shot('zone-withdrawn-375')

  setPhase('zone-review-denied')
  const other = await accountPage('b')
  const forbiddenReview = replyFor(other, 'review')
  await go(other, '/pages/map/marks?review=1')
  check(
    rejected(
      { status: (await forbiddenReview).status(), json: await (await forbiddenReview).json() },
      'FORBIDDEN'
    ),
    'Direct navigation does not grant ordinary users zone moderation access'
  )
  await other.getByText('标记未加载', { exact: true }).waitFor()
  check(
    (await button(other, '通过提醒').count()) === 0,
    'Denied moderation view exposes no approval action'
  )
  const lastPublic = await api(null, 'read', 'nearby', bounds)
  check(
    lastPublic.status === 200 && !lastPublic.json.items.some((zone) => zone.id === saved.id),
    'Withdrawn test zone remains absent from the public map'
  )
}
