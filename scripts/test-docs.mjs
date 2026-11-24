import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { createDocsServer } from './preview-docs.mjs'
import { setH5TextScale } from './h5-text-scale.mjs'

const output = resolve('artifacts/github-pages')
mkdirSync(output, { recursive: true })
const files = JSON.parse(readFileSync('docs/.pages-assets.json', 'utf8'))
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL === 'bundled'
    ? {}
    : { channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
})
const results = []
try {
  for (const base of ['/', '/supabase-mobile-fishing/']) {
    const server = createDocsServer({ base })
    await new Promise((done) => server.listen(0, '0.0.0.0', done))
    const origin = `http://127.0.0.1:${server.address().port}`
    const site = origin + base
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      locale: 'zh-CN',
      permissions: ['geolocation'],
      geolocation: { longitude: 120.12, latitude: 31.12, accuracy: 100 },
      reducedMotion: 'reduce',
      colorScheme: 'light'
    })
    const errors = [],
      missing = [],
      blocked = new Set()
    // Fixed browser test coordinates unlock the existing location gate. This is
    // static/UI acceptance, not real GPS. No fabricated data, login, SMS, map
    // response or remote writes; hosted API checks are separate.
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url())
      if (url.origin === origin || !url.protocol.startsWith('http')) return route.continue()
      blocked.add(url.origin)
      return route.abort()
    })
    await context.routeWebSocket(/.*/, (socket) => socket.close())
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('response', (response) => {
      if (new URL(response.url()).origin === origin && response.status() >= 400)
        missing.push(new URL(response.url()).pathname)
    })
    const variant = base === '/' ? 'root' : 'repository'
    const checks = []
    async function go(path) {
      await page.goto(`${site}#${path}`, { waitUntil: 'networkidle' })
      await page.locator('.fishing-page').waitFor()
      assert.equal(new URL(page.url()).pathname, base, 'route escaped the Pages base')
    }
    async function capture(name) {
      await page.evaluate(async () => {
        await document.fonts.ready
      })
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `${name}: overflow`
      )
      assert.ok(await page.locator('body').innerText(), `${name}: blank page`)
      await page.screenshot({
        path: resolve(output, `${variant}-${name}.png`),
        fullPage: (await page.getByRole('dialog').count()) === 0
      })
    }
    try {
      // Every generated asset is served at the repository path, including lazy
      // chunks, workers, WASM, fonts, brand images and shoreline tiles.
      for (const name of files.filter((name) => !name.startsWith('.'))) {
        const response = await fetch(site + name, { method: 'HEAD' })
        assert.equal(response.status, 200, `Missing generated asset: ${name}`)
      }
      assert.equal((await fetch(site + 'missing-file.js')).status, 404)
      assert.equal((await fetch(site + 'pages/settings/index')).status, 404)
      assert.equal((await fetch(site + '.env.local')).status, 404)
      if (base !== '/')
        assert.equal((await fetch(origin + '/static/brand/favicon.png')).status, 404)
      checks.push(
        `all ${files.length - 1} public assets served; missing files return 404 without SPA fallback`
      )

      await go('/pages/home/index')
      await capture('home-375')
      await go('/pages/settings/index')
      await page.getByRole('button', { name: '隐私说明', exact: true }).click()
      await page.waitForURL((url) => url.hash.includes('/pages/settings/legal'))
      await page.reload({ waitUntil: 'networkidle' })
      await page.locator('.fishing-page').waitFor()
      assert.equal(new URL(page.url()).pathname, base)
      checks.push('home boot, lazy page navigation and hash deep-link reload')

      await go('/pages/login/index')
      assert.equal(await page.getByText('进入本机体验', { exact: true }).count(), 0)
      await capture('login-375')
      checks.push('live login entry; no demo fallback or authentication attempts')

      await go('/pages/water-report/index')
      const region = page.locator('#report-region')
      await region.waitFor()
      await page.keyboard.press('Tab')
      await region.focus()
      assert.ok(
        await region.evaluate(
          (el) => document.activeElement === el && getComputedStyle(el).outlineStyle !== 'none'
        )
      )
      await capture('keyboard-focus')
      await region.press('Enter')
      const dialog = page.getByRole('dialog', { name: '选择事发地区', exact: true })
      await dialog.waitFor()
      await capture('region-sheet-375')
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      assert.ok(await region.evaluate((el) => document.activeElement === el))
      checks.push('keyboard focus, region sheet, Escape and focus restoration')

      if (base !== '/') {
        for (const [width, height, dark, font] of [
          [320, 740, false, 16],
          [375, 812, false, 16],
          [440, 956, false, 16],
          [812, 375, false, 16],
          [1280, 800, false, 16],
          [375, 812, true, 16],
          [320, 740, true, 24],
          [375, 812, true, 32]
        ]) {
          await page.setViewportSize({ width, height })
          await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' })
          await go('/pages/settings/index')
          await setH5TextScale(page, font)
          await capture(`settings-${width}x${height}-${dark ? 'dark' : 'light'}-${font}`)
          if (font === 32) {
            await go('/pages/water-report/index')
            await setH5TextScale(page, font)
            await page.locator('#report-region').click()
            await dialog.waitFor()
            await capture('region-sheet-dark-200-percent')
            await page.keyboard.press('Escape')
            await dialog.waitFor({ state: 'hidden' })
          }
        }
        checks.push('320/375/440, landscape, wide, dark, 150% and 200% text screenshots')
      }
      assert.deepEqual(
        missing,
        [],
        'No requests may escape the repository base or miss local assets'
      )
      assert.deepEqual(errors, [], 'No uncaught browser errors')
      checks.push('zero missing browser assets and uncaught errors')
      results.push({
        base,
        checks,
        externalRequests: 'blocked, not simulated',
        blockedOrigins: [...blocked]
      })
      console.log(`PASS ${base}: ${checks.join('; ')}`)
    } finally {
      await context.close()
      await new Promise((done) => server.close(done))
    }
  }
} finally {
  await browser.close()
  writeFileSync(
    resolve(output, 'results.json'),
    JSON.stringify(
      {
        scope:
          'Compiled docs, plain static HTTP, fixed browser geolocation; no remote service, real GPS or native-device acceptance',
        results
      },
      null,
      2
    ) + '\n'
  )
}
