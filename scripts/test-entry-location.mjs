import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { setH5TextScale } from './h5-text-scale.mjs'

const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5179'
const origin = new URL(base).origin
const output = 'artifacts/location-entry'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })

try {
  const context = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 375, height: 812 },
    geolocation: { longitude: 114.1885, latitude: 30.5128, accuracy: 40 }
  })
  const page = await context.newPage()
  const errors = []
  const reads = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (path === '/rest/v1/rpc/fishing_read' || path.endsWith('/fishing_list_spot_leads') ||
        path.endsWith('/spot-discovery')) reads.push(path)
  })
  const cdp = await context.newCDPSession(page)
  const { targetInfo: { browserContextId } } = await cdp.send('Target.getTargetInfo')
  function permission(setting) {
    return cdp.send('Browser.setPermission', {
      permission: { name: 'geolocation' }, setting, origin, browserContextId
    })
  }
  const gate = page.getByText('请先开启位置', { exact: true })
  await page.goto(base + '/#/pages/home/index?tab=spots', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '请求位置权限', exact: true }).waitFor({ timeout: 25000 })
  assert.equal(await page.getByText('水域地图', { exact: true }).count(), 0)
  assert.deepEqual(reads, [])
  await page.getByRole('button', { name: '请求位置权限', exact: true }).focus()
  await page.screenshot({ path: output + '/prompt-focus-375.png' })

  await permission('denied')
  const retry = page.getByRole('button', { name: '重新检查', exact: true })
  await retry.waitFor()
  await retry.click()
  await retry.waitFor()
  await page.keyboard.press('Escape')
  await gate.waitFor()
  assert.equal(await page.locator('.spot-card').count(), 0)
  for (const [name, width, height] of [
    ['320', 320, 720], ['375', 375, 812], ['440', 440, 956],
    ['landscape', 844, 390], ['wide', 1280, 900], ['dark-large', 320, 812]
  ]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: name === 'dark-large' ? 'dark' : 'light' })
    await setH5TextScale(page, name === 'dark-large' ? 24 : 16)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name)
    await page.screenshot({ path: output + '/denied-' + name + '.png' })
  }

  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'light' })
  await setH5TextScale(page, 16)
  await page.getByRole('button', { name: '查看隐私说明', exact: true }).click()
  await page.getByText('位置、照片与设备权限', { exact: true }).waitFor()
  await page.goBack({ waitUntil: 'domcontentloaded' })
  await gate.waitFor()

  await page.goto(base + '/#/pages/spot/detail?id=00000000-0000-4000-8000-000000000001')
  await gate.waitFor()
  assert.deepEqual(reads, [], 'No data request while the entry and a direct route are denied')
  await page.goto(base + '/#/pages/home/index?tab=spots', { waitUntil: 'domcontentloaded' })
  await gate.waitFor()

  const catalog = page.waitForResponse(response =>
    response.ok() && new URL(response.url()).pathname.endsWith('/fishing_list_spot_leads'))
  await permission('granted')
  await page.getByRole('button', { name: '水域地图', exact: true }).waitFor({ timeout: 20000 })
  for (const [name, platform] of [
    ['张之洞遛鱼城市钓场', '抖音'], ['江城鲢鳙基地', '今日头条'], ['凤凰镇路亚小镇', 'B 站']
  ]) {
    const card = page.locator('.spot-card').filter({ has: page.getByText(name, { exact: true }) })
    await card.getByRole('button', { name: '打开' + platform + '原文' }).waitFor({ timeout: 30000 })
  }
  for (const name of [
    '古潭田园农庄', '丹枫白露民宿垂钓区', '金龙水寨生态乐园垂钓区', '仓埠山庄生态钓场'
  ]) {
    await page.getByText(name, { exact: true }).waitFor({ timeout: 25000 })
  }
  await page.getByRole('button', { name: /^查看钓位：/ }).first().waitFor()
  assert.ok((await (await catalog).json()).length >= 21, 'The hosted catalog serves all published leads')
  const loaded = await page.locator('.spot-card').count()
  assert.ok(loaded >= 8, 'The list shows all newly added places alongside existing spots')
  assert.equal(await page.getByRole('button', { name: /开启定位|选择我的位置|距离由近到远/ }).count(), 0)
  assert.ok(reads.includes('/rest/v1/rpc/fishing_read'))
  assert.ok(reads.includes('/rest/v1/rpc/fishing_list_spot_leads'))
  await page.screenshot({ path: output + '/granted-spots-375.png' })

  const douyinSpot = page.locator('.spot-card').filter({
    has: page.getByText('张之洞遛鱼城市钓场', { exact: true })
  })
  await douyinSpot.getByRole('button', { name: /在地图中查看.*琴台大道/ }).click()
  const place = page.getByRole('dialog', { name: '在地图中查看' })
  await place.getByText(/高德地点 汉阳张之洞遛鱼城市钓场 · 经度 .+ · 纬度 .+/).waitFor()
  await page.screenshot({ path: output + '/granted-spot-poi-375.png' })
  await page.keyboard.press('Escape')
  await place.waitFor({ state: 'hidden' })

  await permission('denied')
  await gate.waitFor()
  assert.equal(await page.locator('.spot-card').count(), 0)
  await permission('granted')
  await page.getByRole('button', { name: '水域地图', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS browser location denial, deep-link gate, privacy access, recovery, reblocking and ' + loaded + ' spot cards')
} finally {
  await browser.close()
}
