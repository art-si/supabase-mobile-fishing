import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5179'
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const failures = []
try {
  const page = await browser.newPage({ viewport: { width: 440, height: 956 }, locale: 'zh-CN' })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('requestfailed', (request) => {
    const url = new URL(request.url())
    if (url.hostname === 'jupuypvmgjpnpntfetqv.supabase.co')
      failures.push({ path: url.pathname, error: request.failure()?.errorText })
  })
  const [read] = await Promise.all([
    page.waitForResponse((r) =>
      r.url().includes('jupuypvmgjpnpntfetqv.supabase.co/rest/v1/rpc/fishing_read')
    ),
    page.goto(`${base}/#/pages/home/index`)
  ])
  assert.equal(read.status(), 200, 'live Supabase read must succeed')
  const body = await read.json()
  assert.ok(Array.isArray(body.items))
  assert.equal(await page.getByText('本机体验 · 示例内容，不连接线上', { exact: true }).count(), 0)
  mkdirSync('artifacts/h5', { recursive: true })
  await page.screenshot({ path: resolve('artifacts/h5/live-home-440.png'), fullPage: true })
  await page.goto(`${base}/#/pages/login/index`)
  await page.getByText('登录暂未开放', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '获取验证码', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '先逛逛', exact: true }).isVisible(), true)
  await page.screenshot({ path: resolve('artifacts/h5/live-login-440.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log(
    'PASS live H5 reads the intended Supabase project without demo data; unavailable SMS does not present a non-working form. No user data written.'
  )
} catch (error) {
  console.error('Live H5 request failures (no headers or payloads):', failures)
  throw error
} finally {
  await browser.close()
}
