import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
import { chromium, webkit } from 'playwright'
import { allowPublicReads, liveH5Smoke } from './live-h5.mjs'
import { loginLocalH5 } from './ui-contract-target.mjs'
import { appearanceContract } from './appearance-contract.mjs'
import { draftContract } from './draft-contract.mjs'
import { confirmationContract } from './confirmation-contract.mjs'
import { packageRoutesContract } from './package-routes-contract.mjs'
import { mapContract } from './map-contract.mjs'
import { routeLayoutAudit, visualAudit } from './visual-audit.mjs'
import { moderationContract } from './moderation-contract.mjs'
import { sessionContract } from './session-contract.mjs'
import { authorContract } from './author-contract.mjs'
import { waterReportContract } from './water-report-contract.mjs'
import { miniappAlignmentContract } from './miniapp-alignment-contract.mjs'
import { componentParityContract } from './component-parity-contract.mjs'
import { uiPolishContract } from './ui-polish-contract.mjs'

// Tests the compiled output, not the development server. A successful build must boot.
const unconfiguredLive = process.argv.includes('--unconfigured-live')
const root = resolve(process.env.H5_BUILD_DIR || 'dist/build/h5')
assert.ok(existsSync(resolve(root, 'index.html')), 'Run pnpm build:h5 first')
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
await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const visualOnly = process.argv.includes('--visual-audit-only')
const output = resolve(process.env.UI_OUTPUT_DIR || (visualOnly ? 'artifacts/visual-optimization' : 'artifacts/h5'))
mkdirSync(output, { recursive: true })
const browser = process.env.PLAYWRIGHT_BROWSER === 'webkit' ? await webkit.launch() : await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL === 'bundled'
    ? {}
    : { channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
})
const context = await browser.newContext({
  viewport: { width: 375, height: 812 },
  locale: 'zh-CN',
  reducedMotion: 'reduce',
  permissions: ['geolocation'], geolocation: { longitude: 114.19, latitude: 30.51 }
})
const page = await context.newPage()
await page.bringToFront()
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
const localChecks = {
  '--ui-polish-contract': uiPolishContract,
  '--component-parity-contract': componentParityContract,
  '--alignment-contract': miniappAlignmentContract,
  '--confirmation-contract': confirmationContract,
  '--appearance-contract': appearanceContract,
  '--visual-audit': visualAudit,
  '--package-routes': packageRoutesContract,
  '--draft-contract': draftContract
}
const localCheck = Object.keys(localChecks).find(flag => process.argv.includes(flag))
try {
  if (process.argv.includes('--routes-only')) {
    await allowPublicReads(context, base)
    const report = await routeLayoutAudit({ page, go, overflow, screenshot })
    writeFileSync(resolve(output, 'routes.json'), JSON.stringify(report, null, 2))
    assert.deepEqual(errors, [])
  } else if (localCheck) {
    await loginLocalH5(page, base)
    const sourceDate = process.env.FISHING_UI_TRIP_DATE
    if (localCheck === '--draft-contract') {
      assert.match(sourceDate || '', /^\d{4}-\d{2}-\d{2}$/, 'Set FISHING_UI_TRIP_DATE to the date of the source trip in the local QA database')
      await go('/pages/mine/library?type=trips')
    }
    await localChecks[localCheck]({ page, go, fill, visible, screenshot, pass, overflow, sourceDate })
    assert.deepEqual(errors, [], 'No uncaught local UI contract errors')
    assert.deepEqual(remoteRequests, [], 'Local UI contracts must not target hosted services')
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
    await allowPublicReads(context, base)
    await liveH5Smoke({ page, go, overflow, screenshot, pass, visual: visualOnly })
    assert.deepEqual(errors, [], 'No uncaught browser errors')
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
