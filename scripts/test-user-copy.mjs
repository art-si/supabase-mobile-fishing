import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
import { chromium } from 'playwright'

// Browser rendering and contract fixtures only. No real key, SMS or remote writes.
// The production environment files and existing builds are never changed.
const placeholderKey = 'sb_publishable_user_copy_fixture_only'
const fixtureOrigin = 'https://user-copy-fixture.invalid'
const fixtureUser = '22222222-2222-4222-8222-222222222222'
const buildDirectory = 'dist/test/user-copy'
const root = resolve(buildDirectory)
const output = resolve('artifacts/user-copy-review')
mkdirSync(output, { recursive: true })
if (!process.argv.includes('--skip-build')) {
  const env = {
    ...process.env,
    VITE_SUPABASE_URL: fixtureOrigin,
    VITE_SUPABASE_KEY: placeholderKey,
    VITE_PHONE_AUTH_ENABLED: 'false',
    VITE_AUTH_CAPTCHA_ENABLED: 'false',
    VITE_OPERATOR_PHONE_ENABLED: 'false',
    VITE_AMAP_KEY: '',
    VITE_AMAP_SERVICE_HOST: '',
    H5_BUILD_DIR: buildDirectory
  }
  const build = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'mobile-pro', 'uni', 'build', '-p', 'h5', '--mode', 'test-user-copy', '--outDir', buildDirectory],
    { stdio: 'inherit', shell: process.platform === 'win32', env }
  )
  if (build.status !== 0) process.exit(build.status ?? 1)
}

