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
const visualOnly = process.argv.includes('--visual-audit-only')
const output = resolve(visualOnly ? 'artifacts/visual-optimization' : 'artifacts/h5')
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL === 'bundled'
    ? {}
    : { channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
})
const useLocationFixture = ['author', 'map', 'moderation', 'session', 'water-report']
  .some((name) => process.argv.includes(`--${name}-contract`))
const context = await browser.newContext({
  viewport: { width: 375, height: 812 },
  locale: 'zh-CN',
  reducedMotion: 'reduce',
  ...(useLocationFixture
    ? { permissions: ['geolocation'], geolocation: { longitude: 120.12, latitude: 31.12 } }
    : {})
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
  if (visualOnly) {
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === base ? route.continue() : route.abort()
    )
    await go('/pages/login/index')
    await page.getByRole('button', { name: '进入本机体验', exact: true }).click()
    await page.waitForURL((url) => url.hash === '#/' || url.hash.startsWith('#/pages/home'))
    await visualAudit({ page, go, visible, pass, overflow, screenshot })
    assert.deepEqual(errors, [], 'No uncaught visual regression errors')
    assert.deepEqual(remoteRequests, [], 'Local visual checks do not contact hosted services')
  } else if (process.argv.includes('--alignment-contract')) {
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
    const libraryGuest = await context.newPage()
    try {
      await libraryGuest.route('**/*', (route) => {
        const url = new URL(route.request().url())
        if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
        remoteRequests.push(url.origin + url.pathname)
        return route.abort()
      })
      libraryGuest.on('pageerror', (error) => errors.push(error.message))
      await libraryGuest.goto(`${base}/#/pages/mine/library?type=saved`)
      await libraryGuest.getByText('登录后查看个人记录', { exact: true }).waitFor()
      assert.equal(await libraryGuest.getByRole('button', { name: '重试', exact: true }).count(), 0)
      await libraryGuest.evaluate(() => document.fonts.ready)
      await libraryGuest.screenshot({ path: resolve(output, 'library-guest-375.png') })
      await libraryGuest.getByRole('button', { name: '登录', exact: true }).click()
      await libraryGuest.getByRole('heading', { name: '本机体验', exact: true }).waitFor()
    } finally {
      await libraryGuest.close()
    }
    pass('private library gives guests a working login action')
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
    await fill('出钓记录', '观察水情，带走垃圾。只保存在我的私人日志。')
    assert.equal(
      await page.locator('#catch-details').count(),
      0,
      'optional catch fields start collapsed'
    )
    await page.getByRole('button', { name: '渔获与钓法', exact: true }).click()
    await fill('渔获 1 尾数', '0')
    await fill('渔获 1 重量（kg）', '0')
    for (const [trigger, title, opt] of [
      ['渔获 1 鱼种', '选择鱼种', '鲫鱼'],
      ['选择饵料', '选择饵料', '蚯蚓']
    ]) {
      await page.getByRole('button', { name: trigger, exact: true }).click()
      const dialog = page.getByRole('dialog', { name: title, exact: true })
      await dialog.getByRole('checkbox', { name: opt, exact: true }).click()
      await dialog.getByRole('button', { name: /^确定/ }).click()
    }
    const sourceDate = await page.evaluate(() => {
      const today = new Date()
      const date = new Date(today.getFullYear(), today.getMonth() - 1, 10)
      const mm = String(date.getMonth() + 1).padStart(2, '0')
      return {
        button: `${date.getFullYear()}年${date.getMonth() + 1}月10日`,
        value: `${date.getFullYear()}-${mm}-10`
      }
    })
    const dateTrigger = page.getByRole('button', { name: '选择出钓日期', exact: true })
    await dateTrigger.click()
    const calendar = page.getByRole('dialog', { name: '选择出钓日期', exact: true })
    await calendar.getByRole('button', { name: '上个月', exact: true }).click()
    await calendar.getByRole('button', { name: sourceDate.button, exact: true }).click()
    await calendar.getByRole('button', { name: '确定', exact: true }).click()
    assert.equal(await dateTrigger.getAttribute('aria-description'), sourceDate.value)
    await page.getByRole('button', { name: '保存私人日志', exact: true }).click()
    await visible('空军也值得记下')
    await visible('0 尾（空军） · 0 kg')
    pass('private trip validates required fields and preserves zero catch')
    await draftContract({ page, go, fill, visible, pass, screenshot, overflow, sourceDate: sourceDate.value })

    await go('/pages/post/compose')
    await fill('标题', '一份只留给自己的鱼情')
    await fill('今天的渔获', '测试分享选项，正文不会附带坐标。')
    const audience = page.getByRole('button', { name: '分享范围', exact: true })
    assert.equal(await audience.getAttribute('aria-description'), '当前选项：公开')
    await audience.click()
    await page.getByRole('dialog', { name: '分享范围' })
      .getByRole('button', { name: '仅自己', exact: true }).click()
    await page.reload()
    await visible('已恢复这台设备上的草稿。')
    assert.equal(
      await page.getByRole('textbox', { name: '标题', exact: true }).inputValue(),
      '一份只留给自己的鱼情'
    )
    assert.equal(await audience.getAttribute('aria-description'), '当前选项：仅自己')
    await page.getByRole('button', { name: '保存并发布', exact: true }).click()
    await visible('选择所在位置后再发布')
    pass('draft keeps the explicit privacy choice and blocks publishing without a location')

    await go('/pages/spot/create')
    await fill('钓位名称（选填）', '我的私人练习水域')
    await page.getByRole('button', { name: '保存钓位', exact: true }).click()
    await page.getByText('请先确认实际钓位位置和所在城市，再保存。', { exact: true }).last().waitFor()
    assert.equal(await page.locator('input[aria-label="钓位名称（选填）"]').inputValue(), '我的私人练习水域')
    pass('spot editor requires a verified location and keeps text when validation fails')
    await go('/pages/map/index')
    await visible('本机体验不加载在线地图')
    await page.getByRole('button', { name: '浏览示例钓位', exact: true }).click()
    await visible('芦苇湾 · 示例水域')
    pass('demo refuses real AMap calls even when local live credentials are configured')

    await go('/pages/home/index')
    for (const [label, expected] of [
      ['找钓位', '芦苇湾 · 示例水域'],
      ['举报', '发布上报'],
      ['我的', '钓友100001'],
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
    for (const [path, notice] of [
      ['security', '体验记录仅保存于这台设备。账号安全设置在正式环境中使用。'],
      ['password', '本机体验无需登录密码。正式账号可通过短信验证设置或找回密码。'],
      ['phone', '体验账号无需绑定手机号。手机号换绑在正式账号内完成。']
    ]) {
      await go(`/pages/account/${path}`)
      await visible(notice)
      assert.equal(await page.locator('input,.account-content [role="alert"]').count(), 0)
      assert.equal(await page.getByRole('button', { name: '重新读取', exact: true }).count(), 0)
      await screenshot(`account-${path}-demo-dark-320.png`)
    }
    pass('demo account screens explain availability without exposing unsupported controls')
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
