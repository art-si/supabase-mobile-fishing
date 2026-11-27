// Production H5 UI with isolated responses. Real touch gestures, no hosted writes or login.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
const output = 'artifacts/pull-refresh'; await mkdir(output, { recursive: true })
const owner = '11111111-1111-4111-8111-111111111111', postId = '22222222-2222-4222-8222-222222222222'
const profile = { id: owner, nickname: '刷新验收', city: '', bio: '', method: '', handle: '' }
const post = { id: postId, author: profile, title: '下拉刷新鱼情', body: '隔离接口样本。', kind: 'catch', species: '鲫鱼', method: '台钓', bait: '', audience: 'public', status: 'published', created_at: new Date().toISOString(), like_count: 0, comment_count: 0, liked: false, saved: false, review_revision: 0, media: [] }
const spotId = '44444444-4444-4444-8444-444444444444'
const spot = { id: spotId, name: '刷新钓位', city: '武汉市', author: profile, water_type: '自然水域', precision: 'hidden', audience: 'public', status: 'published' }
const summary = { target: `spot:${spotId}`, likes: 0, liked: false, saved: false, comments: 1, status: '' }
const comment = { id: '55555555-5555-4555-8555-555555555555', body: '隔离评论行', author: profile, own: true, created_at: new Date().toISOString(), media: [], reply_to_id: null, reply_to: null }
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'zh-CN', permissions: ['geolocation'], geolocation: { longitude: 114.3, latitude: 30.5 } })
const page = await context.newPage(), cdp = await context.newCDPSession(page)
const checks = [], errors = [], escaped = [], calls = []
let release, hold = false, failFeed = 0
let releaseComments, holdComments = false
await context.addInitScript(owner => localStorage.setItem('dyj.auth.v1', JSON.stringify({ type: 'object', data: { access_token: 'isolated-pull-refresh', refresh_token: 'fixture', expires_at: Date.now() / 1000 + 3600, user: { id: owner } } })), owner)
await context.routeWebSocket(/supabase\.co/, socket => socket.close())
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url())
  if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
  if (url.origin !== 'https://jupuypvmgjpnpntfetqv.supabase.co') { escaped.push(url.origin); return route.abort() }
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
  const reply = json => route.fulfill({ json, headers })
  if (request.method() === 'OPTIONS') return reply({})
  if (url.pathname === '/auth/v1/user') return reply({ id: owner })
  if (url.pathname.endsWith('fishing_read')) {
    const body = request.postDataJSON() || {}; calls.push(body)
    if (body.action === 'feed') {
      if (hold) await new Promise(resolve => { release = resolve })
      if (failFeed) { failFeed--; return route.fulfill({ status: 503, json: { error: 'temporarily unavailable' }, headers }) }
      return reply({ items: [post], next: null })
    }
    if (body.action === 'post') return reply({ post, comments: [], comments_next: null })
    if (body.action === 'spot') return reply(spot)
    if (body.action === 'profile') return reply({ profile, following: false, blocked: false, posts: [post], posts_next: null })
    if (body.action === 'library_posts') return reply({ items: [post], next: null })
    if (body.action === 'library_spots' || body.action === 'library_trips') return reply({ items: [], next: null })
    return reply({ items: [], posts: [], spots: [], trips: [], next: null })
  }
  if (url.pathname.endsWith('fishing_moderation')) return reply({ allowed: false })
  if (url.pathname.endsWith('fishing_spot_community')) {
    const body = request.postDataJSON() || {}; calls.push(body)
    if (body.action === 'summary') return reply([summary])
    if (body.action === 'comments') {
      if (holdComments) await new Promise(resolve => { releaseComments = resolve })
      return reply({ summary, items: [comment], next: null })
    }
    return reply([])
  }
  if (url.pathname.endsWith('spot-discovery')) return reply({ ok: true })
  escaped.push(`${request.method()} ${url.pathname}`); return route.abort()
})
page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(20000)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const count = action => calls.filter(call => call.action === action).length
async function until(predicate) { for (let n = 0; n < 80; n++) { if (await predicate()) return; await pause(100) } throw new Error('Pull refresh condition timed out') }
async function pull() {
  await page.locator('.uni-page-refresh--restoring,.uni-page-refresh--aborting').waitFor({ state: 'detached' })
  await page.evaluate(() => window.scrollTo(0, 0)); await pause(100)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 8, y: 160 }] })
  for (const y of [190, 230, 280, 340, 410, 480]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 8, y }] }); await pause(25)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}
