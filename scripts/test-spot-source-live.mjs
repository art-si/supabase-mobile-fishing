// Live Supabase reads. Browser coordinates are injected only as device input.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { setH5TextScale } from './h5-text-scale.mjs'

const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
const output = 'artifacts/spot-source/live-ui'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  ...(process.env.FISHING_VERIFY_PROXY ? { proxy: { server: process.env.FISHING_VERIFY_PROXY, bypass: 'localhost,127.0.0.1' } } : {}) })
try {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'zh-CN',
    geolocation: { longitude: 114.06, latitude: 30.59, accuracy: 20 }, permissions: ['geolocation'], reducedMotion: 'reduce' })
  await context.addInitScript(() => localStorage.setItem('dyj.feed.city', '武汉市'))
  const page = await context.newPage()
  const errors = [], reads = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', async response => {
    if (response.url().includes('tlfmfokyhahlpzmpliad')) errors.push('Stale project request')
    if (response.url().endsWith('/rpc/fishing_list_spot_leads') && response.request().method() === 'POST') {
      reads.push({ status: response.status(), city: response.request().postDataJSON()?.city_name, items: await response.json().catch(() => null) })
    }
  })
  page.setDefaultTimeout(25000)
  await page.goto(base + '/#/pages/home/index?tab=spots', { waitUntil: 'domcontentloaded', timeout: 60000 })
  const title = page.getByRole('button', { name: '查看钓位：杉野灵溪', exact: true })
  await title.waitFor({ timeout: 60000 })
  assert.ok(reads.some(read => read.status === 200 && read.items?.some(item => item.poiId === 'B0L1P55RLT')))
  const catalog = reads.findLast(read => read.status === 200 && Array.isArray(read.items))?.items || []
  const videoSpot = catalog.find(item => item.catchFrame?.key && item.source.url === item.catchFrame.sourceUrl)
  const listTotal = await page.getByText(/^已加载全部\s*\d+\s*条$/).innerText()
  console.log(listTotal, '· 公开媒体钓位', catalog.length)
  let checkedFrame
  if (process.env.FISHING_VERIFY_VIDEO) assert.ok(videoSpot, 'A public video spot with a catch frame is required')
  if (videoSpot) {
    const name = videoSpot.displayName || videoSpot.name
    const search = page.getByRole('search').locator('input[name="spot-search"]')
    await search.fill(name)
    const videoTitle = page.getByRole('button', { name: '查看钓位：' + name, exact: true })
    await videoTitle.waitFor()
    await page.getByText(/^已加载全部\s*1\s*条$/).waitFor()
    const frameButton = page.getByRole('button', { name: /视频鱼获.*查看大图/ })
    await frameButton.scrollIntoViewIfNeeded()
    const img = frameButton.locator('img')
    await img.waitFor({ state: 'attached' })
    await img.evaluate(image => image.decode())
    const actual = await page.request.get(await img.getAttribute('src'))
    assert.equal(actual.status(), 200)
    assert.match(actual.headers()['content-type'], /^image\/jpeg/)
    assert.equal(createHash('sha256').update(await actual.body()).digest('hex') + '.jpg', videoSpot.catchFrame.key)
    await page.screenshot({ path: output + '/video-search.png' })
    await frameButton.click()
    await page.getByRole('dialog').waitFor()
    await page.screenshot({ path: output + '/video-catch.png' })
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await videoTitle.click()
    const sheet = page.getByRole('dialog', { name, exact: true })
    await sheet.getByText(/原视频\s*\d+:\d+/).waitFor()
    if (videoSpot.locationScope) await sheet.getByText(/经度.+纬度/).waitFor()
    await page.screenshot({ path: output + '/video-spot-detail.png' })
    await page.keyboard.press('Escape')
    await sheet.waitFor({ state: 'hidden' })
    for (const item of catalog) {
      const label = item.displayName || item.name
      await search.fill(label)
      await page.getByRole('button', { name: '查看钓位：' + label, exact: true }).waitFor()
    }
    await search.fill('')
    await title.waitFor()
    checkedFrame = { place: name, seconds: videoSpot.catchFrame.seconds, bytes: (await actual.body()).length, searched: catalog.length }
  }
  for (const [label, width, height] of [['320', 320, 740], ['375', 375, 812], ['440', 440, 956], ['landscape', 844, 390], ['wide', 1280, 900]]) {
    await page.setViewportSize({ width, height })
    await title.scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: output + `/list-${label}.png` })
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await title.focus()
  await page.keyboard.press('Enter')
  const detail = page.getByRole('dialog', { name: '杉野灵溪', exact: true })
  await detail.getByText(/原文核验/).waitFor()
  await detail.getByRole('button', { name: '打开武汉市生态环境局原文', exact: true }).waitFor()
  await page.screenshot({ path: output + '/detail-focus.png' })
  await page.emulateMedia({ colorScheme: 'dark' })
  await setH5TextScale(page, 28)
  await page.screenshot({ path: output + '/detail-dark-large.png' })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await page.keyboard.press('Escape')
  await detail.waitFor({ state: 'hidden' })
  assert.equal(await title.evaluate(el => el === document.activeElement), true)
  assert.deepEqual(errors, [])
  const result = { mode: 'live-supabase-read-only', simulatedDeviceCoordinates: true, listTotal, checkedFrame,
    readings: reads.map(({ status, city, items }) => ({ status, city, count: items?.length })), screenshots: videoSpot ? 10 : 7, errors }
  await writeFile(output + '/result.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally { await browser.close() }
