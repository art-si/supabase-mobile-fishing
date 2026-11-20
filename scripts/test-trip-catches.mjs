// Isolated HTTP contract in the real H5 editor. No remote writes, SMS or native-device claim.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tripCatchesFlow } from './trip-catches-flow.mjs'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5179'
const project = 'https://tlfmfokyhahlpzmpliad.supabase.co'
const out = resolve(
  'artifacts/trip-catches',
  new URL(base).port === '5181' ? 'production-contract' : 'contract'
)
await mkdir(out, { recursive: true })
const checks = [],
  unexpected = [],
  errors = []
const data = {
  accounts: ['a', 'b', 'outsider'].map((label, i) => ({
    label,
    session: {
      access_token: `isolated-catch-${label}`,
      refresh_token: `isolated-refresh-${label}`,
      expires_at: Date.now() / 1000 + 3600,
      user: { id: `${i + 1}1111111-1111-4111-8111-111111111111` }
    }
  }))
}
const owner = data.accounts[0].session.user.id
const logs = new Map(),
  receipts = new Map(),
  created = new Set()
let fixtureOffline = false
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width: 375, height: 812 },
  locale: 'zh-CN',
  reducedMotion: 'reduce'
})
await context.addInitScript(
  ({ session }) => {
    if (!localStorage.getItem('dyj.auth.v1'))
      localStorage.setItem('dyj.auth.v1', JSON.stringify({ type: 'object', data: session }))
  },
  { session: data.accounts[0].session }
)
await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
await context.route('**/*', async (route) => {
  const req = route.request(),
    url = new URL(req.url())
  if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
  if (url.origin !== project) {
    unexpected.push(url.origin)
    return route.abort()
  }
  if (fixtureOffline) return route.abort('internetdisconnected')
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*'
  }
  const reply = (json, status = 200) => route.fulfill({ json, status, headers })
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  const auth = req.headers().authorization || '',
    isOwner = auth === 'Bearer isolated-catch-a'
  const body = req.method() === 'POST' ? req.postDataJSON() : {},
    p = body.payload || {}
  if (url.pathname.endsWith('/fishing_moderation')) return reply({ allowed: false })
  if (url.pathname === '/rest/v1/trips') return reply(isOwner ? [...logs.values()] : [])
  if (url.pathname.endsWith('/fishing_read')) {
    if (body.action === 'profile')
      return reply({
        profile: {
          id: owner,
          nickname: '隔离测试',
          handle: 'ISOLATED',
          city: '',
          bio: '',
          method: '台钓'
        },
        posts: []
      })
    if (body.action === 'social') return reply({ friends: [], requests: [], conversations: [] })
    if (body.action === 'library')
      return reply({ trips: isOwner ? [...logs.values()] : [], posts: [], spots: [] })
    if (body.action === 'edit_content')
      return isOwner && logs.has(p.id)
        ? reply({ item: logs.get(p.id), revision: logs.get(p.id).revision })
        : reply({ message: auth ? 'NOT_FOUND' : 'AUTH_REQUIRED' }, 400)
    if (['feed', 'spots'].includes(body.action)) return reply({ items: [], next: null })
  }
  if (url.pathname.endsWith('/fishing_write') && isOwner) {
    if (body.action === 'delete_content') {
      logs.delete(p.id)
      return reply(true)
    }
    if (body.action === 'save_trip') {
      if (logs.has(p.id)) return reply(logs.get(p.id))
      if (created.has(p.id)) return reply({ message: 'NOT_FOUND' }, 400)
      created.add(p.id)
    } else if (body.action === 'update_content') {
      if (receipts.has(p.request_id)) return reply(receipts.get(p.request_id))
      if (!logs.has(p.id) || logs.get(p.id).revision !== p.revision)
        return reply({ message: 'EDIT_CONFLICT' }, 400)
      if (!p.catch_records) return reply({ message: 'CATCH_DETAILS_REQUIRED' }, 400)
    } else {
      unexpected.push(body.action)
      return route.abort()
    }
    const rows = p.catch_records
    const log = {
      id: p.id,
      title: p.title,
      body: p.body,
      occurred_on: p.occurred_on,
      method: p.method,
      bait: p.bait,
      species: rows.length === 1 ? rows[0].species : rows.length ? '多条渔获' : '',
      count:
        rows.length && rows.every((row) => row.count !== null)
          ? rows.reduce((n, row) => n + row.count, 0)
          : null,
      weight_kg:
        rows.length && rows.every((row) => row.weight_kg !== null)
          ? rows.reduce((n, row) => n + row.weight_kg, 0)
          : null,
      catch_records: rows,
      media: [],
      created_at: new Date().toISOString(),
      revision: (p.revision || 0) + 1
    }
    logs.set(log.id, log)
    if (body.action === 'save_trip') return reply(log)
    const receipt = { id: p.id, revision: log.revision }
    receipts.set(p.request_id, receipt)
    return reply(receipt)
  }
  unexpected.push(url.pathname)
  return route.abort()
})
const page = await context.newPage()
page.setDefaultTimeout(12000)
page.on('pageerror', (e) => errors.push(e.message))
const button = (tab, name) => tab.getByRole('button', { name, exact: true })
const field = (tab, name) =>
  tab.locator(`input[aria-label="${name}"],textarea[aria-label="${name}"]`)