const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json'
}
const server = createServer((req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const filename = resolve(
      root,
      '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname)
    )
    if (!filename.startsWith(root + sep)) throw new Error('outside build root')
    const body = readFileSync(filename)
    res.writeHead(200, {
      'Content-Type': mime[extname(filename)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})
await new Promise((done) => server.listen(0, '0.0.0.0', done))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const results = [],
  screenshots = [],
  metrics = [],
  requestSummary = []
const tech =
  /Supabase|\bKey\b|\bSDK\b|\bSQL\b|代理|部署|接入状态|已接入|未接入|开发环境|项目编号|https?:\/\//i
const pages = [
  { name: 'settings', route: '/pages/settings/index', title: '设置与隐私' },
  { name: 'privacy', route: '/pages/settings/legal?type=privacy', title: '隐私说明' },
  { name: 'terms', route: '/pages/settings/legal?type=terms', title: '用户协议' },
  { name: 'contact', route: '/pages/contact/index', title: '联系与反馈' }
]
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'apikey, authorization, content-type, x-client-info'
}
async function setup({ signedIn = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    locale: 'zh-CN',
    permissions: ['geolocation'],
    geolocation: { longitude: 114.3, latitude: 30.6 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block'
  })
  const state = { requests: [], blocked: [], errors: [] }
  await context.routeWebSocket('**/*', (socket) => {
    state.blocked.push('websocket')
    socket.close()
  })
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url())
    if (url.origin === base) return route.continue()
    if (url.origin !== fixtureOrigin) {
      state.blocked.push(url.origin + url.pathname)
      return route.abort('blockedbyclient')
    }
    const json = (status, body) =>
      route.fulfill({
        status,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
    if (request.method() === 'OPTIONS') return json(200, {})
    assert.equal(
      request.headers().apikey,
      placeholderKey,
      'isolated placeholder key required (value redacted)'
    )
    state.requests.push({ method: request.method(), path: url.pathname })
    // This is the only expected request: a read-only capability check, locally fulfilled.
    if (
      url.pathname === '/rest/v1/rpc/fishing_moderation' &&
      request.postDataJSON()?.action === 'access'
    )
      return json(200, { allowed: false })
    state.blocked.push('unexpected fixture API: ' + url.pathname)
    return json(503, { message: 'fixture boundary rejects unexpected operations' })
  })
  if (signedIn)
    await context.addInitScript(
      ({ fixtureUser, base }) => {
        if (location.origin !== base) return
        localStorage.setItem(
          'dyj.auth.v1',
          JSON.stringify({
            type: 'object',
            data: {
              access_token: 'local-user-copy-access-fixture',
              refresh_token: 'local-user-copy-refresh-fixture',
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              user: { id: fixtureUser }
            }
          })
        )
        localStorage.setItem(
          `dyj.live.draft.${fixtureUser}.post`,
          JSON.stringify({ type: 'object', data: { title: '本地验收草稿' } })
        )
      },
      { fixtureUser, base }
    )
  const page = await context.newPage()
  if (!signedIn) await page.clock.install({ time: new Date('2026-11-21T12:00:00+08:00') })
  page.setDefaultTimeout(12000)
  page.on('pageerror', (error) => state.errors.push(error.message))
  return { context, page, state }
}
const current = (page) => page.locator('.fishing-page').last()
async function open(page, item) {
  // Each responsive specimen is a fresh deep-link load. Same-document hash-only
  // query changes do not recreate a Uni page or rerun its onLoad hook.
  await page.goto('about:blank')
  await page.goto(base + '/#' + item.route, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: item.title, exact: true }).waitFor()
}
async function textCheck(page, item) {
  const text = await current(page).innerText()
  assert.doesNotMatch(text, tech, item.name + ': technical content leaked')
  if (item.name === 'settings') {
    assert.doesNotMatch(text, /运行模式|服务地址|连接诊断|配置|服务状态/)
    assert.match(text, /联系与反馈/)
  }
  if (item.name === 'privacy') {
    assert.doesNotMatch(text, /数据保存与境外处理|第三方服务与数据处理|服务提供方说明/)
  }
  if (item.name === 'privacy' || item.name === 'terms') {
    assert.doesNotMatch(text, /运营者：|版本日期|869123771|复制微信号|复制QQ号/)
    assert.equal(await current(page).getByRole('heading', { name: '联系运营者' }).count(), 0)
  }
  if (item.name === 'contact') {
    assert.match(text, /微信：869123771/)
    assert.match(text, /QQ：869123771/)
    assert.match(text, /钓友集微信群/)
    assert.match(text, /个人微信/)
    assert.doesNotMatch(text, /版本日期|水域线索与官方渠道/)
  }
}
async function audit(page, name) {
  const value = await page.evaluate(() => {
    const surface = [...document.querySelectorAll('.fishing-page')].at(-1)
    const controls = [...surface.querySelectorAll('[role="button"]')].filter(
      (el) => el.getBoundingClientRect().width
    )
    return {
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      rootFont: getComputedStyle(document.documentElement).fontSize,
      bodyFont:
        surface.querySelector('.legal-section .body') &&
        getComputedStyle(surface.querySelector('.legal-section .body')).fontSize,
      controls: controls.map((el) => ({
        label: el.getAttribute('aria-label') || el.textContent.trim(),
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height
      }))
    }
  })
  metrics.push({ name, ...value })
  assert.ok(value.scrollWidth <= value.width + 1, name + ': horizontal overflow')
  for (const control of value.controls)
    assert.ok(
      control.width >= 43.9 && control.height >= 43.9,
      name + ': small target ' + JSON.stringify(control)
    )
  if (value.bodyFont) assert.ok(parseFloat(value.bodyFont) >= 16, name + ': legal body below 16px')
}
async function shot(page, name, fullPage = true) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.fish-mark img')].every(
      (img) => img.complete && img.naturalWidth
    )
  )
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  )
  const path = resolve(output, name + '.png')
  await page.screenshot({ path, fullPage })
  screenshots.push(path)
}
async function check(name, action, options) {
  const test = await setup(options)
  try {
    await action(test)
    assert.deepEqual(test.state.errors, [], 'uncaught browser errors')
    assert.deepEqual(test.state.blocked, [], 'unexpected external/API operations were blocked')
    assert.equal(
      test.state.requests.filter(
        (request) => request.path.startsWith('/auth/') || request.path.startsWith('/functions/')
      ).length,
      0,
      'must never request authentication, SMS or a remote mutation'
    )
    results.push({ name, status: 'PASS' })
    console.log('PASS ' + name)
  } catch (error) {
    results.push({ name, status: 'FAIL', error: String(error.stack || error) })
    console.error('FAIL ' + name + ': ' + error.message)
    await shot(test.page, 'failure-' + name).catch(() => {})
  } finally {
    requestSummary.push({ name, ...test.state })
    await test.context.close()
  }
}
try {
  await check('responsive-user-copy', async ({ page }) => {
    for (const item of pages) {
      await open(page, item)
      await textCheck(page, item)
      for (const [width, height] of [
        [320, 740],
        [375, 812],
        [440, 956],
        [844, 390],
        [1280, 900]
      ]) {
        await page.setViewportSize({ width, height })
        await page.waitForTimeout(150)
        await audit(page, `${item.name}-light-${width}`)
        await shot(page, `${item.name}-light-${width}`)
        if (item.name === 'privacy' && width === 375)
          await shot(page, 'privacy-light-375-viewport', false)
        if (width === 1280 && item.name !== 'settings') {
          const box = await current(page).locator('.fishing-content').boundingBox()
          assert.ok(box.width <= 761, 'wide legal content needs a readable maximum width')
        }
      }
      await page.setViewportSize({ width: 375, height: 812 })
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.waitForTimeout(150)
      await audit(page, `${item.name}-dark-375`)
      await shot(page, `${item.name}-dark-375`)
      await page.setViewportSize({ width: 320, height: 740 })
      await page.waitForTimeout(150)
      const style = await page.addStyleTag({ content: 'html { font-size: 32px !important; }' })
      await audit(page, `${item.name}-dark-large-320`)
      await shot(page, `${item.name}-dark-large-320`)
      if (item.name === 'privacy') await shot(page, 'privacy-dark-large-320-viewport', false)
      await style.evaluate((el) => el.remove())
      await page.emulateMedia({ colorScheme: 'light' })
    }
  })
  await check('navigation-contact-privacy-and-terms', async ({ page, context }) => {
    await context.grantPermissions(['geolocation', 'clipboard-read', 'clipboard-write'], { origin: base })
    await open(page, pages[0])
    const contact = page.getByRole('button', { name: '联系与反馈', exact: true })
    await contact.focus()
    const focus = await contact.evaluate((el) => ({
      active: document.activeElement === el,
      outline: getComputedStyle(el).outlineStyle,
      width: getComputedStyle(el).outlineWidth,
      rect: el.getBoundingClientRect().toJSON()
    }))
    assert.ok(
      focus.active && focus.outline !== 'none' && parseFloat(focus.width) >= 2,
      'visible keyboard focus required'
    )
    metrics.push({ name: 'contact-keyboard-focus', ...focus })
    await shot(page, 'settings-keyboard-focus')
    await page.keyboard.press('Space')
    await page.waitForURL('**/pages/contact/index')
    await textCheck(page, pages[3])
    for (const [label, file, width] of [
      ['钓友集微信群', 'wechat-group.png', 720],
      ['个人微信', 'wechat-personal.jpg', 1126]
    ]) {
      const action = page.getByRole('button', { name: `查看${label}二维码`, exact: true })
      await action.focus()
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog', { name: `预览${label}二维码`, exact: true })
      const image = dialog.locator('.mobile-image-viewer__loaded')
      await image.waitFor()
      assert.ok((await image.getAttribute('src')).endsWith(file))
      assert.equal(await image.evaluate(el => el.naturalWidth), width)
      await shot(page, file.split('.')[0] + '-preview', false)
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      assert.ok(await action.evaluate(el => el === document.activeElement))
    }
    for (const [label, feedback] of [
      ['复制运营者微信号', '微信号已复制'],
      ['复制运营者QQ号', 'QQ号已复制']
    ]) {
      await page.getByRole('button', { name: label, exact: true }).click()
      await current(page).getByText(feedback, { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '869123771')
    }
    await shot(page, 'contact-copy-feedback')
    await page.getByRole('button', { name: '返回上一页', exact: true }).last().click()
    await page.waitForURL('**/pages/settings/index')
    await page.getByRole('button', { name: '隐私说明', exact: true }).click()
    await page.waitForURL('**/pages/settings/legal?type=privacy')
    await textCheck(page, pages[1])
    await page.getByRole('button', { name: '返回上一页', exact: true }).last().click()
    await page.waitForURL('**/pages/settings/index')
    await page.getByRole('button', { name: '用户协议', exact: true }).click()
    await page.waitForURL('**/pages/settings/legal?type=terms')
    await textCheck(page, pages[2])
  })
  await check('old-contact-link-and-expired-group', async ({ page }) => {
    await page.clock.setSystemTime(new Date('2026-11-28T00:00:00+08:00'))
    await page.goto(base + '/#/pages/settings/legal?type=contact')
    await page.waitForURL('**/pages/contact/index')
    await page.getByText('群二维码已到期，可通过个人微信联系入群。').waitFor()
    assert.equal(await page.getByRole('button', { name: '查看钓友集微信群二维码' }).count(), 0)
    await page.getByRole('button', { name: '查看个人微信二维码' }).waitFor()
  })
  await check(
    'settings-navigation-and-delete-affordance',
    async ({ page }) => {
      await open(page, pages[0])
      for (const [width, height, large] of [
        [320, 740, false],
        [375, 812, false],
        [440, 956, false],
        [844, 390, false],
        [1280, 900, false],
        [320, 740, true]
      ]) {
        await page.setViewportSize({ width, height })
        await page.emulateMedia({ colorScheme: large ? 'dark' : 'light' })
        const style = large
          ? await page.addStyleTag({ content: 'html { font-size: 32px !important; }' })
          : null
        const value = await current(page).evaluate((surface) => {
          const rows = [...surface.querySelectorAll('.list-row')].map((el) => {
            const arrow = el.querySelector('.settings-link-arrow')
            const b = el.getBoundingClientRect(),
              a = arrow?.getBoundingClientRect()
            return {
              label: el.textContent.trim(),
              height: b.height,
              arrow: !!arrow,
              right: a ? b.right - a.right : null,
              centered: a ? Math.abs(a.y + a.height / 2 - b.y - b.height / 2) : null
            }
          })
          const el = surface.querySelector('.settings-delete')
          const range = document.createRange()
          range.selectNodeContents(el)
          const b = el.getBoundingClientRect(),
            t = range.getBoundingClientRect()
          const color = getComputedStyle(el).color
          const probe = document.createElement('span')
          probe.style.color = 'var(--danger)'
          el.appendChild(probe)
          const danger = getComputedStyle(probe).color
          probe.remove()
          return {
            rows,
            deletion: {
              color,
              danger,
              height: b.height,
              offset: t.x + t.width / 2 - b.x - b.width / 2
            }
          }
        })
        assert.equal(value.rows.length, 6)
        for (const row of value.rows) {
          assert.ok(row.arrow && row.right >= 0 && row.right <= 25, row.label + ': trailing arrow')
          assert.ok(
            row.height >= 56 && (large || row.height === 56) && row.centered <= 1,
            row.label + ': touch target and icon alignment'
          )
        }
        assert.equal(value.deletion.color, value.deletion.danger, 'delete action uses danger color')
        assert.ok(
          value.deletion.height >= 48 && Math.abs(value.deletion.offset) <= 1,
          'delete label must be visually centered'
        )
        metrics.push({ name: `settings-actions-${width}${large ? '-dark-200' : ''}`, ...value })
        await audit(page, `settings-actions-${width}${large ? '-dark-200' : ''}`)
        await shot(page, `settings-actions-${width}${large ? '-dark-200' : ''}`)
        if (style) await style.evaluate((el) => el.remove())
      }
      await page.setViewportSize({ width: 375, height: 812 })
      await page.emulateMedia({ colorScheme: 'light' })
      await page.getByRole('button', { name: '注销账号', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '注销钓友集账号', exact: true })
      await dialog.waitFor()
      assert.equal(
        await dialog.getByRole('button', { name: '永久注销账号', exact: true }).isEnabled(),
        false
      )
      await shot(page, 'delete-confirmation-375', false)
      await page.getByRole('button', { name: '取消注销', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      assert.ok(
        await page.evaluate(() => localStorage.getItem('dyj.auth.v1')),
        'cancel keeps session'
      )
      assert.ok(
        await page.evaluate((id) => localStorage.getItem(`dyj.live.draft.${id}.post`), fixtureUser),
        'cancel keeps drafts'
      )
    },
    { signedIn: true }
  )
  await check(
    'logout-confirmation-local-session-only',
    async ({ page }) => {
      await open(page, pages[0])
      await page.getByRole('button', { name: '退出登录', exact: true }).waitFor()
      for (const large of [false, true]) {
        await page.setViewportSize({ width: large ? 320 : 375, height: large ? 740 : 812 })
        await page.emulateMedia({ colorScheme: large ? 'dark' : 'light' })
        const style = large
          ? await page.addStyleTag({ content: 'html { font-size: 32px !important; }' })
          : null
        await page.getByRole('button', { name: '退出登录', exact: true }).click()
        const dialog = page.getByRole('alertdialog', { name: '退出登录？', exact: true })
        await dialog.waitFor()
        await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '取消')
        assert.doesNotMatch(await dialog.innerText(), tech)
        const bounds = await dialog.boundingBox()
        assert.ok(
          bounds.x >= 15 &&
            bounds.y >= 15 &&
            bounds.x + bounds.width <= page.viewportSize().width - 15 &&
            bounds.y + bounds.height <= page.viewportSize().height - 15,
          'dialog must remain within safe viewport'
        )
        await shot(page, large ? 'logout-dark-large-320' : 'logout-light-375', false)
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'hidden' })
        assert.ok(
          await page.evaluate(() => localStorage.getItem('dyj.auth.v1')),
          'cancel must keep local session'
        )
        assert.ok(
          await page.evaluate(
            (id) => localStorage.getItem(`dyj.live.draft.${id}.post`),
            fixtureUser
          ),
          'cancel must keep draft'
        )
        if (style) await style.evaluate((el) => el.remove())
      }
    },
    { signedIn: true }
  )
} finally {
  await browser.close()
  await new Promise((done) => server.close(done))
  writeFileSync(
    resolve(output, 'report.json'),
    JSON.stringify(
      {
        kind: 'Local browser fixtures only; no live SMS, remote writes, real login or native-device validation',
        buildDirectory,
        results,
        screenshots,
        metrics,
        requestSummary
      },
      null,
      2
    )
  )
}
console.log(
  `User copy review: ${results.filter((item) => item.status === 'PASS').length}/${results.length} checks passed; ${screenshots.length} screenshots in ${output}`
)
if (results.some((item) => item.status === 'FAIL')) process.exitCode = 1