try {
  await page.goto(`${base}/#/pages/home/index`); await page.getByText(post.title, { exact: true }).waitFor()
  await page.getByText('关注', { exact: true }).click()
  await page.locator('.mobile-search input').fill('鲫鱼')
  await until(() => calls.some(call => call.action === 'feed' && call.payload?.query === '鲫鱼'))
  await pause(500)
  hold = true; const previous = count('feed'); await pull(); await until(() => count('feed') > previous)
  await page.locator('.uni-page-refresh--refreshing').waitFor()
  await page.screenshot({ path: `${output}/home-pulling.png` })
  const last = calls.filter(call => call.action === 'feed').at(-1)
  assert.equal(last.payload.filter, 'following'); assert.equal(last.payload.query, '鲫鱼'); assert.equal(last.payload.cursor, undefined)
  checks.push('H5 touch pull performs a fresh first-page query and retains feed filter and submitted text')
  release(); hold = false; await page.locator('.uni-page-refresh--refreshing').waitFor({ state: 'detached' })
  checks.push('native H5 refresh spinner stays visible during the pending query and stops after completion')
  failFeed = 2; const beforeFailure = count('feed'); await pull(); await until(() => count('feed') > beforeFailure)
  await page.getByText('鱼情暂未加载', { exact: true }).waitFor()
  await page.locator('.uni-page-refresh--refreshing').waitFor({ state: 'detached' })
  const beforeRetry = count('feed'); await pull(); await until(() => count('feed') > beforeRetry)
  await page.locator('.uni-page-refresh--refreshing').waitFor({ state: 'detached' })
  checks.push('failed refresh also stops its spinner and a later pull retries')
  await page.getByText('我的', { exact: true }).click()
  await page.getByText('我的记录', { exact: true }).click()
  await page.getByRole('heading', { name: '我的记录', exact: true }).waitFor(); await page.getByText(post.title, { exact: true }).waitFor()
  await pause(600)
  const beforeLibrary = count('library_posts'); await pull(); await until(() => count('library_posts') > beforeLibrary)
  await page.locator('.uni-page-refresh--refreshing').waitFor({ state: 'detached' })
  await page.screenshot({ path: `${output}/library-refreshed.png` })
  checks.push('personal long-list pull reloads its current category instead of resetting the selected library')
  await page.getByText(post.title, { exact: true }).click()
  await page.locator('.post-comments textarea').waitFor(); await page.locator('.post-comments textarea').fill('刷新仍保留的评论草稿')
  await pause(600)
  const beforePost = count('post'); await pull(); await until(() => count('post') > beforePost)
  await page.locator('.uni-page-refresh--refreshing').waitFor({ state: 'detached' })
  assert.equal(await page.locator('.post-comments textarea').inputValue(), '刷新仍保留的评论草稿')
  await page.locator('.post-comments textarea').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${output}/post-draft-preserved.png` })
  checks.push('post-detail pull refresh preserves the unsent comment text')
  await page.goto(`${base}/#/pages/spot/detail?id=${spotId}`)
  await page.getByRole('button', { name: '查看评论：刷新钓位' }).click()
  const sheet = page.getByRole('dialog', { name: '钓位评论', exact: true })
  await sheet.getByText(comment.body, { exact: true }).waitFor()
  const composer = sheet.locator('.spot-discussion__composer textarea')
  await composer.fill('刷新仍保留的弹层草稿'); await composer.blur(); await pause(400)
  const beforeComments = count('comments'), body = await sheet.locator('.mobile-sheet__body').boundingBox()
  assert.ok(body && body.height > 80)
  holdComments = true
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 8, y: body.y + 20 }] })
  for (const offset of [45, 70, 95, 125, 155]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 8, y: body.y + offset }] }); await pause(30)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await until(() => count('comments') > beforeComments)
  await sheet.locator('.uni-scroll-view-refresh__spinner').waitFor()
  assert.equal(await sheet.getByText('正在加载更多评论…', { exact: true }).count(), 0, 'pull refresh uses only its native spinner')
  await page.screenshot({ path: `${output}/comment-sheet-pulling.png` })
  releaseComments(); holdComments = false
  await sheet.locator('.uni-scroll-view-refresh__spinner').waitFor({ state: 'detached' })
  assert.equal(await composer.inputValue(), '刷新仍保留的弹层草稿')
  checks.push('comment sheet touch pull displays its own refresh spinner, reloads comments and preserves the draft')
  assert.deepEqual(errors, []); assert.deepEqual(escaped, [])
  await writeFile(`${output}/result.json`, JSON.stringify({ checks, errors, escaped, boundary: 'Actual H5 page pull gestures with isolated HTTP responses. No physical-phone or hosted data-write claim.' }, null, 2))
  console.log(JSON.stringify({ passed: true, checks }, null, 2))
} catch (error) {
  release?.(); releaseComments?.(); await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {})
  const runtime = await page.evaluate(() => ({ route: location.hash, refresh: [...document.querySelectorAll('uni-page-refresh')].map(node => node.className), pages: typeof getCurrentPages === 'function' ? getCurrentPages().map(page => ({ route: page.route, hook: !!page.$vm?.$?.type?.__name })) : [] })).catch(() => ({}))
  console.error({ error: error.message, errors, escaped, runtime, calls: calls.slice(-10) }); throw error
}
finally { await context.close(); await browser.close() }
