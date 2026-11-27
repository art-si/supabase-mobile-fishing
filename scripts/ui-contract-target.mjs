import assert from 'node:assert/strict'

const sandbox = 'http://127.0.0.1:54321'

export function assertLocalConfig(code) {
  assert.match(code, /\bsupabaseUrl\s*:\s*["']http:\/\/127\.0\.0\.1:54321["']/, 'Build the UI contract against local Supabase at 127.0.0.1:54321, not the hosted project')
}

export async function loginLocalH5(page, base) {
  assert.equal(new URL(base).hostname, '127.0.0.1')
  const { FISHING_UI_ACCOUNT: account, FISHING_UI_PASSWORD: password } = process.env
  assert.ok(account && password, 'Set FISHING_UI_ACCOUNT and FISHING_UI_PASSWORD for a disposable local QA account')
  await page.context().route('**/*', route => {
    const url = new URL(route.request().url())
    return (url.origin === base || url.origin === sandbox) ? route.continue() : route.abort()
  })
  await page.goto(`${base}/#/pages/login/index`)
  const heading = page.getByRole('heading', { name: /^(手机号登录|密码登录)$/ })
  await heading.waitFor()
  if (await heading.innerText() !== '密码登录') await page.getByRole('button', { name: '使用密码登录', exact: true }).click()
  await page.locator('#phone-input').fill(account)
  await page.locator('#login-password-input').fill(password)
  const consent = page.getByRole('checkbox', { name: '同意用户协议与隐私说明' })
  if (await consent.getAttribute('aria-checked') !== 'true') await consent.click()
  await page.locator('.login-actions .primary').first().click()
  await page.waitForURL(url => url.hash === '#/' || url.hash.startsWith('#/pages/home'))
}

export async function requireLocalWechat(client, compiled) {
  assertLocalConfig(compiled)
  const localSession = await client.evaluate(() => {
    const auth = getCurrentPages().at(-1)?.$vm?.$pinia?._s.get('fishing-auth')
    if (!auth?.signedIn) return false
    const token = wx.getStorageSync('dyj.auth.v1')?.access_token || ''
    const encoded = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/') || ''
    if (!encoded) return false
    const data = new Uint8Array(wx.base64ToArrayBuffer(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')))
    return /^http:\/\/(?:127\.0\.0\.1|localhost):54321\/auth\/v1$/.test(JSON.parse(String.fromCharCode(...data)).iss)
  })
  assert.ok(localSession, 'Sign in on the local QA mini program first; hosted accounts are not permitted here')
}
