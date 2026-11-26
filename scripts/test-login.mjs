import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
import { chromium } from 'playwright'
import { loadEnv } from 'vite'

// Local contract fixtures only: no SMS, remote account, or live session is created.
// Child-process overrides never modify .env files or use the project's real key.
const placeholderKey = 'sb_publishable_contract_test_only'
const profile =
  process.argv.find((arg) => arg.startsWith('--profile='))?.slice('--profile='.length) || 'active'
assert.ok(
  ['active', 'password', 'current', 'demo'].includes(profile),
  'profile must be active, password, current, or demo'
)
const currentFlags = profile === 'current' ? loadEnv('production', process.cwd(), 'VITE_') : {}
const currentUnavailable =
  profile === 'current' &&
  (!currentFlags.VITE_SUPABASE_KEY ||
    currentFlags.VITE_AUTH_CAPTCHA_ENABLED === 'true')
const passwordOnly =
  profile === 'password' ||
  (profile === 'current' && !currentUnavailable && currentFlags.VITE_PHONE_AUTH_ENABLED !== 'true')
const output = resolve('artifacts/login-review/redesign', profile)
const buildDirectory = `dist/test/login-${profile}`
const root = resolve(buildDirectory)
const authHost = 'jupuypvmgjpnpntfetqv.supabase.co'
const fixturePhone = '13800000000'
const normalizedPhone = '+86' + fixturePhone
const fixtureUserId = '22222222-2222-4222-8222-222222222222'
const rawError = 'INTERNAL_PROVIDER_SECRET_SENTINEL SQLSTATE smtp.vendor.example'
mkdirSync(output, { recursive: true })
if (!process.argv.includes('--skip-build')) {
  const fixtureEnv = {
    ...process.env,
    VITE_DATA_MODE: profile === 'demo' ? 'demo' : 'live',
    VITE_SUPABASE_URL: 'https://' + authHost,
    VITE_SUPABASE_KEY: placeholderKey,
    VITE_PHONE_AUTH_ENABLED: profile === 'active' ? 'true' : 'false',
    VITE_AUTH_CAPTCHA_ENABLED: 'false',
    VITE_OPERATOR_PHONE_ENABLED: 'false',
    VITE_AMAP_KEY: '',
    VITE_AMAP_SERVICE_HOST: '',
    H5_BUILD_DIR: buildDirectory
  }
  // "current" intentionally preserves the user's actual production env flags.
  // Do not print keys or replace it with an artificial active/empty-key UI.
  const env = profile === 'current' ? { ...process.env, H5_BUILD_DIR: buildDirectory } : fixtureEnv
  const mode = profile === 'current' ? 'production' : profile === 'demo' ? 'demo' : 'test-login'
  const build = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'mobile-pro', 'uni', 'build', '-p', 'h5', '--mode', mode, '--outDir', env.H5_BUILD_DIR],
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
    res.writeHead(200, {
      'Content-Type': mime[extname(filename)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    })
    res.end(readFileSync(filename))
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
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'apikey, authorization, content-type, x-client-info',
  'access-control-expose-headers': 'Retry-After, Content-Range'
}
async function poll(task, message, timeout = 10000) {
  const deadline = Date.now() + timeout
  let value
  do {
    value = await task()
    if (value) return value
    await new Promise((done) => setTimeout(done, 50))
  } while (Date.now() < deadline)
  assert.fail(message)
}
async function setup({ useClock = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    locale: 'zh-CN',
    colorScheme: 'light',
    permissions: ['geolocation'],
    geolocation: { latitude: 31.12, longitude: 120.12 },
    reducedMotion: 'reduce'
  })
  const state = {
    requests: [],
    blocked: [],
    errors: [],
    otp: 'ok',
    verify: 'success',
    retryAfter: 125,
    otpGate: null,
    verifyGate: null
  }
  // Fake sessions must never open a real Realtime connection.
  await context.routeWebSocket(/supabase\.co/, socket => socket.close())
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url())
    if (url.origin === base) return route.continue()
    if (url.hostname !== authHost) {
      state.blocked.push(url.origin + url.pathname)
      return route.abort('blockedbyclient')
    }
    // Every Supabase request terminates in this route: no route.continue/fetch.
    const json = async (status, body, headers = {}) =>
      route.fulfill({
        status,
        headers: { ...cors, 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body)
      })
    if (request.method() === 'OPTIONS') return json(200, {})
    const record = { method: request.method(), path: url.pathname, body: request.postDataJSON() }
    state.requests.push(record)
    if (profile === 'active' || profile === 'password')
      assert.ok(
        request.headers().apikey === placeholderKey,
        'build did not use the isolated placeholder key (value redacted)'
      )
    if (url.pathname === '/auth/v1/otp') {
      if (state.otpGate) await state.otpGate
      if (state.otp === 'abort') return route.abort('failed')
      if (state.otp === 'rate')
        return json(
          429,
          { code: 'over_sms_send_rate_limit', msg: rawError },
          { 'Retry-After': String(state.retryAfter) }
        )
      if (state.otp === 'technical')
        return json(503, { error: rawError, error_code: 'provider_internals' })
      return json(200, {})
    }
    if (url.pathname === '/auth/v1/verify') {
      if (state.verifyGate) await state.verifyGate
      if (state.verify === 'wrong') return json(403, { error_code: 'otp_expired', msg: rawError })
      if (state.verify === 'rate')
        return json(
          429,
          { code: 'over_request_rate_limit', msg: rawError },
          { 'Retry-After': String(state.retryAfter) }
        )
      if (state.verify === 'technical') return json(500, { error_description: rawError })
      if (state.verify === 'invalid-session')
        return json(200, { access_token: 'invalid-local-fixture' })
      return json(200, {
        access_token: 'contract-access-token',
        refresh_token: 'contract-refresh-token',
        expires_in: 3600,
        token_type: 'bearer',
        user: { id: fixtureUserId, phone: normalizedPhone.slice(1) }
      })
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      if (record.body?.phone !== normalizedPhone || record.body?.password !== 'test-only-password')
        return json(400, { code: 'invalid_credentials' })
      return json(200, {
        access_token: 'password-contract-access',
        refresh_token: 'password-contract-refresh',
        expires_in: 3600,
        user: { id: fixtureUserId, phone: normalizedPhone.slice(1) }
      })
    }
    if (url.pathname.endsWith('/rpc/fishing_read')) return json(200, { items: [], next: null })
    if (url.pathname.startsWith('/rest/v1/')) return json(200, [], { 'content-range': '0-0/0' })
    return json(404, { message: 'Unimplemented local contract fixture' })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', (error) => state.errors.push(error.message))
  // Install before application intervals are created; installing afterward cannot
  // reliably control the login page's already-running resend timer.
  if (useClock) await page.clock.install()
  await page.goto(base + '/#/pages/login/index', { waitUntil: 'networkidle' })
  await page.locator('.fishing-page').waitFor()
  if (profile === 'active') await page.locator('input[aria-label="手机号码"]').waitFor()
  return { context, page, state }
}
const phone = (page) => page.locator('input[aria-label="手机号码"]')
const code = (page) => page.locator('input[aria-label="短信验证码"]')
const consent = (page) => page.getByRole('checkbox', { name: '同意用户协议与隐私说明' })
const send = (page) => page.locator('.login-send')
const login = (page) =>
  page.getByRole('button', { name: /^(登录 \/ 注册|正在登录…|\d+ 秒后重试)$/ })
