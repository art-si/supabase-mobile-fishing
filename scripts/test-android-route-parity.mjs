import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _android } from 'playwright'
import { routeLayoutAudit } from './visual-audit.mjs'
import { allowPublicReads } from './live-h5.mjs'

const serial = process.env.ANDROID_SERIAL
assert.ok(/^emulator-\d+$/.test(serial || ''), 'Select an isolated QA emulator with ANDROID_SERIAL')
const device = (await _android.devices()).find(candidate => candidate.serial() === serial)
assert.ok(device, 'Selected emulator is not connected')
const output = resolve(process.env.UI_OUTPUT_DIR || 'artifacts/android-routes')
await mkdir(output, { recursive: true })
try {
  const page = await (await device.webView({ pkg: 'com.diaoyouji.fishing.uiqa' })).page()
  const exceptions = []
  page.on('pageerror', error => exceptions.push(error.message))
  await allowPublicReads(page.context(), 'https://localhost')
  const go = route => page.goto(`https://localhost/#${route}`)
  await go('/pages/home/index')
  await page.locator('.fishing-page').waitFor()
  const environment = await page.evaluate(() => ({
    platform: window.Capacitor.getPlatform(), native: window.Capacitor.isNativePlatform(),
    dark: matchMedia('(prefers-color-scheme: dark)').matches, width: innerWidth, height: innerHeight,
    dpr: devicePixelRatio, userAgent: navigator.userAgent
  }))
  assert.equal(environment.native && environment.platform, 'android')
  const nightMode = (await device.shell('cmd uimode night')).toString().trim()
  const fontScale = (await device.shell('settings get system font_scale')).toString().trim()
  const api = (await device.shell('getprop ro.build.version.sdk')).toString().trim()
  if (/\b(?:yes|no)\b/i.test(nightMode)) assert.equal(environment.dark, /\byes\b/i.test(nightMode), 'WebView follows Android night mode')
  const report = await routeLayoutAudit({ page, go,
    overflow: async label => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label),
    screenshot: file => device.screenshot({ path: resolve(output, file) })
  }, [[environment.dark ? 'android-dark' : 'android-light']])
  await go('/pages/login/index')
  const field = page.locator('input:visible').first()
  await field.click()
  let keyboard = false
  for (let attempt = 0; attempt < 12 && !keyboard; attempt++) {
    keyboard = /mInputShown=true/.test((await device.shell('dumpsys input_method')).toString())
    if (!keyboard) await new Promise(done => setTimeout(done, 250))
  }
  assert.ok(keyboard, 'Android IME is actually shown')
  assert.ok(await field.evaluate(input => document.activeElement === input && input.getBoundingClientRect().bottom <= (visualViewport?.height ?? innerHeight) + (visualViewport?.offsetTop ?? 0) + 1), 'focused login field stays above IME')
  await device.screenshot({ path: resolve(output, 'native-keyboard.png') })
  await device.shell('input keyevent 4')
  assert.deepEqual(exceptions, [])
  await writeFile(resolve(output, 'routes.json'), JSON.stringify({ ...report, environment, nightMode, fontScale, api, keyboard, exceptions }, null, 2))
  console.log(`PASS ${report.results.length} Android WebView route captures and native IME (${nightMode}, font scale ${fontScale})`)
} finally { await device.close() }
