import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, sep, extname } from 'node:path'
import { chromium } from 'playwright'

// Reuse test-login's isolated fixture build. All external requests terminate here.
// This script never sends real SMS or changes a remote account.
const root = resolve('dist/test/login-active')
const output = resolve('artifacts/account-security')
mkdirSync(output, { recursive: true })
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json'
}
const server = createServer((req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : decodeURIComponent(path)))
    assert.ok(file.startsWith(root + sep))
    res.writeHead(200, {
      'Content-Type': mime[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    })
    res.end(readFileSync(file))
  } catch {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((done) => server.listen(0, '0.0.0.0', done))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const id = '22222222-2222-4222-8222-222222222222'
const oldPhone = '13800000000',
  newPhone = '13900000000'
const results = [],
  screenshots = [],
  metrics = []
function session(phone = oldPhone, suffix = '') {
  return {
    access_token: 'fixture-access' + suffix,
    refresh_token: 'fixture-refresh' + suffix,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id, phone: '86' + phone }
  }
}
async function setup(signedIn = false) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    locale: 'zh-CN',
    permissions: ['geolocation'],
    geolocation: { latitude: 31.12, longitude: 120.12 },
    reducedMotion: 'reduce'
  })
  if (signedIn)
    await context.addInitScript(
      (value) => {
        if (!sessionStorage.getItem('seeded')) {
          localStorage.setItem('dyj.auth.v1', JSON.stringify({ type: 'object', data: value }))
          sessionStorage.setItem('seeded', 'true')
        }
      },
      typeof signedIn === 'object' ? signedIn : session()
    )
  const state = {
    requests: [],
    blocked: [],
    errors: [],
    phone: oldPhone,
    passwordError: false,
    otpRate: false,
    wrongCode: false,
    conflict: false,
    updateGate: null,
    verifyGate: null,
    profileGate: null,
    password: '',
    browserPassword: null,
    browserPasswordWrites: 0,
    browserPasswordReads: 0,
    browserSilentBlocked: false
  }
  // Password-manager port fixture only: no real browser vault or plaintext web storage.
  await context.exposeFunction('__fixtureReadLogin', () => {
    state.browserPasswordReads++
    return state.browserSilentBlocked ? null : state.browserPassword
  })
  await context.exposeFunction('__fixtureStoreLogin', (value) => {
    state.browserPassword = value
    state.browserPasswordWrites++
    state.browserSilentBlocked = false
  })
  await context.exposeFunction('__fixturePreventLogin', () => {
    state.browserSilentBlocked = true
  })
  await context.addInitScript(() => {
    Object.defineProperty(window, 'PasswordCredential', {
      configurable: true,
      value: class {
        type = 'password'
        id
        password
        constructor(value) {
          this.id = value.id
          this.password = value.password
        }
      }
    })
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: {
        get: (options) => {
          if (options.mediation !== 'silent' || options.password !== true)
            throw new Error('unexpected credential prompt')
          return window.__fixtureReadLogin()
        },
        store: (value) =>
          window.__fixtureStoreLogin({ type: 'password', id: value.id, password: value.password }),
        preventSilentAccess: () => window.__fixturePreventLogin()
      }
    })
  })
  // Fake sessions must never open a real Realtime connection.
  await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url())
    if (url.origin === base) return route.continue()
    if (url.hostname !== 'jupuypvmgjpnpntfetqv.supabase.co') {
      state.blocked.push(url.hostname)
      return route.abort('blockedbyclient')
    }
    const json = (status, body, headers = {}) =>
      route.fulfill({
        status,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'access-control-allow-headers': 'apikey, authorization, content-type',
          'access-control-expose-headers': 'Retry-After',
          'content-type': 'application/json',
          ...headers
        },
        body: JSON.stringify(body)
      })
    if (request.method() === 'OPTIONS') return json(200, {})
    assert.equal(
      request.headers().apikey,
      'sb_publishable_contract_test_only',
      'isolated fixture key required'
    )
    const data = request.postDataJSON()
    state.requests.push({ path: url.pathname + url.search, method: request.method(), data })
    if (url.pathname === '/auth/v1/token') {
      if (state.passwordError)
        return json(400, { error_code: 'invalid_credentials', msg: 'PRIVATE_UPSTREAM_SENTINEL' })
      return json(200, session(state.phone, '-password'))
    }
    if (url.pathname === '/functions/v1/account-login') {
      assert.equal(data.identifier, 'DY000000000001')
      if (state.passwordError)
        return json(400, { code: 'PASSWORD_INCORRECT', message: 'PRIVATE_UPSTREAM_SENTINEL' })
      return json(200, session(state.phone, '-handle'))
    }
    if (url.pathname === '/auth/v1/otp') {
      assert.equal(data.create_user, false)
      if (state.otpRate)
        return json(429, { error_code: 'over_sms_send_rate_limit' }, { 'Retry-After': '125' })
      return json(200, {})
    }
    if (url.pathname === '/auth/v1/verify') {
      if (state.verifyGate) await state.verifyGate
      if (state.wrongCode)
        return json(403, { error_code: 'otp_expired', msg: 'PRIVATE_UPSTREAM_SENTINEL' })
      if (data.type === 'phone_change') {
        assert.equal(data.phone, '+86' + newPhone)
        state.phone = newPhone
      }
      return json(200, session(state.phone, '-verified'))
    }
    if (url.pathname === '/auth/v1/user') {
      if (request.method() === 'PUT') {
        if (state.updateGate) await state.updateGate
        if (data.phone && state.conflict)
          return json(422, { error_code: 'phone_exists', msg: 'PRIVATE_UPSTREAM_SENTINEL' })
        if (data.password) state.password = data.password
      }
      return json(200, {
        id,
        phone: '86' + state.phone,
        phone_confirmed_at: '2026-11-18T00:00:00Z',
        new_phone: data?.phone || ''
      })
    }
    if (url.pathname === '/auth/v1/logout') return json(200, {})
    if (url.pathname === '/rest/v1/rpc/fishing_read' && data?.action === 'profile') {
      if (state.profileGate) await state.profileGate
      return json(200, {
        profile: { id, handle: 'DY000000000001', nickname: '水边的钓友' },
        posts: []
      })
    }
    if (url.pathname.startsWith('/rest/v1/')) return json(200, [], { 'content-range': '0-0/0' })
    return json(404, {})
  })
  const page = await context.newPage()
  page.setDefaultTimeout(12_000)
  page.on('pageerror', (e) => state.errors.push(e.message))
  return { page, context, state }
}
async function open(page, route) {
  await page.goto(base + '/#/' + route, { waitUntil: 'networkidle' })
  await page.locator('.fishing-page').waitFor()
}
async function text(page, value) {
  await page.getByText(value, { exact: true }).first().waitFor()
}
async function shot(page, name) {
  await page.waitForFunction(() => !document.querySelector('.mobile-action--pressed'))
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  )
  await page.screenshot({ path: resolve(output, name + '.png'), fullPage: true })
  screenshots.push(name + '.png')
}
async function layout(page, name) {
  const value = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    controls: [
      ...document.querySelectorAll(
        '.account-content input,.account-content .primary,.account-content .account-send,.login-content input,.login-content .primary,.login-content .login-send,.mobile-field__reveal'
      )
    ]
      .filter((e) => e.getBoundingClientRect().width)
      .map((e) => {
        const r = e.getBoundingClientRect()
        return {
          width: r.width,
          height: r.height,
          left: r.left,
          right: r.right,
          font: parseFloat(getComputedStyle(e).fontSize)
        }
      })
  }))
  assert.ok(value.scroll <= value.width + 1, name + ' overflow')
  for (const c of value.controls) {
    assert.ok(c.height >= 44, name + ' touch size')
    assert.ok(c.left >= -1 && c.right <= value.width + 1, name + ' clipped control')
  }
  metrics.push({ name, ...value })
}
async function centeredLoginSwitch(page, name) {
  const value = await page.locator('.login-switch').evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const button = el.getBoundingClientRect(),
      text = range.getBoundingClientRect(),
      column = el.parentElement.getBoundingClientRect()
    return {
      buttonCenter: button.x + button.width / 2,
      textCenter: text.x + text.width / 2,
      columnCenter: column.x + column.width / 2
    }
  })
  assert.ok(
    Math.abs(value.textCenter - value.buttonCenter) <= 1,
    name + ' text is not centered inside button'
  )
  assert.ok(
    Math.abs(value.textCenter - value.columnCenter) <= 1,
    name + ' text is not centered in form'
  )
  metrics.push({ name: name + '-switch-text-centers', ...value })
}
async function check(name, signedIn, action) {
  const h = await setup(signedIn)
  try {
    await action(h)
    assert.deepEqual(h.state.errors, [], 'no browser runtime errors')
    assert.deepEqual(h.state.blocked, [], 'no unplanned external requests')
    assert.ok(!(await h.page.locator('body').innerText()).includes('PRIVATE_UPSTREAM_SENTINEL'))
    results.push({
      name,
      status: 'PASS',
      authRequests: h.state.requests
        .filter((r) => r.path.startsWith('/auth/'))
        .map((r) => ({ method: r.method, path: r.path }))
    })
    console.log('PASS ' + name)
  } catch (error) {
    results.push({ name, status: 'FAIL', error: String(error.stack || error) })
    console.log('FAIL ' + name + ': ' + error.message)
    await shot(h.page, 'failure-' + name).catch(() => {})
  } finally {
    await h.context.close()
  }
}
const field = (page, label) => page.locator(`input[aria-label="${label}"]`)
const button = (page, label) => page.getByRole('button', { name: label, exact: true })
async function code(page) {
  await field(page, '短信验证码').fill('010203')
  await page.waitForTimeout(80)
  await button(page, '验证并继续').click()
}

