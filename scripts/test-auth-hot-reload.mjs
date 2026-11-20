// Isolated HTTP/session contract against the local Vite server. No hosted requests or writes.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { stat, utimes, mkdir, writeFile } from 'node:fs/promises'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname))
const output = 'artifacts/mine-reports'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'zh-CN' })
const owner = '11111111-1111-4111-8111-111111111111'
const requests = [],
  errors = []
await context.addInitScript(
  ({ owner }) => {
    if (!localStorage.getItem('dyj.auth.v1'))
      localStorage.setItem(
        'dyj.auth.v1',
        JSON.stringify({
          type: 'object',
          data: {
            access_token: 'isolated-hmr-token',
            refresh_token: 'isolated-refresh',
            expires_at: Date.now() / 1000 + 3600,
            user: { id: owner }
          }
        })
      )
    window.__authDocument = crypto.randomUUID()
  },
  { owner }
)
await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
await context.route('**/*', async (route) => {
  const request = route.request(),
    url = new URL(request.url())
  if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
  if (url.origin !== 'https://tlfmfokyhahlpzmpliad.supabase.co') return route.abort()
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*'
  }
  if (request.method() === 'OPTIONS') return route.fulfill({ json: {}, headers })
  const body = request.postDataJSON() || {}
  requests.push({
    path: url.pathname,
    action: body.action,
    signed: request.headers().authorization === 'Bearer isolated-hmr-token'
  })
  const profile = {
    id: owner,
    nickname: '接口验收钓友',
    bio: '本机接口样例',
    city: '苏州市',
    method: '台钓',
    handle: 'DYTEST'
  }
  let json = { items: [], next: null }
  if (body.action === 'profile') json = { profile, posts: [] }
  return route.fulfill({ json, headers })
})
const page = await context.newPage()
page.setDefaultTimeout(90000)
page.on('pageerror', (error) => errors.push(error.message))
const files = await Promise.all(
  ['session.ts', 'http.ts'].map(async (name) => {
    const file = new URL(`../src/services/${name}`, import.meta.url)
    return { file, original: await stat(file) }
  })
)
try {
  await page.goto(`${base}/#/pages/home/index?tab=mine`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  })
  await page.getByText('接口验收钓友', { exact: true }).waitFor()
  await page.waitForFunction(() => !!window.__authDocument)
  for (const { file, original } of files) {
    const before = await page.evaluate(() => window.__authDocument)
    await utimes(file, original.atime, new Date())
    await page.waitForFunction((value) => window.__authDocument !== value, before, {
      timeout: 15000
    })
    await page.getByText('接口验收钓友', { exact: true }).waitFor()
  }
  await page.goto(`${base}/#/pages/water-report/index?tab=records`)
  await page.getByText('还没有保存的上报记录。', { exact: true }).waitFor()
  await page.goto(`${base}/#/pages/content-report/index`)
  await page.getByText('还没有举报记录', { exact: true }).waitFor()
  assert.ok(
    requests
      .filter((value) => value.action === 'water_reports' || value.path.endsWith('fishing_reports'))
      .every((value) => value.signed)
  )
  assert.equal(await page.getByText('请先登录，原账号草稿会保留', { exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  await writeFile(
    `${output}/auth-hmr-result.json`,
    JSON.stringify(
      {
        passed: true,
        requests,
        errors,
        boundary: 'Local Vite HMR and isolated API/session fixtures only; no remote traffic.'
      },
      null,
      2
    )
  )
  console.log(
    'PASS auth module hot update reloads the document, restores the same session and reads both private lists with its token'
  )
} catch (error) {
  await page.screenshot({ path: `${output}/auth-hmr-failure.png`, fullPage: true })
  await writeFile(
    `${output}/auth-hmr-result.json`,
    JSON.stringify({ passed: false, error: error.message, requests, errors }, null, 2)
  )
  throw error
} finally {
  for (const { file, original } of files) await utimes(file, original.atime, original.mtime)
  await context.close()
  await browser.close()
}
