// API/Auth fixtures only: no SMS, real reports, role grants or hosted writes.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5181'
const output = resolve('artifacts/content-reports', new Date().toISOString().replaceAll(':', '-'))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const checks = [],
  errors = [],
  escaped = [],
  calls = []
const owner = '11111111-1111-4111-8111-111111111111',
  reporter = '22222222-2222-4222-8222-222222222222',
  reviewer = '33333333-3333-4333-8333-333333333333'
const postId = 'a1111111-1111-4111-8111-111111111111',
  reportId = 'a2222222-2222-4222-8222-222222222222'
const author = {
  id: owner,
  nickname: '隔离测试作者',
  handle: 'TEST',
  city: '苏州',
  bio: '',
  method: ''
}
const post = {
  id: postId,
  type: 'post',
  kind: 'catch',
  title: '水域开放说明（接口测试）',
  body: '仅用于测试界面，不是真实用户内容。',
  author,
  audience: 'public',
  status: 'published',
  revision: 2,
  review_revision: 2,
  created_at: '2026-11-19T02:00:00Z',
  occurred_on: '2026-11-19',
  media: [],
  details: { 鱼种: '鲫鱼' },
  species: '鲫鱼',
  bait: '',
  method: '台钓',
  location_label: '',
  liked: false,
  saved: false,
  like_count: 0,
  comment_count: 0,
  weight_kg: null
}
let report = {
  id: reportId,
  type: 'post',
  title: post.title,
  reason: '开放情况可能变化，请核查。',
  status: 'pending',
  revision: 1,
  created_at: '2026-11-19T03:00:00Z',
  resolution: '',
  resolved_at: null
}
let allowed = false,
  submitted = false,
  submitFailure = true,
  resolutionFailure = false,
  conflict = false,
  missing = false,
  otherReviewer = false,
  pageFailure = false,
  photoAvailable = false
