import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
import { chromium } from 'playwright'
import { mapContract } from './map-contract.mjs'
import { appearanceContract } from './appearance-contract.mjs'
import { visualAudit } from './visual-audit.mjs'
import { moderationContract } from './moderation-contract.mjs'
import { draftContract } from './draft-contract.mjs'
import { confirmationContract } from './confirmation-contract.mjs'
import { sessionContract } from './session-contract.mjs'
import { authorContract } from './author-contract.mjs'
import { waterReportContract } from './water-report-contract.mjs'
import { packageRoutesContract } from './package-routes-contract.mjs'
import { miniappAlignmentContract } from './miniapp-alignment-contract.mjs'

// Tests the compiled output, not the development server. A successful build must boot.
const unconfiguredLive = process.argv.includes('--unconfigured-live')
const root = resolve(
  process.env.H5_BUILD_DIR || (unconfiguredLive ? 'dist/build/h5' : 'dist/demo/h5')
)
assert.ok(existsSync(resolve(root, 'index.html')), 'Run pnpm build:demo first')
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
}
const server = createServer((req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const path = resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`)
    if (!path.startsWith(`${root}${sep}`)) throw new Error('outside root')
    res.writeHead(200, {
      'Content-Type': mime[extname(path)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    })
    res.end(readFileSync(path))
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const output = resolve('artifacts/h5')
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL === 'bundled'
    ? {}
    : { channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
})
const context = await browser.newContext({
  viewport: { width: 375, height: 812 },
  locale: 'zh-CN',
  reducedMotion: 'reduce'
})
const page = await context.newPage()
const errors = [],
  remoteRequests = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('request', (request) => {
  const url = new URL(request.url())
  if (url.hostname.endsWith('.supabase.co') || /(^|\.)amap\.com$/.test(url.hostname))
    remoteRequests.push(`${url.origin}${url.pathname}`)
})
page.setDefaultTimeout(15000)
let checks = 0
function pass(label) {
  checks++
  console.log(`PASS ${label}`)
}
async function visible(text) {
  await page.getByText(text, { exact: true }).last().waitFor({ state: 'visible' })
}
async function go(route) {
  await page.goto(`${base}/#${route}`)
  await page.locator('.fishing-page').waitFor()
}
async function overflow(label) {
  const dimensions = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth
  }))
  assert.ok(
    dimensions.scroll <= dimensions.width + 1,
    `${label}: horizontal overflow ${JSON.stringify(dimensions)}`
  )
  pass(`${label}: no horizontal overflow`)
}
async function fill(label, value) {
  await page.locator(`input[aria-label="${label}"], textarea[aria-label="${label}"]`).fill(value)
}
async function screenshot(name, fullPage = true) {
  await page.waitForFunction(() => !document.querySelector('.mobile-action--pressed'))
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await page.screenshot({ path: resolve(output, name), fullPage })
}
try {
  if (process.argv.includes('--alignment-contract')) {
    await miniappAlignmentContract({ page, go, screenshot, pass })
    assert.deepEqual(errors, [], 'No uncaught alignment regression errors')
    assert.deepEqual(remoteRequests, [], 'Local alignment checks do not contact hosted services')
  } else if (process.argv.includes('--water-report-contract')) {
    await waterReportContract({
      page,
      context,
      base,
      go,
      fill,
      visible,
      pass,
      overflow,
      screenshot
    })
    assert.deepEqual(errors, [], 'No uncaught water-report workflow errors')
  } else if (process.argv.includes('--author-contract')) {
    await authorContract({ page, context, base, go, fill, visible, pass, overflow, screenshot })
    assert.deepEqual(errors, [], 'No uncaught author workflow errors')
  } else if (process.argv.includes('--session-contract')) {
    await sessionContract({ page, context, base, go, fill, visible, pass, overflow, screenshot })
    assert.deepEqual(errors, [], 'No uncaught account isolation errors')
  } else if (process.argv.includes('--moderation-contract')) {
    await moderationContract({ page, context, base, go, fill, visible, pass, overflow, screenshot })
    assert.deepEqual(errors, [], 'No uncaught review workflow errors')
  } else if (process.argv.includes('--map-contract')) {
    await mapContract({ page, context, base, go, fill, visible, pass, overflow, screenshot })
    assert.deepEqual(errors, [], 'No uncaught map workflow errors')
  } else if (unconfiguredLive) {
    await go('/pages/home/index')
    await visible('服务暂时不可用，请稍后重试')
    assert.equal(
      await page
        .getByRole('button', { name: '阅读全文：秋天的鲫鱼，藏在这片芦苇边', exact: true })
        .count(),
      0
    )
    await go('/pages/login/index')
    assert.equal(await page.getByRole('button', { name: '进入本机体验', exact: true }).count(), 0)
    await page.getByRole('heading', { name: '登录暂未开放', exact: true }).waitFor()
    assert.equal(await page.locator('input, textarea, [role="checkbox"]').count(), 0)
    assert.equal(await page.getByRole('button', { name: '获取验证码', exact: true }).count(), 0)
    assert.equal(
      await page.getByRole('button', { name: '先逛逛', exact: true }).isDisabled(),
      false
    )
    await screenshot('unconfigured-live-login.png')
    assert.deepEqual(errors, [])
    assert.deepEqual(remoteRequests, [])
    pass('unconfigured production does not fall back to demo, fake login, or network writes')
  } else {
    await go('/pages/home/index')
    await page
      .getByRole('button', { name: '阅读全文：秋天的鲫鱼，藏在这片芦苇边', exact: true })
      .waitFor()
    await visible('本机体验 · 示例内容，不连接线上')
    pass('compiled H5 boots and explicitly identifies local demo data')
    await screenshot('home-375.png')
    await overflow('home 375')
    await page
      .getByRole('button', { name: '点赞：秋天的鲫鱼，藏在这片芦苇边', exact: true })
      .click()
    await page.getByRole('button', { name: '进入本机体验', exact: true }).click()
    await page
      .getByRole('button', { name: '取消点赞：秋天的鲫鱼，藏在这片芦苇边', exact: true })
      .waitFor()
    pass('guest action gates through login and resumes the requested like once')
    await page
      .getByRole('button', { name: '阅读全文：秋天的鲫鱼，藏在这片芦苇边', exact: true })
      .click()
    await fill('写一条评论', '水边测试：轻口时再耐心一点。')
    await page.getByRole('button', { name: '发表评论', exact: true }).click()
    await visible('水边测试：轻口时再耐心一点。')
    await page
      .getByRole('button', { name: '收藏：秋天的鲫鱼，藏在这片芦苇边', exact: true })
      .click()
    await page
      .getByRole('button', { name: '取消收藏：秋天的鲫鱼，藏在这片芦苇边', exact: true })
      .waitFor()
    pass('post detail comments and bookmarks persist')

    await go('/pages/post/compose?mode=trip')
    await page.getByRole('button', { name: '保存私人日志', exact: true }).click()
    await visible('给这次记录起个名字')
    await fill('标题', '空军也值得记下')
    await fill('鱼情与心得', '观察水情，带走垃圾。只保存在我的私人日志。')
    assert.equal(
      await page.locator('#catch-details').count(),
      0,
      'optional catch fields start collapsed'
    )
    await page.getByRole('button', { name: '渔获与钓法', exact: true }).click()
    await fill('渔获 1 尾数', '0')
    await fill('渔获 1 重量（kg）', '0')
    await fill('渔获 1 鱼种', '鲫鱼')
    await fill('饵料', '蚯蚓')
    await fill('出钓日期', '2020-03-10')
    await page.getByRole('button', { name: '保存私人日志', exact: true }).click()
    await visible('空军也值得记下')
    await visible('0 尾（空军） · 0 kg')
    pass('private trip validates required fields and preserves zero catch')
    await draftContract({ page, go, fill, visible, pass, screenshot, overflow })

    await go('/pages/post/compose')
    await fill('标题', '一份只留给自己的鱼情')
    await fill('鱼情与心得', '测试默认隐私设置，正文不会附带坐标。')
    await page.reload()
    await visible('已恢复这台设备上的草稿。')
    assert.equal(
      await page.getByRole('textbox', { name: '标题', exact: true }).inputValue(),
      '一份只留给自己的鱼情'
    )
    await page.getByRole('button', { name: '保存并发布', exact: true }).click()
    await visible('一份只留给自己的鱼情')
    await visible('仅自己')
    pass('post draft survives reload and defaults to private')

    await go('/pages/home/index?tab=messages')
    await page.getByRole('button', { name: '与老陈的野钓日记聊天', exact: true }).click()
    await visible('这周准备去水边走走？可以先交流一下钓法。')
    await page.locator('textarea').fill('测试出钓交流，不发送给真实用户。')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await visible('已发送')
    await page.reload()
    await visible('测试出钓交流，不发送给真实用户。')
    const composer = await page.locator('.chat-composer').boundingBox()
    assert.ok(
      composer && composer.y + composer.height <= 812 + 1,
      `chat composer outside viewport: ${JSON.stringify(composer)}`
    )
    await screenshot('chat-375.png')
    pass('friend message sends, reload recovers history, composer remains in viewport')
    await page.setViewportSize({ width: 375, height: 450 })
    await page.waitForTimeout(150)
    const compactComposer = await page.locator('.chat-composer').boundingBox()
    assert.ok(
      compactComposer && compactComposer.y + compactComposer.height <= 451,
      'composer follows smaller viewport'
    )
    await page.setViewportSize({ width: 375, height: 812 })
    pass('chat composer follows a resized viewport (not a real-device keyboard test)')

    await go('/pages/people/detail?id=33333333-3333-4333-8333-333333333333')
    await page.getByRole('button', { name: '加好友', exact: true }).click()
    await fill('申请留言', '一起交流路亚钓法。')
    await page.getByRole('button', { name: '发送好友申请', exact: true }).click()
    await visible('申请已发送，等待对方同意。')
    pass('friend request opens accessible sheet and sends')

    await go('/pages/spot/create')
    await fill('钓位名称', '我的私人练习水域')
    await fill('所在城市', '苏州')
    await fill('水域与鱼情', '仅用于本机验证，不是真实开放钓位。')
    await page.getByRole('button', { name: '保存钓位', exact: true }).click()
    await visible('我的私人练习水域')
    assert.equal(await page.getByRole('button', { name: '用高德导航', exact: true }).count(), 0)
    pass('private spot can be recorded without coordinates and does not expose navigation')
    await go('/pages/map/index')
    await visible('地图暂不可用')
    await visible('体验模式不提供真实地点搜索和地图预览，可继续查看示例钓位')
    pass('demo refuses real AMap calls even when local live credentials are configured')

    await go('/pages/home/index')
    for (const [label, expected] of [
      ['找钓位', '收藏好钓位，下次接着钓。'],
      ['消息', '好友申请'],
      ['我的', '水边的钓友'],
      ['钓友圈', '秋天的鲫鱼，藏在这片芦苇边']
    ]) {
      await page.getByRole('link', { name: label, exact: true }).click()
      await visible(expected)
    }
    pass('all four main navigation tabs work')
    for (const width of [320, 600]) {
      await page.setViewportSize({ width, height: 812 })
      await overflow(`home ${width}`)
      await screenshot(`home-${width}.png`)
    }
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 375, height: 812 })
    await screenshot('home-dark-375.png')
    await go('/pages/post/compose')
    await page.setViewportSize({ width: 320, height: 812 })
    await overflow('compose 320')
    await screenshot('compose-dark-320.png')
    await appearanceContract({ page, go, visible, pass, overflow, screenshot })
    await confirmationContract({ page, go, visible, pass, screenshot })
    if (process.argv.includes('--visual-audit'))
      await visualAudit({ page, go, visible, pass, overflow, screenshot })
    if (process.argv.includes('--package-routes'))
      await packageRoutesContract({ page, go, overflow, pass, screenshot })
    assert.deepEqual(errors, [], 'No uncaught browser errors')
    assert.deepEqual(remoteRequests, [], 'Demo must never send data to hosted Supabase')
    pass('no uncaught browser errors or hosted Supabase requests')
  }
  console.log(`\n${checks} H5 checks passed. Screenshots: ${output}`)
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error('BROWSER ERRORS', errors)
  console.error((await page.locator('body').innerText()).slice(0, 2500))
  throw error
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
