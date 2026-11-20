// Local UI contract only. No authentication, publication, or device keyboard request is sent.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { setH5TextScale } from './h5-text-scale.mjs'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
const output = 'artifacts/time-picker'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' })
const checks = []
await context.addInitScript(() => localStorage.setItem('dyj.auth.v1', JSON.stringify({ type: 'object', data: {
  access_token: 'isolated-time-ui', refresh_token: 'isolated-time-refresh',
  expires_at: Date.now() / 1000 + 3600, user: { id: '11111111-1111-4111-8111-111111111111' }
} })))
await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
await context.route('https://tlfmfokyhahlpzmpliad.supabase.co/**', (route) => route.fulfill({
  headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
  json: { items: [], profile: { nickname: '隔离界面验收' } }
}))
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
try {
  await page.goto(`${base}/#/pages/post/compose`)
  const trigger = page.getByRole('button', { name: '选择出钓时间', exact: true })
  await page.getByRole('button', { name: '鱼情详情', exact: true }).click()
  await trigger.waitFor()
  const initialText = await trigger.innerText()
  const initialTime = initialText.match(/(\d{2}):(\d{2})/)
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '选择出钓时间', exact: true })
  await dialog.waitFor()
  assert.equal(await page.locator('uni-picker').count(), 0)
  checks.push('time uses the shared themed sheet instead of the native white/blue picker')
  await dialog.getByRole('spinbutton', { name: '小时', exact: true }).focus()
  await page.keyboard.press('ArrowDown')
  await dialog.getByRole('spinbutton', { name: '分钟', exact: true }).focus()
  await page.keyboard.press('ArrowDown')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await trigger.innerText(), initialText)
  checks.push('cancel discards the time draft')
  await trigger.click()
  await dialog.getByRole('spinbutton', { name: '小时', exact: true }).focus()
  await page.keyboard.press('ArrowDown')
  await dialog.getByRole('spinbutton', { name: '分钟', exact: true }).focus()
  await page.keyboard.press('ArrowDown')
  await dialog.getByRole('button', { name: '确定', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  const hour = ((Number(initialTime?.[1] ?? 8) + 1) % 24).toString().padStart(2, '0')
  const minute = ((Number(initialTime?.[2] ?? 0) + 1) % 60).toString().padStart(2, '0')
  assert.ok((await trigger.innerText()).includes(`${hour}:${minute}`), JSON.stringify({ initialText, expected: `${hour}:${minute}`, actual: await trigger.innerText() }))
  checks.push('keyboard changes hour and minute, confirmation writes HH:mm once')
  for (const [name, width, height, dark, scale] of [
    ['375',375,812,false,16], ['320',320,720,false,16], ['440',440,956,false,16],
    ['landscape',844,390,false,16], ['wide',1280,900,false,16], ['dark-large',320,812,true,24]
  ]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
    await setH5TextScale(page, scale)
    await trigger.click()
    await dialog.waitFor()
    await page.waitForTimeout(300)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await dialog.getByRole('button', { name: '确定', exact: true }).scrollIntoViewIfNeeded()
    const alignment = await page.locator('.mobile-time__wheel').evaluate((node) => [...node.querySelectorAll('uni-picker-view-column')].map((column) => {
      const indicator = column.querySelector('.uni-picker-view-indicator')
      const content = column.querySelector('.uni-picker-view-content')
      const option = column.querySelector('.mobile-time__option')
      return { indicator: indicator.getBoundingClientRect().toJSON(), style: indicator.getAttribute('style'), content: content.getAttribute('style'), optionHeight: option.getBoundingClientRect().height, selected: column.querySelector('.mobile-time__option--selected')?.getBoundingClientRect().toJSON() }
    }))
    assert.ok(alignment.every((a) => Math.abs(a.indicator.y - a.selected.y) <= 1), `${name}: selected time is centered in both columns`)
    await page.screenshot({ path: `${output}/${name}.png` })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    checks.push(`${name}: no overflow, footer reachable, Escape closes the time sheet`)
  }
  assert.deepEqual(errors, [])
  await writeFile(`${output}/result.json`, JSON.stringify({ checks, errors }, null, 2))
  console.log(JSON.stringify({ checks, errors }, null, 2))
} finally {
  await context.close()
  await browser.close()
}