try {
  await check('auth-200-percent-text-and-accessibility', false, async ({ page, state }) => {
    const contrast = (a, b) => {
      const luminance = (hex) => {
        const channels = hex
          .replace('#', '')
          .match(/../g)
          .map((v) => parseInt(v, 16) / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
      }
      const x = luminance(a),
        y = luminance(b)
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
    }
    for (const mode of ['sms', 'password', 'reset']) {
      await open(page, mode === 'reset' ? 'pages/account/password?mode=reset' : 'pages/login/index')
      if (mode === 'password') await button(page, '使用密码登录').click()
      if (mode !== 'reset') await centeredLoginSwitch(page, mode + '-normal')
      await (
        await page.addStyleTag({ content: 'html{font-size:32px!important}' })
      ).evaluate((e) => {
        e.id = 'auth-200-text'
      })
      for (const width of [320, 375, 440]) {
        await page.setViewportSize({ width, height: 900 })
        await layout(page, `${mode}-200-${width}`)
        if (mode !== 'reset') await centeredLoginSwitch(page, `${mode}-200-${width}`)
        await shot(page, `${mode}-200-${width}`)
      }
      await page.setViewportSize({ width: 320, height: 900 })
      for (const scheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: scheme })
        const colors = await page.locator('.fishing-page').evaluate((e) => {
          const css = getComputedStyle(e)
          return Object.fromEntries(
            ['ink', 'reed', 'mist', 'lake', 'on-lake', 'onLake', 'paper', 'lake-soft'].map((k) => [
              k,
              css.getPropertyValue('--' + k).trim()
            ])
          )
        })
        const pairs = [
          ['ink', 'mist'],
          ['reed', 'mist'],
          ['lake', 'paper'],
          [colors['onLake'] ? 'onLake' : 'on-lake', 'lake']
        ]
        const ratios = pairs.map(([a, b]) => ({
          pair: a + '/' + b,
          ratio: contrast(colors[a], colors[b])
        }))
        for (const value of ratios)
          assert.ok(value.ratio >= 4.5, value.pair + ' contrast below 4.5')
        metrics.push({ name: `${mode}-${scheme}-contrast`, colors, ratios })
        await shot(page, `${mode}-200-${scheme}`)
      }
      await page.keyboard.press('Tab')
      const input = field(page, mode === 'password' ? '登录密码' : '短信验证码')
      await input.focus()
      assert.equal(await input.getAttribute('aria-required'), 'true')
      assert.ok(await input.getAttribute('aria-label'))
      await shot(page, `${mode}-200-focus`)
      await page.locator('#auth-200-text').evaluateAll((es) => es.forEach((e) => e.remove()))
      await page.emulateMedia({ colorScheme: 'light' })
    }
    assert.equal(state.requests.length, 0, 'review must not send OTP requests')
  })
  await check('password-login-visibility-errors-and-session', false, async ({ page, state }) => {
    await open(page, 'pages/login/index')
    await button(page, '使用密码登录').click()
    await field(page, '账号或手机号').fill(oldPhone)
    const password = field(page, '登录密码')
    assert.equal(await password.getAttribute('autocomplete'), 'current-password')
    await password.fill('FixturePassword1')
    const centers = await page.locator('.mobile-field__input-wrap--secret').evaluate((e) => {
      const input = e.querySelector('.mobile-field__control').getBoundingClientRect()
      const icon = e.querySelector('.wd-icon').getBoundingClientRect()
      return { input: input.top + input.height / 2, icon: icon.top + icon.height / 2 }
    })
    assert.ok(Math.abs(centers.input - centers.icon) <= 2, 'password eye must be centered')
    assert.equal(await password.getAttribute('type'), 'password')
    await button(page, '显示密码').click()
    assert.equal(await password.getAttribute('type'), 'text')
    await button(page, '隐藏密码').click()
    state.passwordError = true
    await button(page, '登录').click()
    await text(page, '账号、手机号或密码不正确，可使用短信登录')
    assert.equal(await password.inputValue(), 'FixturePassword1')
    await shot(page, 'password-login-error-375')
    state.passwordError = false
    await button(page, '登录').click()
    await page.waitForFunction(() =>
      (localStorage.getItem('dyj.auth.v1') || '').includes('fixture-refresh-password')
    )
    assert.ok(
      !(await page.evaluate(() => localStorage.getItem('dyj.auth.v1'))).includes('FixturePassword1')
    )
    assert.equal(state.requests.filter((r) => r.path === '/auth/v1/otp').length, 0)
  })
  await check('password-login-responsive-dark-large-focus', false, async ({ page, state }) => {
    await open(page, 'pages/login/index')
    await button(page, '使用密码登录').click()
    for (const [width, height] of [
      [320, 760],
      [375, 812],
      [440, 956],
      [844, 390],
      [1280, 900]
    ]) {
      await page.setViewportSize({ width, height })
      await centeredLoginSwitch(page, 'password-' + width)
      await shot(page, 'password-login-' + width)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
      assert.equal(overflow, false)
    }
    await page.setViewportSize({ width: 375, height: 812 })
    await page.emulateMedia({ colorScheme: 'dark' })
    await shot(page, 'password-login-dark')
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addStyleTag({ content: 'html{font-size:24px!important}' })
    await shot(page, 'password-login-large')
    await page.keyboard.press('Tab')
    await button(page, '显示密码').focus()
    const focus = await button(page, '显示密码').evaluate((e) => ({
      outline: getComputedStyle(e).outlineStyle,
      height: e.getBoundingClientRect().height
    }))
    assert.notEqual(focus.outline, 'none')
    assert.ok(focus.height >= 44)
    await shot(page, 'password-visibility-focus')
    assert.equal(state.requests.length, 0)
  })
  await check(
    'remember-password-success-only-logout-restore-and-opt-out',
    false,
    async ({ page, state }) => {
      await open(page, 'pages/login/index')
      await button(page, '使用密码登录').click()
      const remember = page.getByRole('checkbox', { name: '记住密码', exact: true })
      assert.equal(await remember.getAttribute('aria-checked'), 'false')
      await field(page, '账号或手机号').fill(oldPhone)
      await field(page, '登录密码').fill('FixturePassword1')
      await remember.getByText('记住密码', { exact: true }).click()
      assert.equal(await remember.getAttribute('aria-checked'), 'true')
      state.passwordError = true
      await button(page, '登录').click()
      await text(page, '账号、手机号或密码不正确，可使用短信登录')
      assert.equal(state.browserPasswordWrites, 0, 'failed authentication must not save a password')
      assert.equal(await page.evaluate(() => localStorage.getItem('dyj.login.preference.v1')), null)
      state.passwordError = false
      await button(page, '登录').click()
      await page.waitForFunction(() => !!localStorage.getItem('dyj.login.preference.v1'))
      assert.equal(state.browserPasswordWrites, 1)
      assert.equal(
        (await page.evaluate(() => JSON.stringify(localStorage))).includes('FixturePassword1'),
        false,
        'password stays out of all app web storage'
      )
      await open(page, 'pages/settings/index')
      await button(page, '退出登录').click()
      await button(page, '清除草稿并退出').click()
      await page.waitForFunction(() => !localStorage.getItem('dyj.auth.v1'))
      await page.waitForURL((url) => url.hash === '#/' || url.hash.startsWith('#/pages/home'))
      await page.getByRole('navigation', { name: '主导航' }).waitFor()
      const grants = state.requests.filter((r) => r.path.startsWith('/auth/v1/token')).length
      await open(page, 'pages/login/index')
      await text(page, '密码登录')
      await page.waitForFunction(
        () => document.querySelector('input[aria-label="登录密码"]')?.value === 'FixturePassword1'
      )
      assert.equal(await field(page, '账号或手机号').inputValue(), oldPhone)
      assert.equal(await field(page, '登录密码').getAttribute('type'), 'password')
      assert.equal(
        await page
          .getByRole('checkbox', { name: '记住密码', exact: true })
          .getAttribute('aria-checked'),
        'true'
      )
      assert.equal(
        state.requests.filter((r) => r.path.startsWith('/auth/v1/token')).length,
        grants,
        'restoring never submits authentication'
      )
      const alignment = await page.evaluate(() => {
        const a = document
          .querySelector('.login-remember .mobile-checkbox__indicator')
          .getBoundingClientRect()
        const b = document
          .querySelector('.login-consent .mobile-checkbox__indicator')
          .getBoundingClientRect()
        const remember = document.querySelector('.login-remember').getBoundingClientRect()
        const forgot = document.querySelector('.login-forgot').getBoundingClientRect()
        const agreement = document.querySelector('.login-agreement').getBoundingClientRect()
        return {
          sameSize: a.width === b.width && a.height === b.height,
          left: Math.abs(a.x - b.x),
          centers: Math.abs(remember.y + remember.height / 2 - forgot.y - forgot.height / 2),
          gap: agreement.y - remember.bottom,
          height: remember.height
        }
      })
      assert.ok(
        alignment.sameSize &&
          alignment.left <= 1 &&
          alignment.centers <= 1 &&
          alignment.gap >= 7 &&
          alignment.gap <= 9 &&
          alignment.height >= 48
      )
      metrics.push({ name: 'remember-checkbox-alignment-and-spacing', ...alignment })
      await shot(page, 'remember-password-375')
      await button(page, '显示密码').click()
      await button(page, '用户协议').click()
      await page.getByRole('button', { name: '返回上一页', exact: true }).last().click()
      await page.waitForFunction(
        () => document.querySelector('input[aria-label="登录密码"]')?.value === 'FixturePassword1'
      )
      assert.equal(
        await field(page, '登录密码').getAttribute('type'),
        'password',
        'returning from a help page masks the restored password'
      )
      await page.getByRole('checkbox', { name: '记住密码', exact: true }).click()
      await page.waitForFunction(() => !localStorage.getItem('dyj.login.preference.v1'))
      await page.reload({ waitUntil: 'networkidle' })
      await text(page, '手机号登录')
      assert.equal(await field(page, '账号或手机号').count(), 0)
    }
  )
  await check('handle-password-login-and-switch-back-to-sms', false, async ({ page, state }) => {
    await open(page, 'pages/login/index')
    await button(page, '使用密码登录').click()
    const identifier = field(page, '账号或手机号')
    assert.equal(await identifier.getAttribute('autocomplete'), 'username')
    assert.equal(await identifier.getAttribute('inputmode'), 'text')
    await identifier.fill('dy000000000001')
    await field(page, '登录密码').fill('FixturePassword1')
    await shot(page, 'handle-password-login-375')
    await button(page, '使用短信验证码登录').click()
    assert.equal(
      await field(page, '手机号码').inputValue(),
      '',
      'a handle cannot become an SMS destination'
    )
    await button(page, '使用密码登录').click()
    await field(page, '账号或手机号').fill('dy000000000001')
    await field(page, '登录密码').fill('FixturePassword1')
    state.passwordError = true
    await button(page, '登录').click()
    await text(page, '账号、手机号或密码不正确，可使用短信登录')
    state.passwordError = false
    await button(page, '登录').click()
    await page.waitForFunction(() =>
      (localStorage.getItem('dyj.auth.v1') || '').includes('fixture-refresh-handle')
    )
    assert.equal(state.requests.filter((r) => r.path === '/auth/v1/otp').length, 0)
    assert.equal(state.requests.filter((r) => r.path.startsWith('/auth/v1/token')).length, 0)
  })
  await check('forgot-password-end-to-end-and-autofill', false, async ({ page, state }) => {
    await open(page, 'pages/login/index')
    await button(page, '使用密码登录').click()
    await button(page, '忘记密码').click()
    await text(page, '验证手机号')
    await field(page, '手机号码').fill(oldPhone)
    await button(page, '获取验证码').click()
    const otp = field(page, '短信验证码')
    assert.equal(await otp.getAttribute('autocomplete'), 'one-time-code')
    assert.equal(await otp.getAttribute('type'), 'text')
    await otp.evaluate((e) => {
      e.value = '010203'
      e.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertReplacementText',
          data: '010203'
        })
      )
    })
    await page.waitForTimeout(100)
    assert.equal(await otp.inputValue(), '010203')
    await button(page, '验证并继续').click()
    await text(page, '设置新密码')
    assert.equal(
      await page.evaluate(() => localStorage.getItem('dyj.auth.v1')),
      null,
      'temporary verification must not persist'
    )
    await field(page, '新密码').fill('FixturePassword1')
    await field(page, '确认新密码').fill('Mismatch1')
    await button(page, '保存密码并登录').click()
    await text(page, '两次输入的密码不一致')
    await shot(page, 'reset-password-mismatch')
    await field(page, '确认新密码').fill('FixturePassword1')
    await button(page, '保存密码并登录').click()
    await text(page, '密码已设置')
    assert.equal(state.password, 'FixturePassword1')
    assert.equal(state.requests.find((r) => r.path === '/auth/v1/otp').data.create_user, false)
    await shot(page, 'reset-password-success')
  })
  await check(
    'account-security-page-and-signed-in-password',
    true,
    async ({ page, context, state }) => {
      await open(page, 'pages/account/security')
      await text(page, '138 **** 0000')
      await text(page, 'DY000000000001')
      await context.grantPermissions(['geolocation', 'clipboard-read', 'clipboard-write'], { origin: base })
      await button(page, '复制钓友号').click()
      await text(page, '钓友号已复制')
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'DY000000000001')
      await shot(page, 'account-security-375')
      await page.setViewportSize({ width: 320, height: 900 })
      await page.emulateMedia({ colorScheme: 'dark' })
      const large = await page.addStyleTag({ content: 'html{font-size:32px!important}' })
      await layout(page, 'account-security-200-dark-320')
      await shot(page, 'account-security-200-dark-320')
      await large.evaluate((e) => e.remove())
      await page.setViewportSize({ width: 375, height: 812 })
      await page.emulateMedia({ colorScheme: 'light' })
      await page.getByRole('button', { name: /登录密码.*通过短信/ }).click()
      await text(page, '当前手机号')
      assert.equal(
        await field(page, '手机号码').count(),
        0,
        'bound phone derives from authenticated account'
      )
      await code(page)
      await text(page, '设置新密码')
      await field(page, '新密码').fill('FixturePassword1')
      await field(page, '确认新密码').fill('FixturePassword1')
      await button(page, '保存新密码').click()
      await text(page, '密码已设置')
      assert.equal(
        JSON.parse(await page.evaluate(() => localStorage.getItem('dyj.auth.v1'))).data.user.id,
        id
      )
      assert.equal(state.requests.filter((r) => r.path.includes('signup')).length, 0)
    }
  )
  const recent = session()
  recent.access_token =
    'fixture.' +
    Buffer.from(
      JSON.stringify({
        sub: id,
        phone: '86' + oldPhone,
        amr: [{ method: 'otp', timestamp: Math.floor(Date.now() / 1000) }]
      })
    ).toString('base64url') +
    '.fixture-only'
  await check(
    'fresh-sms-login-opens-password-setup-without-another-code',
    recent,
    async ({ page, state }) => {
      await open(page, 'pages/account/password?mode=set')
      await text(page, '设置新密码')
      assert.equal(await field(page, '短信验证码').count(), 0)
      await field(page, '新密码').fill('FixturePassword1')
      await field(page, '确认新密码').fill('FixturePassword1')
      await button(page, '保存新密码').click()
      await text(page, '密码已设置')
      assert.equal(
        state.requests.filter((r) => r.path === '/auth/v1/otp' || r.path === '/auth/v1/verify')
          .length,
        0,
        'reuse verified session, no charged resend'
      )
    }
  )
  await check('phone-change-conflict-then-complete-same-account', true, async ({ page, state }) => {
    await open(page, 'pages/account/phone')
    await code(page)
    await text(page, '验证新手机号')
    await field(page, '手机号码').fill(newPhone)
    state.conflict = true
    await button(page, '获取验证码').click()
    await text(page, '手机号已被其他账号使用，请换一个号码')
    await shot(page, 'phone-change-conflict')
    state.conflict = false
    await button(page, '获取验证码').click()
    await field(page, '短信验证码').fill('010203')
    await button(page, '确认换绑').click()
    await text(page, '手机号已换绑')
    const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('dyj.auth.v1'))).data
    assert.equal(saved.user.id, id)
    assert.equal(saved.user.phone, '86' + newPhone)
    assert.equal(
      state.requests.filter((r) => r.path === '/auth/v1/verify').at(-1).data.type,
      'phone_change'
    )
    await shot(page, 'phone-change-success')
  })
  await check(
    'phone-verification-wrong-code-rate-limit-recovery',
    true,
    async ({ page, state }) => {
      await page.clock.install()
      await open(page, 'pages/account/phone')
      state.wrongCode = true
      await code(page)
      await text(page, '验证码错误或已过期，请重新获取')
      assert.equal(await field(page, '短信验证码').inputValue(), '010203')
      state.otpRate = true
      await button(page, '获取验证码').click()
      await text(page, '验证码发送过于频繁，请稍后再试')
      await page.getByRole('button', { name: /125 秒后重发/ }).waitFor()
      await shot(page, 'phone-code-rate-limit')
      await page.clock.fastForward(126_000)
      state.otpRate = false
      state.wrongCode = false
      await button(page, '获取验证码').click()
      await button(page, '验证并继续').click()
      await text(page, '验证新手机号')
    }
  )
  await check('security-forms-all-viewport-states', true, async ({ page }) => {
    for (const route of [
      'pages/account/security',
      'pages/account/password?mode=set',
      'pages/account/phone'
    ]) {
      await page
        .locator('style[data-account-large]')
        .evaluateAll((es) => es.forEach((e) => e.remove()))
      await open(page, route)
      await page.locator('.account-title').waitFor()
      for (const [width, height] of [
        [320, 760],
        [375, 812],
        [440, 956],
        [844, 390],
        [1280, 900]
      ]) {
        await page.setViewportSize({ width, height })
        const name = route.split('/').at(-1).replace('?mode=set', '') + '-' + width
        await layout(page, name)
        await shot(page, name)
      }
      await page.setViewportSize({ width: 320, height: 760 })
      await page.emulateMedia({ colorScheme: 'dark' })
      await layout(page, route + '-dark')
      await shot(page, route.split('/').at(-1).replace('?mode=set', '') + '-dark')
      await page.emulateMedia({ colorScheme: 'light' })
      await (
        await page.addStyleTag({ content: 'html{font-size:24px!important}' })
      ).evaluate((e) => {
        e.setAttribute('data-account-large', 'true')
      })
      await layout(page, route + '-large')
      await shot(page, route.split('/').at(-1).replace('?mode=set', '') + '-large')
    }
    await open(page, 'pages/account/password?mode=set')
    await code(page)
    await text(page, '设置新密码')
    await layout(page, 'new-password-large-320')
    await shot(page, 'new-password-large-320')
    await field(page, '新密码').focus()
    await shot(page, 'new-password-focus')
  })
  await check(
    'leaving-pending-verification-never-persists-session',
    false,
    async ({ page, state }) => {
      await open(page, 'pages/account/password?mode=reset')
      await field(page, '手机号码').fill(oldPhone)
      let release
      state.verifyGate = new Promise((done) => {
        release = done
      })
      await field(page, '短信验证码').fill('010203')
      await button(page, '验证并继续').click()
      await page.waitForTimeout(100)
      await page.evaluate(() => {
        window.location.hash = '/pages/home/index'
      })
      release()
      await page.waitForTimeout(400)
      assert.equal(await page.evaluate(() => localStorage.getItem('dyj.auth.v1')), null)
    }
  )
  await check(
    'verification-survives-help-navigation-with-countdown',
    true,
    async ({ page, state }) => {
      await open(page, 'pages/account/phone')
      await text(page, '当前手机号')
      await button(page, '获取验证码').click()
      await field(page, '短信验证码').fill('010203')
      await button(page, '原手机号无法接收短信？联系运营者').click()
      await page.getByRole('button', { name: '返回上一页', exact: true }).click()
      assert.equal(await field(page, '短信验证码').inputValue(), '010203')
      await page.getByRole('button', { name: /\d+ 秒后重发/ }).waitFor()
      assert.equal(state.requests.filter((r) => r.path === '/auth/v1/otp').length, 1)
    }
  )
  await check(
    'account-switch-clears-private-verification-and-reload-retains-login',
    true,
    async ({ page }) => {
      await open(page, 'pages/account/phone')
      await code(page)
      await text(page, '验证新手机号')
      await page.evaluate(
        (value) => {
          const key = 'dyj.auth.v1',
            raw = JSON.stringify({ type: 'object', data: value })
          localStorage.setItem(key, raw)
          window.dispatchEvent(new StorageEvent('storage', { key, newValue: raw }))
        },
        {
          ...session(newPhone, '-B'),
          user: { id: '33333333-3333-4333-8333-333333333333', phone: '86' + newPhone }
        }
      )
      await text(page, '账号状态已变化，请重新打开页面')
      assert.equal(await field(page, '短信验证码').count(), 0)
      assert.ok(!(await page.locator('.account-content').innerText()).includes('138 **** 0000'))
      await page.reload({ waitUntil: 'networkidle' })
      const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('dyj.auth.v1'))).data
      assert.equal(saved.user.id, '33333333-3333-4333-8333-333333333333')
    }
  )
  await check(
    'account-switch-during-profile-load-never-reveals-previous-identity',
    true,
    async ({ page, state }) => {
      let release
      state.profileGate = new Promise((resolve) => {
        release = resolve
      })
      await page.goto(base + '/#/pages/account/security', { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => document.body.textContent.includes('正在读取账号'))
      const deadline = Date.now() + 12000
      while (
        !state.requests.some(
          (r) => r.path === '/rest/v1/rpc/fishing_read' && r.data?.action === 'profile'
        )
      ) {
        if (Date.now() > deadline) throw new Error('profile request did not start')
        await page.waitForTimeout(20)
      }
      await page.evaluate(
        (value) => {
          const key = 'dyj.auth.v1',
            raw = JSON.stringify({ type: 'object', data: value })
          localStorage.setItem(key, raw)
          window.dispatchEvent(new StorageEvent('storage', { key, newValue: raw }))
        },
        {
          ...session(newPhone, '-B'),
          user: { id: '33333333-3333-4333-8333-333333333333', phone: '86' + newPhone }
        }
      )
      await text(page, '请重新登录后再管理账号')
      release()
      await page.waitForLoadState('networkidle')
      const content = await page.locator('.account-content').innerText()
      assert.ok(
        !content.includes('138 **** 0000') && !content.includes('DY000000000001'),
        'late old profile must never appear for the new account'
      )
    }
  )
} finally {
  writeFileSync(
    resolve(output, 'results.json'),
    JSON.stringify(
      {
        scope:
          'Local H5 with intercepted Auth contracts only; no remote SMS or account mutation. Native Keychain and device keyboard require physical-device verification.',
        realSmsSent: 0,
        results,
        metrics,
        screenshots
      },
      null,
      2
    )
  )
  await browser.close()
  await new Promise((done) => server.close(done))
}
const failed = results.filter((r) => r.status === 'FAIL')
console.log(
  `${results.length - failed.length}/${results.length} account security checks passed. Evidence: ${output}`
)
if (failed.length) process.exitCode = 1
