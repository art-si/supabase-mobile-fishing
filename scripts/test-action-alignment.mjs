// Isolated data and sessions. No real contact, hosted writes, GPS or authentication.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { setH5TextScale } from './h5-text-scale.mjs'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
const output = 'artifacts/action-alignment'
await mkdir(output, { recursive: true })
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222'
const author = { id: owner, nickname: '对齐验收', city: '苏州市', bio: '隔离界面样例', method: '台钓', handle: '' }
const friend = { ...author, id: other, nickname: '附近的钓友' }
const post = { id: '33333333-3333-4333-8333-333333333333', author, title: '水草边的收获', body: '只用于检查布局与操作对齐。', kind: 'catch', species: '鲫鱼', method: '台钓', bait: '蚯蚓', audience: 'public', status: 'published', created_at: new Date().toISOString(), media: [], review_revision: 1, like_count: 0, comment_count: 0 }
const trip = { id: '44444444-4444-4444-8444-444444444444', title: '以前的私人日志', body: '保留原来的记录', occurred_on: '2026-11-19', media: [], catches: [], count: 0, weight_kg: null, species: '鲫鱼', method: '台钓', bait: '蚯蚓' }
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' })
const errors = [], escaped = [], checks = []
await context.addInitScript(({ owner }) => {
  localStorage.setItem('dyj.auth.v1', JSON.stringify({ type: 'object', data: { access_token: 'isolated-alignment', refresh_token: 'fixture', expires_at: Date.now() / 1000 + 3600, user: { id: owner } } }))
}, { owner })
await context.routeWebSocket(/supabase\.co/, socket => socket.close())
await context.route('**/*', route => {
  const req = route.request(), url = new URL(req.url())
  if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
  const reply = json => route.fulfill({ json, headers })
  if (url.origin !== 'https://jupuypvmgjpnpntfetqv.supabase.co') { escaped.push(url.origin); return route.abort() }
  if (req.method() === 'OPTIONS') return reply({})
  if (url.pathname === '/auth/v1/user') return reply({ id: owner })
  if (url.pathname.endsWith('fishing_moderation')) return reply({ allowed: false })
  if (url.pathname.endsWith('fishing_read')) {
    const { action, payload = {} } = req.postDataJSON()
    if (action === 'profile') return reply({ profile: payload.id === other ? friend : author, posts: [], following: false, friends: false, blocked: false })
    if (action === 'library') return reply({ posts: payload.type === 'posts' ? [post] : [], trips: payload.type === 'trips' ? [trip] : [], spots: [] })
    if (action === 'post') return reply({ post, comments: [], comments_next: null })
    if (action === 'people') return reply([friend])
    if (action === 'social') return reply({ friends: [], conversations: [], requests: [{ id: other, sender: friend, recipient: author, status: 'pending', note: '一起交流钓法', created_at: new Date().toISOString() }] })
    return reply({ items: [], next: null })
  }
  if (url.pathname.includes('/rest/v1/')) return reply([])
  escaped.push(`${req.method()} ${url.pathname}`); return route.abort()
})
const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))
page.setDefaultTimeout(20000)
try {
  for (const [name, path] of [['library', '/pages/mine/library?type=posts'], ['person', `/pages/people/detail?id=${other}`], ['requests', '/pages/people/index?tab=requests'], ['owner-detail', `/pages/post/detail?id=${post.id}`]]) {
    await page.goto(`${base}/#${path}`, { waitUntil: 'domcontentloaded' })
    await page.locator('.mobile-action-group').first().waitFor()
    for (const [mode, width, height, dark, scale] of [['375',375,812,false,16],['320',320,740,false,16],['440',440,956,false,16],['landscape',844,390,false,16],['wide',1280,900,false,16],['dark-large',320,812,true,24]]) {
      await page.setViewportSize({ width, height }); await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' }); await setH5TextScale(page, scale)
      await page.evaluate(() => document.fonts.ready)
      const groups = await page.locator('.mobile-action-group').evaluateAll(nodes => nodes.map(node => [...node.querySelectorAll('.mobile-action')].filter(button => button.getBoundingClientRect().height).map(button => {
        const rect = button.getBoundingClientRect(), style = getComputedStyle(button)
        const range = document.createRange(); range.selectNodeContents(button)
        const label = range.getBoundingClientRect()
        return { text: button.textContent, x: rect.x, y: rect.y, w: rect.width, h: rect.height, font: style.fontSize, center: Math.abs((label.top + label.bottom) / 2 - (rect.top + rect.bottom) / 2), overflow: button.scrollWidth > button.clientWidth + 1 }
      })))
      assert.ok(groups.some(group => group.length >= 2), `${name}: real action pair exists`)
      for (const group of groups) for (const button of group) {
        assert.ok(button.w >= 48 && button.h >= 48, `${name}/${mode}: touch target ${button.text}`)
        assert.ok(!button.overflow, `${name}/${mode}: label fits ${button.text}`)
        assert.ok(button.center < 3, `${name}/${mode}: label centered ${button.text}: ${button.center}`)
        for (const sibling of group.filter(sibling => Math.abs(sibling.y - button.y) < 2)) {
          assert.ok(Math.abs(sibling.h - button.h) < 2, `${name}/${mode}: same row height`)
          assert.ok(Math.abs(sibling.w - button.w) < 2, `${name}/${mode}: same column width`)
          assert.equal(sibling.font, button.font, `${name}/${mode}: same type size`)
        }
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}/${mode}: page fits`)
      await page.locator('.mobile-action-group .mobile-action').first().focus()
      assert.ok(await page.locator('.mobile-action-group .mobile-action').first().evaluate(node => getComputedStyle(node).outlineStyle !== 'none'))
      await page.screenshot({ path: `${output}/${name}-${mode}.png`, fullPage: true })
      checks.push(`${name}-${mode}: aligned boxes, centered text, equal type, visible focus, no overflow`)
    }
  }
  assert.deepEqual(errors, []); assert.deepEqual(escaped, [])
  await writeFile(`${output}/result.json`, JSON.stringify({ checks, errors, escaped }, null, 2))
  console.log(`PASS ${checks.length} real-page alignment checks`)
} finally { await browser.close() }