const requests = (state, path) =>
  state.requests.filter((request) => request.path === '/auth/v1/' + path)
async function fill(page, token = '123456', agree = true) {
  await phone(page).fill(fixturePhone)
  // Phone changes intentionally clear the old OTP; allow that watcher to finish.
  await page.waitForTimeout(50)
  if (token) await code(page).fill(token)
  if ((await consent(page).getAttribute('aria-checked')) !== String(agree))
    await consent(page).click()
}
async function textIncludes(page, text) {
  await poll(
    async () => (await page.locator('body').innerText()).includes(text),
    'missing text: ' + text
  )
}
async function isDisabled(locator) {
  return locator.evaluate(
    (el) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true'
  )
}
async function loadedFish(page) {
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.fish-mark')].every((mark) => {
      const rect = mark.getBoundingClientRect()
      if (!rect.width || !rect.height) return true
      const images = [...mark.querySelectorAll('img')]
      return (
        images.length === 2 &&
        images.every((img) => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0)
      )
    })
  )
}
async function shot(page, name) {
  await page.waitForFunction(() => !document.querySelector('.mobile-action--pressed'))
  await loadedFish(page)
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  )
  const paint = () =>
    page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      rootFont: getComputedStyle(document.documentElement).fontSize,
      body: [...document.querySelectorAll('.legal-section .body')].slice(0, 1).map((el) => ({
        fontSize: getComputedStyle(el).fontSize,
        rect: el.getBoundingClientRect().toJSON()
      }))
    }))
  const before = name.startsWith('legal-') ? await paint() : null
  await page.screenshot({ path: resolve(output, name + '.png'), fullPage: true })
  if (before) metrics.push({ name: name + '-screenshot-layout', before, after: await paint() })
  screenshots.push(name + '.png')
}
async function overflow(page, name) {
  const value = await page.evaluate(() => ({
    viewport: innerWidth,
    scroll: document.documentElement.scrollWidth,
    root: getComputedStyle(document.documentElement).fontSize,
    body: getComputedStyle(document.body).fontSize
  }))
  metrics.push({ name, ...value })
  assert.ok(
    value.scroll <= value.viewport + 1,
    name + ': horizontal overflow ' + JSON.stringify(value)
  )
}
async function loginTypeFloor(page, name) {
  const values = await page
    .locator(
      '.login-description, .login-content input, .login-content .primary, .login-content .secondary'
    )
    .evaluateAll((nodes) =>
      nodes.map((el) => ({
        type:
          el.tagName === 'INPUT'
            ? 'input'
            : el.classList.contains('login-description')
              ? 'description'
              : 'action',
        fontSize: getComputedStyle(el).fontSize
      }))
    )
  metrics.push({ name: name + '-actual-type', values })
  assert.ok(values.length > 0, 'no login typography sampled')
  for (const value of values) {
    const minimum = value.type === 'input' ? 16 : value.type === 'description' ? 15 : 14
    assert.ok(
      parseFloat(value.fontSize) >= minimum,
      name + ' ' + value.type + ' is below ' + minimum + 'px: ' + value.fontSize
    )
  }
}
async function noEmptyHeading(page) {
  const headings = await page.getByRole('heading').allTextContents()
  assert.ok(headings.length > 0, 'page needs an accessible heading')
  assert.ok(
    headings.every((text) => text.trim()),
    'empty accessible heading'
  )
}
async function noUnavailableOneClick(page) {
  assert.equal(
    await page
      .getByRole('button', {
        name: /本机号码一键登录|微信手机号一键登录|改用短信验证码|使用本机号码登录/
      })
      .count(),
    0,
    'H5 must not advertise unavailable native/provider capabilities'
  )
}
async function profileScreens(page, heading) {
  for (const [width, height] of [
    [320, 740],
    [375, 812],
    [440, 956],
    [844, 390],
    [1280, 900]
  ]) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(150)
    await overflow(page, `login-${profile}-light-${width}`)
    await loginTypeFloor(page, `login-${profile}-light-${width}`)
    await shot(page, `login-${profile}-light-${width}`)
    if (width === 1280) {
      const content = await page.locator('.login-content').boundingBox()
      assert.ok(content.width <= 600, 'wide login content should retain a readable max-width')
      metrics.push({ name: 'wide-login-content', ...content })
    }
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await shot(page, `login-${profile}-dark-375`)
  await page.setViewportSize({ width: 320, height: 740 })
  await page.waitForTimeout(200)
  const textStyle = await page.addStyleTag({ content: 'html { font-size: 24px !important; }' })
  await page.waitForFunction(() => getComputedStyle(document.documentElement).fontSize === '24px')
  await overflow(page, `login-${profile}-dark-large-320`)
  const fontSize = await page
    .getByRole('heading', { name: heading, exact: true })
    .evaluate((el) => getComputedStyle(el).fontSize)
  metrics.push({ name: 'large-profile-heading', fontSize })
  assert.ok(parseFloat(fontSize) >= 30, 'large-text heading did not scale')
  await shot(page, `login-${profile}-dark-large-320`)
  await textStyle.evaluate((el) => el.remove())
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize({ width: 375, height: 812 })
}
async function contactAndLegal(page, context, state) {
  await context.grantPermissions(['geolocation', 'clipboard-read', 'clipboard-write'], { origin: base })
  const contact = page.getByRole('button', { name: '联系客服', exact: true })
  await contact.focus()
  const focus = await contact.evaluate((el) => ({
    outline: getComputedStyle(el).outlineStyle,
    width: getComputedStyle(el).outlineWidth,
    rect: el.getBoundingClientRect().toJSON()
  }))
  metrics.push({ name: 'contact-focus', ...focus })
  assert.notEqual(focus.outline, 'none')
  assert.ok(focus.rect.width >= 44 && focus.rect.height >= 44)
  await shot(page, `login-${profile}-keyboard-focus`)
  await page.keyboard.press('Space')
  await page.waitForURL('**/pages/contact/index')
  await page.getByRole('button', { name: '复制运营者微信号', exact: true }).click()
  await textIncludes(page, '微信号已复制')
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '869123771')
  const live = page.locator('.contact-details [aria-live="polite"]')
  assert.ok((await live.count()) >= 1, 'copy needs accessible live feedback')
  await page.getByRole('button', { name: '复制运营者QQ号', exact: true }).click()
  await textIncludes(page, 'QQ号已复制')
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '869123771')
  await shot(page, `login-${profile}-contact`)
  await page.getByRole('button', { name: '返回上一页', exact: true }).last().click()
  await page.waitForURL('**/#/pages/login/index')
  assert.doesNotMatch(await page.locator('uni-page').last().innerText(), /869123771/)
  for (const [label, type] of [
    ['用户协议', 'terms'],
    ['隐私说明', 'privacy']
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.waitForURL('**/pages/settings/legal?type=' + type)
    await page.locator('.legal-section').first().waitFor()
    assert.doesNotMatch(await page.locator('uni-page').last().innerText(), /运营者：|版本日期|869123771/)
    await page.getByRole('button', { name: '返回上一页', exact: true }).last().click()
    await page.waitForURL('**/#/pages/login/index')
    await page.getByRole('button', { name: '联系客服', exact: true }).waitFor()
  }
  assert.equal(
    state.requests.filter(
      (request) => request.path.startsWith('/auth/') || request.path === '/functions/v1/phone-login'
    ).length,
    0
  )
}
async function check(name, action) {
  const filter = process.argv.find((arg) => arg.startsWith('--filter='))?.slice('--filter='.length)
  if (filter && !name.includes(filter)) return
  let test
  try {
    test = await setup({
      useClock: name === 'send-contract-busy-and-countdown' || name.includes('429-retry-after')
    })
    await action(test)
    assert.deepEqual(test.state.errors, [], 'uncaught page errors')
    assert.deepEqual(test.state.blocked, [], 'unexpected external URLs were blocked')
    results.push({ name, status: 'PASS' })
    console.log('PASS ' + name)
  } catch (error) {
    results.push({ name, status: 'FAIL', error: String(error.stack || error) })
    console.error('FAIL ' + name + ': ' + error.message)
    if (test)
      await test.page
        .screenshot({ path: resolve(output, 'failure-' + name + '.png'), fullPage: true })
        .catch(() => {})
  } finally {
    if (test) {
      requestSummary.push({
        name,
        requests: test.state.requests.map(({ method, path }) => ({ method, path })),
        blocked: test.state.blocked
      })
      await test.context.close()
    }
  }
}
try {
  if (currentUnavailable) {
    await check('actual-unavailable-responsive-no-auth', async ({ page, state }) => {
      await page.getByRole('heading', { name: '登录暂未开放', exact: true }).waitFor()
      await noEmptyHeading(page)
      await noUnavailableOneClick(page)
      assert.equal(
        await page.locator('input, textarea, [role="checkbox"]').count(),
        0,
        'unavailable login must not render a grey disabled form'
      )
      assert.equal(
        await page.getByRole('button', { name: /获取验证码|登录 \/ 注册|进入本机体验/ }).count(),
        0
      )
      const text = await page.locator('body').innerText()
      assert.equal(
        /Supabase|captcha|SDK|公开\s*Key|未配置|服务端密钥/i.test(text),
        false,
        'technical configuration copy leaked to unavailable page'
      )
      assert.equal(
        await isDisabled(page.getByRole('button', { name: '先逛逛', exact: true })),
        false
      )
      await profileScreens(page, '登录暂未开放')
      assert.equal(
        state.requests.length,
        0,
        'unavailable login should not probe authentication providers'
      )
    })
    await check('actual-unavailable-contact-and-legal', async ({ page, context, state }) => {
      await contactAndLegal(page, context, state)
      assert.equal(await page.locator('input, [role="checkbox"]').count(), 0)
      assert.equal(state.requests.length, 0)
    })
    await check('actual-unavailable-browse-without-login', async ({ page, state }) => {
      await page.getByRole('button', { name: '先逛逛', exact: true }).click()
      await page.waitForURL((url) => ['#/', '#/pages/home/index'].includes(url.hash))
      assert.equal(await page.getByRole('button', { name: '进入本机体验', exact: true }).count(), 0)
      assert.equal(
        state.requests.filter(
          (request) =>
            request.path.startsWith('/auth/') || request.path === '/functions/v1/phone-login'
        ).length,
        0
      )
      assert.equal(await page.evaluate(() => localStorage.getItem('dyj.auth.v1')), null)
    })
  } else if (passwordOnly) {
    await check('password-leaves-sms-closed', async ({ page, state }) => {
      const heading = '密码登录'
      await page.getByRole('heading', { name: heading, exact: true }).waitFor()
      await noEmptyHeading(page)
      await noUnavailableOneClick(page)
      await textIncludes(page, '短信注册和找回密码暂不可用。')
      assert.equal(await send(page).count(), 0)
      assert.equal(await page.getByRole('button', { name: '忘记密码', exact: true }).count(), 0)
      assert.equal(state.requests.length, 0)
      await profileScreens(page, heading)
      await page.getByRole('textbox', { name: '账号或手机号' }).fill(fixturePhone)
      const password = page.locator('input[aria-label="登录密码"]')
      const submit = page.getByRole('button', { name: '登录', exact: true })
      await password.fill('wrong-test-password')
      await submit.click()
      await textIncludes(page, '账号、手机号或密码不正确，请重新填写')
      await password.fill('test-only-password')
      await submit.click()
      await page.waitForURL((url) => ['#/', '#/pages/home/index'].includes(url.hash))
      assert.equal(requests(state, 'token').length, 2)
      assert.equal(requests(state, 'otp').length, 0)
      assert.equal(requests(state, 'verify').length, 0)
    })
  } else if (profile === 'demo') {
    await check('demo-explicit-local-only', async ({ page, state }) => {
      await page.getByRole('button', { name: '进入本机体验', exact: true }).waitFor()
      await noEmptyHeading(page)
      await noUnavailableOneClick(page)
      assert.equal(await page.locator('input, [role="checkbox"]').count(), 0)
      const text = await page.locator('body').innerText()
      assert.ok(
        text.includes('本机') && /不发送短信|不连接线上|不会注册线上/.test(text),
        'local demo must not masquerade as a live account'
      )
      await shot(page, 'login-demo-light-375')
      await page.emulateMedia({ colorScheme: 'dark' })
      await shot(page, 'login-demo-dark-375')
      await page.getByRole('button', { name: '进入本机体验', exact: true }).click()
      await page.waitForURL((url) => ['#/', '#/pages/home/index'].includes(url.hash))
      await textIncludes(page, '本机体验 · 示例内容，不连接线上')
      assert.equal(state.requests.length, 0, 'local demo must make no remote request')
      assert.equal(await page.evaluate(() => localStorage.getItem('dyj.auth.v1')), null)
    })
  } else {
    await check('responsive-and-focus', async ({ page, state }) => {
      await noEmptyHeading(page)
      await noUnavailableOneClick(page)
      assert.equal(await phone(page).getAttribute('inputmode'), 'tel')
      assert.equal(await code(page).getAttribute('autocomplete'), 'one-time-code')
      assert.equal(await code(page).getAttribute('type'), 'text')
      assert.equal(await code(page).getAttribute('inputmode'), 'numeric')
      assert.equal(await code(page).getAttribute('maxlength'), '6')
      assert.equal(await consent(page).getAttribute('aria-checked'), 'true')
      assert.equal(
        await consent(page).locator('.wd-checkbox.is-checked').count(),
        1
      )
      await page.getByText('我已阅读并同意', { exact: true }).click()
      assert.equal(
        await consent(page).getAttribute('aria-checked'),
        'false',
        'agreement text toggles the same checkbox'
      )
      const agreementText = await page
        .locator('.login-consent-label, .login-consent-copy .text-action')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const range = document.createRange()
            range.selectNodeContents(element)
            const rect = range.getBoundingClientRect()
            return { text: element.textContent.trim(), y: rect.y + rect.height / 2 }
          })
        )
      assert.ok(
        Math.max(...agreementText.map((item) => item.y)) -
          Math.min(...agreementText.map((item) => item.y)) <=
          1.5,
        'agreement copy and links must have aligned text centers: ' + JSON.stringify(agreementText)
      )
      await shot(page, 'login-consent-unchecked-375')
      await consent(page).click()
      assert.equal(await consent(page).getAttribute('aria-checked'), 'true')
      await shot(page, 'login-consent-checked-375')
      await consent(page).click()
      for (const [width, height] of [
        [320, 740],
        [375, 812],
        [440, 956],
        [844, 390],
        [1280, 900]
      ]) {
        await page.setViewportSize({ width, height })
        await page.waitForTimeout(150)
        await overflow(page, 'login-light-' + width)
        await loginTypeFloor(page, 'login-light-' + width)
        await shot(page, 'login-light-' + width)
      }
      await page.setViewportSize({ width: 375, height: 812 })
      await page.emulateMedia({ colorScheme: 'dark' })
      await shot(page, 'login-dark-375')
      await page.setViewportSize({ width: 320, height: 740 })
      await page.waitForTimeout(200)
      const textStyle = await page.addStyleTag({ content: 'html { font-size: 24px !important; }' })
      await page.waitForFunction(
        () => getComputedStyle(document.documentElement).fontSize === '24px'
      )
      await overflow(page, 'login-dark-large-320')
      const values = await page
        .locator('.login-title, .mobile-field__label, .text-action, .primary')
        .evaluateAll((nodes) =>
          nodes.map((el) => ({
            text: el.textContent.trim(),
            fontSize: getComputedStyle(el).fontSize,
            width: el.getBoundingClientRect().width,
            scroll: el.scrollWidth
          }))
        )
      metrics.push({ name: 'large-text-controls', values })
      assert.equal(
        await page.evaluate(() => getComputedStyle(document.documentElement).fontSize),
        '24px'
      )
      assert.ok(
        parseFloat(
          await page.locator('.login-title').evaluate((el) => getComputedStyle(el).fontSize)
        ) >= 30
      )
      assert.ok(parseFloat(await phone(page).evaluate((el) => getComputedStyle(el).fontSize)) >= 24)
      await shot(page, 'login-dark-large-320')
      await textStyle.evaluate((el) => el.remove())
      await page.emulateMedia({ colorScheme: 'light' })
      await page.setViewportSize({ width: 375, height: 812 })
      await phone(page).focus()
      await page.keyboard.press('Tab')
      assert.equal(
        await code(page).evaluate((el) => el === document.activeElement),
        true,
        'Tab should reach code input'
      )
      await page.keyboard.press('Tab')
      assert.equal(
        await send(page).evaluate((el) => el === document.activeElement),
        true,
        'Tab should reach send'
      )
      await page.keyboard.press('Tab')
      assert.equal(
        await consent(page).evaluate((el) => el === document.activeElement),
        true,
        'Tab should reach consent'
      )
      const focus = await consent(page).evaluate((el) => ({
        outline: getComputedStyle(el).outlineStyle,
        width: getComputedStyle(el).outlineWidth,
        rect: el.getBoundingClientRect().toJSON()
      }))
      metrics.push({ name: 'consent-focus', ...focus })
      assert.notEqual(focus.outline, 'none')
      assert.ok(focus.rect.width >= 44 && focus.rect.height >= 44)
      await shot(page, 'login-keyboard-focus')
      await page.keyboard.press('Space')
      assert.equal(await consent(page).getAttribute('aria-checked'), 'true')
      assert.equal(state.requests.length, 0)
    })

    await check('validation-no-request', async ({ page, state }) => {
      await login(page).click()
      await textIncludes(page, '请输入手机号码')
      await poll(
        () => phone(page).evaluate((el) => el === document.activeElement),
        'empty phone focus'
      )
      await phone(page).fill('12345')
      await send(page).click()
      await textIncludes(page, '请输入正确的中国大陆手机号')
      await fill(page, '', false)
      await send(page).click()
      await textIncludes(page, '请先阅读并同意用户协议与隐私说明')
      await poll(
        () => consent(page).evaluate((el) => el === document.activeElement),
        'consent error focus'
      )
      await consent(page).click()
      await login(page).click()
      await textIncludes(page, '请输入短信中的 6 位验证码')
      await poll(
        () => code(page).evaluate((el) => el === document.activeElement),
        'code error focus'
      )
      await shot(page, 'login-field-validation')
      await code(page).fill('123456')
      await phone(page).fill('13900000000')
      await poll(
        async () => (await code(page).inputValue()) === '',
        'changing phone clears old code'
      )
      assert.equal(state.requests.length, 0)
    })

    await check('send-contract-busy-and-countdown', async ({ page, state }) => {
      let release
      state.otpGate = new Promise((done) => {
        release = done
      })
      try {
        await fill(page)
        await send(page).click()
        await poll(() => requests(state, 'otp').length === 1, 'OTP request missing')
        assert.equal(await isDisabled(send(page)), true)
        assert.equal(await isDisabled(login(page)), true)
        for (const label of ['用户协议', '隐私说明']) {
          const action = page.getByRole('button', { name: label, exact: true })
          assert.equal(
            await isDisabled(action),
            true,
            'busy auth must not navigate away into legal'
          )
          await action.dispatchEvent('click')
        }
        assert.equal(new URL(page.url()).hash, '#/pages/login/index')
        await send(page).dispatchEvent('click')
        assert.equal(requests(state, 'otp').length, 1, 'duplicate pending send')
        assert.deepEqual(requests(state, 'otp')[0], {
          method: 'POST',
          path: '/auth/v1/otp',
          body: { phone: normalizedPhone, create_user: true, channel: 'sms' }
        })
        release()
        await textIncludes(page, '138 **** 0000')
        await poll(
          async () => /\d+ 秒后重发/.test(await send(page).innerText()),
          'resend cooldown missing'
        )
        const before = Number((await send(page).innerText()).match(/\d+/)[0])
        await page.clock.fastForward(3000)
        await poll(
          async () => Number((await send(page).innerText()).match(/\d+/)?.[0]) < before,
          'resend timer did not decrease'
        )
        const after = Number((await send(page).innerText()).match(/\d+/)[0])
        assert.ok(before <= 60 && after < before)
        await shot(page, 'login-sent-masked')
        await page.clock.fastForward(61000)
        await textIncludes(page, '重新获取')
        assert.equal(await isDisabled(send(page)), false)
      } finally {
        release()
      }
    })

    await check('verify-without-send-and-session', async ({ page, state }) => {
      let release
      state.verifyGate = new Promise((done) => {
        release = done
      })
      try {
        await fill(page)
        // Model the single input event used by system AutoFill; preserve leading zeroes.
        // This is a browser contract, not proof of receiving a real device SMS.
        await code(page).evaluate((input) => {
          input.value = '010203'
          input.dispatchEvent(new Event('input', { bubbles: true }))
        })
        assert.equal(await code(page).inputValue(), '010203')
        assert.equal(requests(state, 'verify').length, 0, 'filling a code must not submit it')
        await login(page).click()
        await poll(() => requests(state, 'verify').length === 1, 'verify request missing')
        assert.equal(await isDisabled(login(page)), true)
        for (const label of ['用户协议', '隐私说明']) {
          const action = page.getByRole('button', { name: label, exact: true })
          assert.equal(await isDisabled(action), true)
          await action.dispatchEvent('click')
        }
        assert.equal(new URL(page.url()).hash, '#/pages/login/index')
        await login(page).dispatchEvent('click')
        assert.equal(requests(state, 'verify').length, 1)
        release()
        await page.waitForURL((url) => ['#/', '#/pages/home/index'].includes(url.hash))
        assert.equal(
          requests(state, 'otp').length,
          0,
          'verify should not require sending on this page'
        )
        assert.deepEqual(requests(state, 'verify')[0].body, {
          phone: normalizedPhone,
          token: '010203',
          type: 'sms'
        })
        const hasFixtureSession = () =>
          page.evaluate(
            (id) => (localStorage.getItem('dyj.auth.v1') || '').includes(id),
            fixtureUserId
          )
        assert.equal(
          await hasFixtureSession(),
          true,
          'successful fixture session was not persisted'
        )
        await page.reload({ waitUntil: 'networkidle' })
        assert.equal(await hasFixtureSession(), true)
        await shot(page, 'login-contract-success-home')
        // Storage presence alone is insufficient: a new page load must hydrate it
        // into the real signed-in UI rather than merely leave an unused JSON blob.
        await page.goto(base + '/#/pages/settings/index', { waitUntil: 'networkidle' })
        await page.getByRole('button', { name: '退出登录', exact: true }).waitFor()
      } finally {
        release()
      }
    })

    await check('wrong-code-retry', async ({ page, state }) => {
      state.verify = 'wrong'
      await fill(page)
      await login(page).click()
      await textIncludes(page, '验证码错误或已过期')
      assert.equal(await code(page).inputValue(), '123456')
      assert.equal(await phone(page).inputValue(), fixturePhone)
      await poll(
        () => code(page).evaluate((el) => el === document.activeElement),
        'wrong OTP focus'
      )
      assert.equal((await page.locator('body').innerText()).includes(rawError), false)
      await shot(page, 'login-wrong-code')
      state.verify = 'success'
      await code(page).fill('654321')
      await login(page).click()
      await page.waitForURL((url) => ['#/', '#/pages/home/index'].includes(url.hash))
      assert.equal(requests(state, 'verify').length, 2)
      assert.equal(requests(state, 'verify')[1].body.token, '654321')
    })

    await check('pending-verify-leave-ignores-result', async ({ page, state }) => {
      for (const outcome of ['success', 'wrong']) {
        if (outcome === 'wrong') {
          await page.goto(base + '/#/pages/login/index', { waitUntil: 'networkidle' })
          await phone(page).waitFor()
        }
        let release
        state.verify = outcome
        state.verifyGate = new Promise((done) => {
          release = done
        })
        try {
          await fill(page)
          const count = requests(state, 'verify').length
          await login(page).click()
          await poll(
            () => requests(state, 'verify').length === count + 1,
            'pending verification request missing'
          )
          await page.getByRole('button', { name: '返回上一页', exact: true }).click()
          await page.waitForURL((url) => ['#/', '#/pages/home/index'].includes(url.hash))
          const response = page.waitForResponse(
            (value) => new URL(value.url()).pathname === '/auth/v1/verify'
          )
          release()
          await response
          await page.waitForTimeout(250)
          assert.equal(
            await page.evaluate(() => localStorage.getItem('dyj.auth.v1')),
            null,
            'a successful OTP response must not sign in after leaving the login page'
          )
          assert.equal(
            (await page.locator('body').innerText()).includes('验证码错误或已过期'),
            false,
            'a rejected OTP must not surface an old-page error after leaving'
          )
          assert.ok(
            ['#/', '#/pages/home/index'].includes(new URL(page.url()).hash),
            'late OTP changed navigation'
          )
        } finally {
          release()
        }
      }
    })

    for (const action of ['send', 'verify'])
      await check(action + '-429-retry-after', async ({ page, state }) => {
        state[action === 'send' ? 'otp' : 'verify'] = 'rate'
        const endpoint = action === 'send' ? 'otp' : 'verify'
        const control = action === 'send' ? send(page) : login(page)
        await fill(page)
        await control.click()
        await poll(
          async () => /12[0-5] 秒后/.test(await control.innerText()),
          'server Retry-After 125 not used'
        )
        assert.equal(await isDisabled(control), true)
        await control.dispatchEvent('click')
        assert.equal(requests(state, endpoint).length, 1)
        await page.clock.fastForward(65000)
        await poll(
          async () => Number((await control.innerText()).match(/\d+/)?.[0]) <= 60,
          'server cooldown did not decrease'
        )
        const remaining = Number((await control.innerText()).match(/\d+/)[0])
        assert.ok(
          remaining > 0 && remaining <= 60,
          'server cooldown should still be active after 65 seconds'
        )
        await shot(page, 'login-' + action + '-rate-limit')
        await page.clock.fastForward(61000)
        await poll(
          async () => !(await isDisabled(control)),
          'expired cooldown did not release action'
        )
        assert.equal(await isDisabled(control), false)
        state[action === 'send' ? 'otp' : 'verify'] = action === 'send' ? 'ok' : 'success'
        await control.click()
        await poll(() => requests(state, endpoint).length === 2, 'retry request missing')
      })

    await check('safe-server-errors-and-malformed-session', async ({ page, state }) => {
      state.otp = 'technical'
      await fill(page)
      await send(page).click()
      await textIncludes(page, '登录服务暂时不可用，请稍后重试')
      assert.equal((await page.locator('body').innerText()).includes(rawError), false)
      assert.equal(await phone(page).inputValue(), fixturePhone)
      state.verify = 'technical'
      await login(page).click()
      await poll(() => requests(state, 'verify').length === 1, 'technical verify request missing')
      await textIncludes(page, '登录服务暂时不可用，请稍后重试')
      assert.equal((await page.locator('body').innerText()).includes(rawError), false)
      state.verify = 'invalid-session'
      await login(page).click()
      await poll(() => requests(state, 'verify').length === 2, 'invalid session request missing')
      await textIncludes(page, '登录服务暂时不可用，请稍后重试')
      assert.equal(await page.evaluate(() => localStorage.getItem('dyj.auth.v1')), null)
      assert.equal(await code(page).inputValue(), '123456')
      await shot(page, 'login-safe-service-error')
    })

    await check('network-failure-retains-input', async ({ page, state }) => {
      state.otp = 'abort'
      await fill(page)
      await send(page).click()
      await textIncludes(page, '网络连接中断，请检查网络后重试')
      assert.equal(await phone(page).inputValue(), fixturePhone)
      assert.equal(await code(page).inputValue(), '123456')
      assert.equal(await isDisabled(send(page)), false)
      await shot(page, 'login-network-error')
    })

    await check('legal-navigation-preserves-form', async ({ page, state }) => {
      await fill(page)
      await page.getByRole('button', { name: '联系客服', exact: true }).click()
      await page.waitForURL('**/pages/contact/index')
      await page.getByRole('button', { name: '查看个人微信二维码' }).waitFor()
      await page.getByRole('button', { name: '返回上一页', exact: true }).last().click()
      await page.waitForURL('**/#/pages/login/index')
      assert.equal(await phone(page).inputValue(), fixturePhone)
      assert.equal(await code(page).inputValue(), '123456')
      assert.equal(await consent(page).getAttribute('aria-checked'), 'true')
      for (const [label, type] of [
        ['用户协议', 'terms'],
        ['隐私说明', 'privacy']
      ]) {
        await page.getByRole('button', { name: label, exact: true }).click()
        await page.waitForURL('**/pages/settings/legal?type=' + type)
        const visible = page.locator('uni-page').last()
        await visible.locator('.legal-section').first().waitFor()
        const text = await visible.innerText()
        assert.doesNotMatch(text, /运营者：|版本日期|869123771/)
        assert.equal(
          /开发预览|开发环境|环境配置|不是正式上线法律文本/.test(text),
          false,
          'development copy leaked into legal page'
        )
        for (const [width, height] of [
          [320, 740],
          [375, 812],
          [440, 956]
        ]) {
          await page.setViewportSize({ width, height })
          await page.waitForTimeout(150)
          await overflow(page, 'legal-' + type + '-' + width)
          await shot(page, 'legal-' + type + '-' + width)
          if (width === 320) {
            metrics.push({
              name: 'legal-' + type + '-paint',
              values: await page
                .locator('.legal-section .body')
                .evaluateAll((nodes) =>
                  nodes.slice(0, 4).map((el) => ({
                    tag: el.tagName,
                    color: getComputedStyle(el).color,
                    font: getComputedStyle(el).font,
                    visibility: getComputedStyle(el).visibility,
                    opacity: getComputedStyle(el).opacity,
                    contentVisibility: getComputedStyle(el).contentVisibility,
                    rect: el.getBoundingClientRect().toJSON(),
                    scrollY
                  }))
                )
            })
            await page.evaluate(() => scrollTo(0, 0))
            await page.evaluate(
              () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
            )
            await page.screenshot({ path: resolve(output, 'legal-' + type + '-viewport-320.png') })
            screenshots.push('legal-' + type + '-viewport-320.png')
          }
        }
        await page.setViewportSize({ width: 320, height: 740 })
        await page.emulateMedia({ colorScheme: 'dark' })
        await page.waitForTimeout(200)
        const textStyle = await page.addStyleTag({
          content: 'html { font-size: 24px !important; }'
        })
        await page.waitForFunction(
          () => getComputedStyle(document.documentElement).fontSize === '24px'
        )
        await overflow(page, 'legal-' + type + '-dark-large-320')
        assert.equal(
          await page.evaluate(() => getComputedStyle(document.documentElement).fontSize),
          '24px'
        )
        assert.equal(
          await visible.locator('.legal-section .body').first().evaluate((el) => getComputedStyle(el).fontSize),
          '22.5px'
        )
        await shot(page, 'legal-' + type + '-dark-large-320')
        await textStyle.evaluate((el) => el.remove())
        await page.emulateMedia({ colorScheme: 'light' })
        assert.equal(await visible.getByRole('button', { name: /^复制运营者/ }).count(), 0)
        if (type === 'privacy') {
          assert.equal(await page.locator('.legal-link').count(), 0)
          assert.doesNotMatch(
            await visible.innerText(),
            /Supabase|服务提供方说明|服务提供方与境外存储|https?:\/\//
          )
        }
        await page.getByRole('button', { name: '返回上一页', exact: true }).last().click()
        await page.waitForURL('**/#/pages/login/index')
        assert.equal(await phone(page).inputValue(), fixturePhone)
        assert.equal(await code(page).inputValue(), '123456')
        assert.equal(await consent(page).getAttribute('aria-checked'), 'true')
      }
      assert.equal(state.requests.length, 0)
    })
  }
} finally {
  const report = {
    profile,
    scope:
      'Local H5 UI and intercepted Supabase contract fixtures ONLY; current profile preserves actual environment flags; no real SMS, remote writes, or device certification.',
    bind: '0.0.0.0',
    modal: 'N/A: login and legal changes introduce no modal',
    results,
    metrics,
    screenshots,
    requestSummary
  }
  writeFileSync(resolve(output, 'results.json'), JSON.stringify(report, null, 2))
  await browser.close()
  await new Promise((done) => server.close(done))
}
const failed = results.filter((item) => item.status === 'FAIL')
console.log(
  `${results.length - failed.length}/${results.length} login contract checks passed. Evidence: ${output}`
)
if (failed.length) process.exitCode = 1