let activePage
const pass = (message) => {
  checks.push(message)
  console.log(`PASS ${message}`)
}
const button = (page, name) => page.getByRole('button', { name, exact: true })
const visible = (page, value) => page.getByText(value, { exact: true }).last().waitFor()
async function snapshot(page, name) {
  await page.waitForFunction(() => !document.querySelector('.mobile-action--pressed'))
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `${name}: no horizontal overflow`
  )
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true })
}
async function setup(user) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    locale: 'zh-CN',
    reducedMotion: 'reduce'
  })
  if (user)
    await context.addInitScript((user) => {
      localStorage.setItem(
        'dyj.auth.v1',
        JSON.stringify({
          type: 'object',
          data: {
            access_token: 'isolated-report-fixture',
            refresh_token: 'isolated-report-refresh',
            expires_at: Date.now() / 1000 + 3600,
            user: { id: user }
          }
        })
      )
    }, user)
  await context.routeWebSocket(/supabase\.co/, socket => socket.close())
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url())
    if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
    if (url.origin !== 'https://tlfmfokyhahlpzmpliad.supabase.co') {
      escaped.push(url.origin)
      return route.abort()
    }
    const reply = (json, status = 200) =>
      route.fulfill({
        json,
        status,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*'
        }
      })
    if (request.method() === 'OPTIONS') return reply({})
    if (url.pathname.startsWith('/storage/v1/object/sign/')) {
      if (request.method() === 'POST')
        return photoAvailable
          ? reply({ signedURL: '/object/sign/fishing-media/fixture/report.png?test=1' })
          : reply({ message: 'temporary' }, 503)
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
    if (url.pathname.endsWith('/fishing_read')) {
      if (body.action === 'post') return reply({ post, comments: [] })
      if (body.action === 'profile')
        return reply({ profile: { ...author, id: user }, posts: [], relationship: {} })
      return reply({ items: [], next: null })
    }
    if (url.pathname.endsWith('/fishing_moderation')) return reply({ allowed })
    if (!url.pathname.endsWith('/fishing_reports')) {
      escaped.push(url.pathname)
      return route.abort()
    }
    assert.equal(request.headers().authorization, 'Bearer isolated-report-fixture')
    calls.push({ user, ...body })
    if (body.action === 'submit') {
      if (submitFailure) {
        submitFailure = false
        return reply({ message: 'temporary' }, 503)
      }
      const duplicate = submitted
      submitted = true
      if (!duplicate) report.reason = body.payload.reason
      await new Promise((resolve) => setTimeout(resolve, 250))
      return reply({ id: reportId, status: report.status, duplicate })
    }
    if (body.action === 'mine') {
      if (pageFailure) return reply({ message: 'temporary' }, 503)
      return reply({ items: submitted ? [report] : [], next: null })
    }
    if (!allowed || user !== reviewer) return reply({ code: 'P0001', message: 'FORBIDDEN' }, 400)
    if (body.action === 'queue')
      return reply({
        items:
          body.payload.section === 'closed'
            ? report.status === 'pending'
              ? []
              : [report]
            : report.status === 'pending'
              ? [report]
              : [],
        next: null
      })
    if (body.action === 'item')
      return reply({
        report: { ...report, title: missing ? '内容已不可用' : report.title },
        content: missing ? null : post,
        content_revision: missing ? 0 : post.revision,
        changed: post.revision > 2,
        needs_other_reviewer: otherReviewer,
        can_hide: !missing
      })
    if (body.action === 'decide') {
      if (conflict) {
        conflict = false
        post.revision++
        post.body = '作者更新后的版本，必须重新核查。'
        return reply({ code: 'P0001', message: 'REVIEW_CONFLICT' }, 400)
      }
      if (resolutionFailure) {
        resolutionFailure = false
        return reply({ message: 'temporary' }, 503)
      }
      report = {
        ...report,
        status:
          body.payload.decision === 'hide'
            ? 'actioned'
            : body.payload.decision === 'dismiss'
              ? 'dismissed'
              : 'unavailable',
        resolution: body.payload.reason,
        resolved_at: new Date().toISOString(),
        revision: 2
      }
      return reply(report)
    }
    escaped.push(body.action)
    return route.abort()
  })
  const page = await context.newPage()
  activePage = page
  page.on('pageerror', (e) => errors.push(e.message))
  page.setDefaultTimeout(18000)
  const go = async (path) => {
    await page.goto(`${base}/#${path}`)
    await page.locator('.fishing-page').waitFor()
  }
  return { context, page, go }
}
try {
  const guest = await setup()
  await guest.go('/pages/content-report/index')
  await visible(guest.page, '登录后查看举报进度')
  assert.equal(calls.length, 0)
  await guest.context.close()
  pass('guest report history is gated without service requests')
  const user = await setup(reporter)
  await user.go(`/pages/post/detail?id=${postId}`)
  await button(user.page, '举报这条内容').click()
  await button(user.page, '提交举报').click()
  await visible(user.page, '请说明具体问题，方便审核员核查')
  await user.page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === '问题说明'
  )
  assert.equal(calls.filter((c) => c.action === 'submit').length, 0)
  const field = user.page.locator('textarea[aria-label="问题说明"]')
  await field.fill('开放情况可能变化，请核查。')
  await user.page.keyboard.press('Escape')
  await user.page.getByRole('dialog').waitFor({ state: 'hidden' })
  await button(user.page, '举报这条内容').click()
  assert.equal(await field.inputValue(), '开放情况可能变化，请核查。')
  await button(user.page, '提交举报').click()
  await visible(user.page, '服务暂时不可用，请稍后重试')
  assert.equal(await field.inputValue(), '开放情况可能变化，请核查。')
  await snapshot(user.page, 'report-form-failure-375')
  await button(user.page, '提交举报').click()
  await visible(user.page, '举报已提交，可在我的社区举报查看进度。')
  await button(user.page, '举报这条内容').click()
  await field.fill('重复点击后的说明，不应该覆盖原举报')
  await button(user.page, '提交举报').click()
  await visible(user.page, '你已提交过这条内容，可在我的社区举报查看进度。')
  await button(user.page, '查看社区举报记录').click()
  await visible(user.page, report.reason)
  await snapshot(user.page, 'report-history-pending-375')
  pass(
    'report form validates, focuses, retains canceled/failed input, submits and opens private progress'
  )
  pageFailure = true
  await button(user.page, '刷新列表').click()
  await visible(user.page, '服务暂时不可用，请稍后重试')
  assert.equal(await user.page.getByText(report.title, { exact: true }).count(), 0)
  pageFailure = false
  await button(user.page, '刷新列表').click()
  await visible(user.page, report.reason)
  await user.page.evaluate(() => {
    localStorage.removeItem('dyj.auth.v1')
    window.dispatchEvent(new StorageEvent('storage', { key: 'dyj.auth.v1', newValue: null }))
  })
  await visible(user.page, '登录后查看举报进度')
  assert.equal(await user.page.getByText(report.reason, { exact: true }).count(), 0)
  pass('failed refresh and cross-tab logout clear private history')
  await user.context.close()

  const admin = await setup(reviewer),
    p = admin.page
  await admin.go('/pages/content-report/index?review=1')
  await visible(p, '你没有执行此操作的权限')
  allowed = true
  await button(p, '刷新列表').click()
  await visible(p, report.title)
  await snapshot(p, 'review-queue-375')
  await button(p, `处理举报：${report.title}`).click()
  await visible(p, post.body)
  assert.equal((await p.locator('body').innerText()).includes(reporter), false)
  await button(p, '隐藏内容并结案').click()
  await p.keyboard.press('Escape')
  await p.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(calls.filter((c) => c.action === 'decide').length, 0)
  await button(p, '隐藏内容并结案').click()
  await button(p, '确认隐藏内容并结案').click()
  await visible(p, '请填写处理说明，举报人会看到这段内容')
  await p.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '处理说明')
  await p.locator('textarea[aria-label="处理说明"]').fill('开放信息需进一步核实，暂时隐藏。')
  conflict = true
  await button(p, '确认隐藏内容并结案').click()
  await visible(p, '内容已更新或已被处理，请重新读取后再审核')
  assert.equal(await button(p, '确认隐藏内容并结案').count(), 0)
  await button(p, '重新读取内容').click()
  await visible(p, post.body)
  await visible(p, '内容在举报后有过更新，请以当前版本重新核查。')
  pass(
    'review validates reason, supports Escape and blocks stale-content decisions until a fresh read'
  )
  post.media = [
    {
      id: 'd1111111-1111-4111-8111-111111111111',
      path: 'fixture/report.png',
      width: 100,
      height: 100
    }
  ]
  await p.reload()
  await visible(p, '照片暂不可用')
  assert.equal(await button(p, '不处理内容并结案').isDisabled(), true)
  photoAvailable = true
  await button(p, '重新读取照片').click()
  await p.waitForFunction(() =>
    [...document.querySelectorAll('[role="button"]')].some(
      (n) =>
        n.textContent.trim() === '不处理内容并结案' && n.getAttribute('aria-disabled') !== 'true'
    )
  )
  post.media = []
  await p.reload()
  await visible(p, post.body)
  pass('unreadable report photos prevent dismissal until successfully retried (test-only pixel)')
  for (const width of [320, 375, 440, 844, 1280]) {
    await p.setViewportSize({ width, height: width === 844 ? 390 : 900 })
    await snapshot(p, `review-detail-${width}`)
  }
  await p.setViewportSize({ width: 320, height: 812 })
  await p.emulateMedia({ colorScheme: 'dark' })
  await p.addStyleTag({ content: 'html { font-size: 24px !important; }' })
  await snapshot(p, 'review-detail-dark-large-320')
  await button(p, '隐藏内容并结案').click()
  await p.locator('textarea[aria-label="处理说明"]').fill('开放信息需进一步核实，暂时隐藏。')
  await snapshot(p, 'review-sheet-dark-large-320')
  const targets = await p
    .getByRole('dialog')
    .getByRole('button')
    .evaluateAll((nodes) =>
      nodes
        .filter((n) => n.getBoundingClientRect().width)
        .map((n) => ({
          name: n.getAttribute('aria-label') || n.textContent.trim(),
          height: n.getBoundingClientRect().height
        }))
    )
  assert.ok(
    targets.every((t) => t.height >= 44),
    JSON.stringify(targets)
  )
  pass(
    'review layouts fit 320/375/440/landscape/wide and dark 150% text; sheet actions keep 44px targets'
  )
  resolutionFailure = true
  await button(p, '确认隐藏内容并结案').click()
  await visible(p, '服务暂时不可用，请稍后重试')
  await button(p, '确认隐藏内容并结案').click()
  await visible(p, '处理结果已保存，举报人可以查看说明。')
  const decisions = calls.filter((c) => c.action === 'decide')
  assert.equal(decisions.at(-1).payload.request_id, decisions.at(-2).payload.request_id)
  assert.equal(decisions.at(-1).payload.content_revision, post.revision)
  assert.equal(await button(p, '隐藏内容并结案').count(), 0)
  await snapshot(p, 'review-complete-dark-large-320')
  pass(
    'failed resolution preserves input and idempotency key; resolved report has no duplicate action'
  )
  await admin.go('/pages/content-report/index?review=1')
  await button(p, '已处理').click()
  await visible(p, report.title)
  allowed = false
  await button(p, '刷新列表').click()
  await visible(p, '你没有执行此操作的权限')
  assert.equal(await p.getByText(report.title, { exact: true }).count(), 0)
  pass('closed report history is visible only while moderator permission remains valid')
  allowed = true
  missing = true
  report.status = 'pending'
  report.revision = 1
  report.resolution = ''
  report.resolved_at = null
  await admin.go(`/pages/content-report/detail?id=${reportId}`)
  await visible(p, '内容已删除或改为私密，不再读取原文。结案不会恢复内容。')
  assert.equal(await button(p, '隐藏内容并结案').count(), 0)
  assert.equal(await button(p, '不处理内容并结案').count(), 0)
  await button(p, '按内容不可用结案').waitFor()
  otherReviewer = true
  await p.reload()
  await visible(p, '自己提交的举报或涉及自己的内容，请由另一位审核员处理。')
  assert.equal(await button(p, '按内容不可用结案').count(), 0)
  pass(
    'withdrawn content cannot be restored or hidden; self-involved reviewer has no decision actions'
  )
  otherReviewer = false
  missing = false
  await p.reload()
  await button(p, '隐藏内容并结案').click()
  await p.locator('textarea[aria-label="处理说明"]').fill('检查权限撤销')
  allowed = false
  await button(p, '确认隐藏内容并结案').click()
  await visible(p, '你没有执行此操作的权限')
  assert.equal(await p.getByText(post.body, { exact: true }).count(), 0)
  assert.equal(await p.getByRole('dialog').count(), 0)
  pass('revocation while deciding clears privileged detail and closes the sheet')
  await admin.context.close()
  const final = await setup(reporter)
  report.status = 'actioned'
  report.resolution = '开放信息需进一步核实，暂时隐藏。'
  report.resolved_at = new Date().toISOString()
  await final.go('/pages/content-report/index')
  await visible(final.page, report.resolution)
  await snapshot(final.page, 'reporter-result-375')
  await final.page.setViewportSize({ width: 320, height: 812 })
  await final.page.emulateMedia({ colorScheme: 'dark' })
  await final.page.addStyleTag({ content: 'html { font-size: 24px !important; }' })
  await snapshot(final.page, 'reporter-result-dark-large-320')
  await final.context.close()
  assert.deepEqual(errors, [])
  assert.deepEqual(escaped, [])
  pass(
    'reporter receives outcome without identities; no uncaught errors or unhandled external calls'
  )
} catch (e) {
  try {
    await activePage?.screenshot({ path: resolve(output, 'failure.png'), fullPage: true })
  } catch {}
  throw e
} finally {
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(
      {
        fixtureOnly: true,
        checks,
        errors,
        escaped,
        reportCalls: calls.map((c) => ({
          action: c.action,
          userRole: c.user === reviewer ? 'reviewer' : 'reporter'
        }))
      },
      null,
      2
    )
  )
  await browser.close()
  console.log(`Evidence: ${output}`)
}