const go = (tab, path) => tab.goto(`${base}/#${path}`)
const check = (condition, label) => {
  assert.ok(condition, label)
  checks.push(label)
}
const shot = async (name) => {
  await page.screenshot({ path: resolve(out, `${name}.png`), fullPage: true })
}
const fits = async (label) =>
  check(
    await page.evaluate(
      () =>
        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth + 1
    ),
    label
  )
const replyFor = (tab, action) =>
  tab.waitForResponse(
    (reply) =>
      reply.url().endsWith('/fishing_write') && reply.request().postDataJSON().action === action
  )
let phase = 'start',
  passed = false
try {
  await tripCatchesFlow({
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
    setPhase: (value) => (phase = value),
    offline: async (value) => {
      fixtureOffline = value
      await context.setOffline(value)
    }
  })
  phase = 'catches-capacity-contract'
  const capacityId = 'a4444444-4444-4444-8444-444444444444'
  logs.set(capacityId, {
    id: capacityId,
    title: '多条明细界面验收（隔离样例）',
    body: '仅在浏览器测试中存在，不写远端。',
    occurred_on: '2026-11-20',
    method: '台钓',
    bait: '',
    species: '多条渔获',
    count: 4,
    weight_kg: null,
    revision: 1,
    media: [],
    created_at: new Date().toISOString(),
    catch_records: Array.from({ length: 4 }, (_, index) => ({
      species: `样例鱼种${index + 1}`,
      count: 1,
      weight_kg: null
    }))
  })
  await go(page, '/pages/mine/library?type=trips')
  // The preceding flow already ended on this URL; reload explicitly to read the new fixture.
  await page.reload()
  await button(page, '查看全部 4 条渔获').waitFor()
  check(
    (await page.locator('.trip-catch-list__row').count()) === 3,
    'Contract long catch list starts with three rows'
  )
  await button(page, '查看全部 4 条渔获').click()
  check(
    (await page.locator('.trip-catch-list__row').count()) === 4,
    'Contract catch list expands to show every saved entry'
  )
  await shot('catches-list-expanded')
  await button(page, '收起渔获明细').click()
  await button(page, '编辑日志').click()
  const firstSpecies = field(page, '渔获 1 鱼种')
  await firstSpecies.focus()
  await page.keyboard.press('Tab')
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
    '渔获 1 尾数'
  )
  await page.keyboard.press('Tab')
  check(
    (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) ===
      '渔获 1 重量（kg）',
    'Contract catch fields follow logical keyboard order'
  )
  for (let i = 4; i < 20; i++) await button(page, '添加一条渔获').click()
  check(
    (await page.locator('.trip-catches__row').count()) === 20 &&
      (await button(page, '已记录 20 条渔获').isDisabled()),
    'Contract editor enforces the twenty-row capacity'
  )
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === '渔获 20 鱼种'
  )
  check(true, 'Contract adding a catch focuses its species field')
  for (let i = 20; i > 0; i--) await button(page, `移除渔获 ${i}`).click()
  const clearing = replyFor(page, 'update_content')
  await button(page, '保存修改').click()
  assert.equal((await clearing).status(), 200)
  check(
    logs.get(capacityId).catch_records.length === 0 &&
      logs.get(capacityId).count === null &&
      logs.get(capacityId).weight_kg === null,
    'Contract clearing every row saves empty details without fake zero totals'
  )
  assert.deepEqual(unexpected, [])
  assert.deepEqual(errors, [])
  passed = true
} catch (error) {
  console.error(`Failed contract at ${phase}: ${error.message}`)
  await shot(`failed-${phase}`).catch(() => {})
} finally {
  await browser.close()
  await writeFile(
    resolve(out, 'result.json'),
    JSON.stringify(
      {
        evidence: 'intercepted HTTP contract, no remote writes',
        base,
        passed,
        phase,
        checks,
        errors,
        unexpected
      },
      null,
      2
    )
  )
}
console.log(JSON.stringify({ passed, phase, checks: checks.length, output: out }))
process.exitCode = passed ? 0 : 1
