// Exercise the shared sheet through the spot form, with desktop-style scrollbars enabled.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { setH5TextScale } from './h5-text-scale.mjs'

const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
const output = 'artifacts/sheet-scroll'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  channel: 'chrome', ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--disable-features=OverlayScrollbar']
})
const context = await browser.newContext({
  viewport: { width: 375, height: 812 }, locale: 'zh-CN', permissions: ['geolocation'],
  geolocation: { longitude: 114.1859, latitude: 30.5189, accuracy: 12 }
})
const owner = '11111111-1111-4111-8111-111111111111'
const spot = { id: '22222222-2222-4222-8222-222222222222', name: '弹层验收钓位', city: '武汉市',
  status: 'published', audience: 'public', precision: 'hidden', water_type: '自然水域', author: { id: owner, nickname: '钓友' } }
const comments = Array.from({ length: 18 }, (_, i) => ({ id: String(i + 1), body: '评论 ' + (i + 1),
  created_at: new Date().toISOString(), author: spot.author, own: i === 17 }))
await context.addInitScript(owner => {
  localStorage.setItem('dyj.auth.v1', JSON.stringify({ type: 'object', data: {
    access_token: 'isolated-scroll-test', refresh_token: 'fixture', expires_at: Date.now() / 1000 + 3600, user: { id: owner }
  } }))
}, owner)
await context.routeWebSocket(/supabase\.co/, socket => socket.close())
await context.route('https://*.supabase.co/**', route => {
  const path = new URL(route.request().url()).pathname
  if (path.includes('/amap-js/')) return route.continue()
  if (route.request().method() === 'POST') {
    const { action } = route.request().postDataJSON() || {}
    if (path.endsWith('/fishing_read') && action === 'spot') return route.fulfill({ json: spot })
    if (path.endsWith('/fishing_spot_community')) {
      const summary = { target: 'spot:' + spot.id, comments: comments.length, likes: 0, liked: false, saved: false, status: '' }
      if (action === 'comments') return route.fulfill({ json: { items: comments, summary, next: null } })
      return route.fulfill({ json: [summary] })
    }
  }
  return route.fulfill({ json: path === '/auth/v1/user' ? { id: owner } : { items: [] } })
})
const page = await context.newPage()
page.setDefaultTimeout(15000)
try {
  await page.goto(base + '/#/pages/spot/create')
  const trigger = page.locator('#water-type')
  const sheet = page.getByRole('dialog', { name: '水域类型', exact: true })
  for (const [label, width, height, dark, textSize] of [
    ['375', 375, 812, false, 16], ['320', 320, 680, false, 16], ['440', 440, 956, false, 16],
    ['landscape', 844, 390, false, 16], ['wide', 1100, 780, false, 16], ['dark-large', 375, 740, true, 24]
  ]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
    await setH5TextScale(page, textSize)
    await trigger.focus()
    await page.evaluate(() => {
      const samples = window.sheetFrames = []
      const sample = () => {
        const anchor = document.querySelector('#water-type').getBoundingClientRect()
        const dialog = [...document.querySelectorAll('.mobile-sheet-frame')].find(el => el.getClientRects().length)
        const body = dialog?.querySelector('.mobile-sheet__body .uni-scroll-view-scrollbar-hidden')
        samples.push({
          x: anchor.x, width: anchor.width, frame: dialog?.getBoundingClientRect().width,
          gutter: body ? body.offsetWidth - body.clientWidth : null,
          style: body ? getComputedStyle(body).scrollbarWidth : null,
          bodyWidth: body?.clientWidth, locked: document.body.style.overflow === 'hidden'
        })
        window.sheetSampling = requestAnimationFrame(sample)
      }
      sample()
    })
    await trigger.press('Enter')
    await sheet.waitFor()
    await sheet.getByText('水库', { exact: true }).waitFor()
    await page.waitForTimeout(340)
    await page.screenshot({ path: output + '/' + label + '.png' })
    await page.keyboard.press('Escape')
    await sheet.waitFor({ state: 'hidden' })
    await page.waitForTimeout(250)
    const frames = await page.evaluate(() => { cancelAnimationFrame(window.sheetSampling); return window.sheetFrames })
    const visible = frames.filter(f => f.gutter !== null)
    assert.ok(visible.length > 2)
    for (const f of frames) {
      assert.ok(Math.abs(f.x - frames[0].x) < 1 && Math.abs(f.width - frames[0].width) < 1, label + ': background moved')
    }
    assert.ok(visible.every(f => f.gutter === 0 && f.style === 'none' && f.locked), label + ': transient scrollbar or early unlock')
    assert.equal(new Set(visible.map(f => f.bodyWidth)).size, 1, label + ': list width changed')
    assert.ok(await trigger.evaluate(el => el.contains(document.activeElement)))
    console.log('PASS', label, visible.length, 'visible frames, zero scrollbar width or horizontal shift')
  }
  await page.setViewportSize({ width: 375, height: 740 })
  await setH5TextScale(page, 16)
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto(base + '/#/pages/spot/detail?id=' + spot.id)
  const commentTrigger = page.getByRole('button', { name: '查看评论：' + spot.name })
  await commentTrigger.click()
  const discussion = page.getByRole('dialog', { name: '钓位评论', exact: true })
  const scroller = discussion.locator('.mobile-sheet__body .uni-scroll-view-scrollbar-hidden')
  await discussion.getByText('评论 18', { exact: true }).waitFor({ state: 'attached' })
  await page.waitForTimeout(350)
  assert.ok(await scroller.evaluate(el => el.scrollHeight > el.clientHeight + 300), 'long comment list must overflow')
  await scroller.hover()
  await page.mouse.wheel(0, 480)
  await page.waitForFunction(() => [...document.querySelectorAll('.mobile-sheet__body .uni-scroll-view')].some(el => el.scrollTop > 200))
  await discussion.getByRole('button', { name: '删除自己的评论' }).click()
  const confirm = page.getByRole('alertdialog', { name: '删除这条评论？' })
  await confirm.waitFor()
  await page.waitForTimeout(280)
  await page.screenshot({ path: output + '/nested-confirm.png' })
  await confirm.getByRole('button', { name: '取消' }).click()
  await confirm.waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden')
  assert.ok(await scroller.evaluate(el => el.scrollTop > 200))
  await discussion.getByRole('button', { name: '关闭钓位评论' }).click()
  await discussion.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.body.style.overflow !== 'hidden' && document.body.style.paddingInlineEnd === '')
  console.log('PASS long comments scroll with the wheel and retain their position and page lock after a nested confirmation')
} finally {
  await browser.close()
}
