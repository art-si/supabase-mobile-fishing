// Isolated API/session contract: no actual login, SMS or hosted writes.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { setH5TextScale } from './h5-text-scale.mjs'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
const output = 'artifacts/post-republish'
await mkdir(output, { recursive: true })
const owner = '11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
const author = { id: owner, nickname: '验收钓友', city: '', bio: '', method: '', handle: 'DY000000000001' }
const legacyTrip = { id: '33333333-3333-4333-8333-333333333333', title: '保留的私人出钓日志', body: '旧记录不迁移也不公开。', species: '鲫鱼', method: '台钓', bait: '蚯蚓', count: 0, weight_kg: null, occurred_on: '2026-11-18', created_at: '2026-11-18T08:00:00Z', media: [] }
let post = { id, author, title: '', body: '记录今天的水草边钓法。', kind: 'experience', species: '', method: '', bait: '', topic: '钓法技巧', weight_kg: null, count: null, length_cm: null, occurred_on: '2026-11-20', occurred_at: null, location_label: '江苏省苏州市 · 验收地点', location_longitude: 120.62, location_latitude: 31.32, audience: 'public', status: 'pending', created_at: new Date().toISOString(), like_count: 0, comment_count: 0, liked: false, saved: false, media: [], review_revision: 1 }
const writes = [], checks = [], errors = [], escaped = []
const pass = (s) => { checks.push(s); console.log('PASS', s) }
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' })
await context.addInitScript(({ owner }) => {
  localStorage.setItem('dyj.auth.v1', JSON.stringify({ type: 'object', data: { access_token: 'isolated-edit', refresh_token: 'fixture', expires_at: Date.now() / 1000 + 3600, user: { id: owner } } }))
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'denied' }) } })
}, { owner })
await context.routeWebSocket(/supabase\.co/, socket => socket.close())
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url())
  if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
  if (url.origin !== 'https://tlfmfokyhahlpzmpliad.supabase.co') { escaped.push(url.origin); return route.abort() }
  const reply = (json, status = 200) => route.fulfill({ status, json, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
  if (request.method() === 'OPTIONS') return reply({})
  if (url.pathname === '/auth/v1/user') return reply({ id: owner })
  const data = request.postDataJSON() || {}, p = data.payload || {}
  if (url.pathname.endsWith('fishing_read')) {
    if (data.action === 'profile') return reply({ profile: author, posts: [] })
    if (data.action === 'library') return reply({ posts: p.type === 'posts' ? [post] : [], trips: p.type === 'trips' ? [legacyTrip] : [], spots: [] })
    if (data.action === 'edit_content') return reply({ item: post, revision: post.review_revision, publication: { status: post.status, audience: post.audience } })
    if (data.action === 'post') return reply({ post, comments: [], comments_next: null })
    return reply({ items: [], next: null })
  }
  if (url.pathname.endsWith('fishing_write')) {
    writes.push(data)
    assert.equal(data.action, 'update_content')
    if (writes.length === 1) return reply({ message: 'STORAGE_UNAVAILABLE' }, 503)
    post = { ...post, ...p, weight_kg: null, status: 'published', review_revision: 2, content_update: null }
    return reply({ id, revision: 2, status: 'published' })
  }
  if (url.pathname.endsWith('fishing_moderation')) return reply({ allowed: false })
  return reply([])
})
const page = await context.newPage()
page.setDefaultTimeout(15000)
page.on('pageerror', e => errors.push(e.message))
try {
  await page.goto(`${base}/#/pages/home/index?tab=mine`)
  await page.getByRole('button', { name: '我的记录', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '记一次出钓', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '我的出钓日志', exact: true }).count(), 0)
  await page.screenshot({ path: `${output}/mine-375.png`, fullPage: true })
  await page.getByRole('button', { name: '记录鱼情', exact: true }).click()
  await page.getByRole('button', { name: '晒渔获', exact: true }).waitFor()
  assert.ok(!page.url().includes('mode=trip'))
  pass('one visible record entry opens the shared composer; the duplicate new-trip entry is removed')
  await page.goto(`${base}/#/pages/mine/library?type=posts`)
  const edit = page.getByRole('button', { name: '编辑发布', exact: true })
  await edit.waitFor()
  await page.getByText(legacyTrip.title, { exact: true }).waitFor()
  pass('the unified record list retains existing private logs alongside fish posts')
  assert.equal(await page.getByText(/待审核|修改待审核|城市未填写/).count(), 0)
  for (const [name, width, height, dark, scale] of [['375', 375, 812, false, 16], ['320', 320, 740, false, 16], ['440', 440, 956, false, 16], ['landscape', 844, 390, false, 16], ['wide', 1280, 900, false, 16], ['dark-large', 320, 812, true, 24]]) {
    await page.setViewportSize({ width, height }); await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' }); await setH5TextScale(page, scale)
    const a = await edit.boundingBox(), b = await page.getByRole('button', { name: '删除', exact: true }).boundingBox()
    const sameRow = Math.abs(a.y - b.y) <= 1
    assert.ok(Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1, 'management buttons have equal control boxes')
    assert.ok(sameRow || (Math.abs(a.x - b.x) <= 1 && b.y >= a.y + a.height + 7), 'narrow or large-text layouts stack aligned controls with a clear gap')
    assert.ok(a.height >= 48 && b.height >= 48)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: `${output}/list-${name}.png`, fullPage: true })
  }
  pass('author list has visible edit/delete actions with aligned 48px touch areas across six viewport/text modes; no approval badges')
  await page.setViewportSize({ width: 375, height: 812 }); await page.emulateMedia({ colorScheme: 'light' }); await setH5TextScale(page, 16)
  await edit.click()
  await page.waitForURL(/compose.*edit=/)
  const body = page.locator('textarea[aria-label="分享你的心得"]')
  await body.waitFor()
  assert.equal(await body.inputValue(), post.body)
  await body.fill('修改后重新发布，保留原记录与互动。')
  const submit = page.getByRole('button', { name: '保存并重新发布', exact: true })
  assert.equal(await page.getByText(/审核/).count(), 0)
  await page.screenshot({ path: `${output}/edit-375.png`, fullPage: true })
  await submit.click()
  await page.getByRole('alert').filter({ hasText: /暂|失败|重试/ }).first().waitFor()
  assert.equal(await body.inputValue(), '修改后重新发布，保留原记录与互动。')
  await submit.click()
  await page.waitForURL(/post\/detail/)
  await page.getByText('修改后重新发布，保留原记录与互动。', { exact: true }).waitFor()
  assert.equal(writes.length, 2)
  assert.equal(writes[0].payload.id, id)
  assert.equal(writes[0].payload.revision, 1)
  assert.equal(writes[0].payload.request_id, writes[1].payload.request_id)
  assert.ok(!('status' in writes[0].payload) && !('author' in writes[0].payload))
  assert.equal(await page.getByText(/审核/).count(), 0)
  await page.screenshot({ path: `${output}/republished-375.png`, fullPage: true })
  pass('editing loads the original, preserves failed changes, retries with one command identity and returns to the same published record')
  await page.getByRole('button', { name: '编辑这条鱼情', exact: true }).waitFor()
  pass('the detail page retains a direct author edit action')
  assert.deepEqual(escaped, []); assert.deepEqual(errors, [])
  await writeFile(`${output}/result.json`, JSON.stringify({ checks, errors, boundary: 'Local API/session fixture; actual database direct-publish rules tested separately.' }, null, 2))
} catch (e) { await page.screenshot({ path: `${output}/failure.png`, fullPage: true }); throw e }
finally { await context.close(); await browser.close() }
