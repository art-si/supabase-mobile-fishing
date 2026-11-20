// Isolated API/GPS/map-adapter checks. No hosted writes or external app launches.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { setH5TextScale } from './h5-text-scale.mjs'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178',
  output = 'artifacts/spot-publication'
const owner = '11111111-1111-4111-8111-111111111111',
  id = '22222222-2222-4222-8222-222222222222'
const address = '湖北省武汉市蔡甸区沌阳街道湖北特种设备检验检测研究院附近'
const checks = [],
  errors = [],
  escaped = [],
  writes = []
let deleted = false,
  failEditOnce = false
let item = {
  id,
  name: '神仙钓位',
  city: '武汉市',
  location_label: address,
  water_type: '自然水域',
  fishing_status: 'allowed',
  species: '鲫鱼、鲤鱼',
  description: '',
  fee_note: '免费',
  access_note: '',
  observed_on: '2026-11-20',
  audience: 'public',
  precision: 'exact',
  longitude: 114.18,
  latitude: 30.48,
  status: 'published',
  saved: false,
  media: [],
  author: { id: owner, nickname: '隔离验收钓友' },
  review_revision: 1
}
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width: 375, height: 812 },
  locale: 'zh-CN',
  reducedMotion: 'reduce'
})
await context.addInitScript(
  ({ owner, address }) => {
    localStorage.setItem(
      'dyj.auth.v1',
      JSON.stringify({
        type: 'object',
        data: {
          access_token: 'spot-publication-ui-only',
          refresh_token: 'fixture',
          expires_at: Date.now() / 1000 + 3600,
          user: { id: owner }
        }
      })
    )
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: async () => ({ state: 'granted' }) }
    })
    window.AMap = {
      Geolocation: class {
        getCurrentPosition(cb) {
          cb('complete', {
            position: { getLng: () => 114.18, getLat: () => 30.48 },
            location_type: 'html5',
            accuracy: 12
          })
        }
      },
      Geocoder: class {
        getAddress(_, cb) {
          cb('complete', {
            regeocode: {
              formattedAddress: address,
              addressComponent: { province: '湖北省', city: '武汉市', district: '蔡甸区' }
            }
          })
        }
      }
    }
  },
  { owner, address }
)
await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
await context.route('**/*', (route) => {
  const request = route.request(),
    url = new URL(request.url())
  if (url.origin === base) {
    if (url.pathname === '/src/platforms/open-place.ts')
      return route.fulfill({
        contentType: 'application/javascript',
        body: "export async function openPlaceMap(provider,place,webOnly=false){window.mapUiCalls??=[];window.mapUiCalls.push({provider,place,webOnly});return 'web'}"
      })
    return route.continue()
  }
  if (!url.protocol.startsWith('http')) return route.continue()
  if (url.origin !== 'https://tlfmfokyhahlpzmpliad.supabase.co') {
    escaped.push(url.origin)
    return route.abort()
  }
  const reply = (json) =>
    route.fulfill({
      json,
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
    })
  if (request.method() === 'OPTIONS') return reply({})
  if (url.pathname === '/auth/v1/user') return reply({ id: owner })
  const data = request.postDataJSON() || {},
    p = data.payload || {}
  if (url.pathname.endsWith('fishing_read') && data.action === 'social')
    return reply({ friends: [], requests: [], conversations: [] })
  if (url.pathname.endsWith('fishing_read'))
    return reply(
      data.action === 'spot'
        ? item
        : data.action === 'edit_content'
          ? {
              item,
              revision: item.review_revision,
              publication: {
                status: 'published',
                audience: item.audience,
                precision: item.precision
              }
            }
          : {
              items:
                data.action === 'spots'
                  ? [
                      ...(deleted ? [] : [{ ...item, ...(p.origin ? { distance_m: 1280 } : {}) }]),
                      {
                        ...item,
                        id: '44444444-4444-4444-8444-444444444444',
                        name: '另一个可钓钓位',
                        fishing_status: 'allowed',
                        ...(p.origin ? { distance_m: 4800 } : {})
                      }
                    ]
                  : [],
              profile: item.author
            }
    )
  if (url.pathname.endsWith('fishing_write')) {
    writes.push(data)
    if (data.action === 'update_content' && failEditOnce) {
      failEditOnce = false
      item = {
        ...item,
        description: '其他设备更新的最新说明',
        review_revision: item.review_revision + 1
      }
      return route.fulfill({
        status: 409,
        json: { message: 'EDIT_CONFLICT' },
        headers: { 'access-control-allow-origin': '*' }
      })
    }
    if (data.action === 'save_spot') item = { ...item, ...p, status: 'published' }
    if (data.action === 'update_content')
      item = { ...item, ...p, review_revision: item.review_revision + 1 }
    if (data.action === 'spot_bookmark') item.saved = p.enabled
    if (data.action === 'delete_content') deleted = true
    return reply({ id: p.id })
  }
  if (url.pathname.endsWith('fishing_moderation')) return reply({ allowed: false })
  return reply([])
})
const page = await context.newPage()
page.setDefaultTimeout(20000)
page.on('pageerror', (e) => errors.push(e.message))
const layouts = [
  ['375', 375, 812, false, 16],
  ['320', 320, 740, false, 16],
  ['440', 440, 956, false, 16],
  ['landscape', 844, 390, false, 16],
  ['wide', 1280, 900, false, 16],
  ['dark-large', 320, 812, true, 24]
]
async function layout(row) {
  const [name, width, height, dark, scale] = row
  await page.setViewportSize({ width, height })
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
  await setH5TextScale(page, scale)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  return name
}
async function openSpot() {
  await page.getByRole('button', { name: '查看钓位：神仙钓位', exact: true }).click()
  await page.locator('.spot-summary').waitFor()
}
async function editor() {
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await page.getByRole('group', { name: '垂钓状态', exact: true }).waitFor()
}
try {
  await page.goto(`${base}/#/pages/post/compose`)
  const audience = page.getByRole('button', { name: '分享范围', exact: true })
  await audience.getByText('公开', { exact: true }).waitFor()
  await page.getByRole('button', { name: '分享心得', exact: true }).click()
  await audience.getByText('公开', { exact: true }).waitFor()
  await audience.click()
  await page
    .getByRole('dialog', { name: '分享范围', exact: true })
    .getByRole('button', { name: '仅自己', exact: true })
    .click()
  await page.reload()
  await audience.getByText('仅自己', { exact: true }).waitFor()
  checks.push('new shares default public; restored choices remain intact')
  await page.goto(`${base}/#/pages/home/index?tab=spots`)
  await page.getByRole('button', { name: '新增钓位', exact: true }).click()
  await page.getByText(address, { exact: true }).waitFor()
  assert.equal(await page.getByRole('group', { name: '垂钓状态', exact: true }).count(), 0)
  await page.getByRole('textbox', { name: '钓位名称（选填）', exact: true }).fill('神仙钓位')
  await page.getByRole('button', { name: '保存钓位', exact: true }).click()
  await page.waitForURL(/#\/(?:pages\/home\/index)?\?tab=spots/)
  const created = writes.find((w) => w.action === 'save_spot').payload
  assert.equal(created.location_label, address)
  assert.equal(created.audience, 'public')
  assert.equal(created.fishing_status, 'allowed')
  assert.equal(await page.getByRole('button', { name: '记录我的钓位', exact: true }).count(), 0)
  await page.getByRole('button', { name: '新增钓位', exact: true }).waitFor()
  assert.equal(await page.locator('.spot-status-stamp').count(), 0)
  checks.push(
    'header adds a public allowed spot, returns to the main list and shows no allowed stamp'
  )
  await openSpot()
  await page.evaluate(
    ({ owner, item }) =>
      localStorage.setItem(
        `dyj.live.draft.${owner}.edit.spot.${item.id}`,
        JSON.stringify({
          type: 'object',
          data: { draft: { ...item, name: '过期缓存' }, revision: 99 }
        })
      ),
    { owner, item }
  )
  await editor()
  assert.equal(
    await page.getByRole('textbox', { name: '钓位名称（选填）', exact: true }).inputValue(),
    '神仙钓位'
  )
  assert.equal(await page.getByText(/这条记录已有新版本|已恢复这条记录/).count(), 0)
  const save = page.getByRole('button', { name: '保存修改', exact: true }),
    status = page.getByRole('group', { name: '垂钓状态', exact: true })
  assert.equal(await save.isDisabled(), true)
  const before = writes.length
  await status.getByRole('button', { name: '禁钓', exact: true }).click()
  assert.equal(await save.isEnabled(), true)
  await status.getByRole('button', { name: '可钓', exact: true }).click()
  assert.equal(await save.isDisabled(), true)
  assert.equal(writes.length, before)
  await status.getByRole('button', { name: '禁钓', exact: true }).click()
  for (const row of layouts) {
    const name = await layout(row)
    await page.screenshot({ path: `${output}/edit-status-${name}.png`, fullPage: true })
  }
  await layout(layouts[0])
  await save.click()
  await page.waitForURL(/#\/(?:pages\/home\/index)?\?tab=spots/)
  assert.equal(writes.at(-1).action, 'update_content')
  assert.equal(writes.at(-1).payload.fishing_status, 'prohibited')
  await page.getByText('距你 1.3公里', { exact: true }).waitFor()
  for (const row of layouts) {
    const name = await layout(row),
      card = page.locator('.spot-card--prohibited'),
      stamp = card.locator('.spot-status-stamp')
    assert.equal(await stamp.count(), 1)
    assert.ok(
      await card.evaluate(
        (node) =>
          getComputedStyle(node.querySelector('.spot-card__body')).filter === 'grayscale(1)' &&
          getComputedStyle(node).filter === 'none' &&
          getComputedStyle(node.querySelector('.heading')).color ===
            getComputedStyle(node.querySelector('.caption')).color
      )
    )
    assert.equal(await stamp.evaluate((node) => getComputedStyle(node).position), 'absolute')
    assert.equal(await stamp.evaluate((node) => getComputedStyle(node).borderRadius), '50%')
    const stampBox = await stamp.boundingBox(),
      box = await card.boundingBox()
    assert.ok(
      Math.abs(stampBox.width - stampBox.height) < 1 &&
        stampBox.x + stampBox.width <= box.x + box.width + 1
    )
    assert.ok(
      await stamp.evaluate((node) => {
        const [r, g] = getComputedStyle(node).color.match(/\d+/g).map(Number)
        return r > g
      })
    )
    assert.equal(
      await page.locator('.spot-card:not(.spot-card--prohibited) .spot-status-stamp').count(),
      0
    )
    await page.screenshot({ path: `${output}/spots-simple-${name}.png`, fullPage: true })
  }
  checks.push(
    'changed-only save returns to list; banned cards have gray text and an independent red circular stamp at bottom right'
  )
  await layout(layouts[0])
  await openSpot()
  assert.equal(
    await page.getByRole('button', { name: '更新垂钓状态，当前禁钓', exact: true }).count(),
    0
  )
  for (const row of layouts) {
    const name = await layout(row),
      tools = page.locator('.spot-tools')
    assert.equal(await tools.getByRole('button').count(), 5)
    for (const text of ['收藏', '发钓友', '编辑', '撤回', '删除']) {
      const action = tools.getByRole('button', { name: text, exact: true })
      assert.ok((await action.boundingBox()).height >= 48)
    }
    assert.equal(await page.getByText(/精确钓点|信息核实日期|路线仅供参考|分享 · 公开/).count(), 0)
    await page.screenshot({ path: `${output}/detail-${name}.png`, fullPage: true })
    const place = page.getByRole('button', { name: `导航到：${address}`, exact: true })
    assert.equal(await place.getByText('导航', { exact: true }).count(), 0)
    await place.focus()
    await page.keyboard.press('Enter')
    const chooser = page.getByRole('dialog', { name: '地图导航', exact: true })
    await chooser.waitFor()
    await chooser.getByRole('button', { name: '高德地图', exact: true }).click()
    const call = await page.evaluate(() => window.mapUiCalls.at(-1))
    assert.equal(call.place.navigation, true)
    assert.equal(call.place.longitude, 114.18)
    assert.equal(call.place.latitude, 30.48)
    await page.keyboard.press('Escape')
    await chooser.waitFor({ state: 'hidden' })
    assert.ok(await place.evaluate((node) => node === document.activeElement))
  }
  await layout(layouts[0])
  await page.getByRole('button', { name: '收藏', exact: true }).click()
  await page.getByRole('button', { name: '已收藏', exact: true }).waitFor()
  await page.getByRole('button', { name: '发钓友', exact: true }).click()
  const sharing = page.getByRole('dialog', { name: '发给钓友', exact: true })
  await sharing.waitFor()
  await page.keyboard.press('Escape')
  await sharing.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '撤回', exact: true }).click()
  const withdrawing = page.getByRole('dialog', { name: '改为仅自己可见？', exact: true })
  await withdrawing.waitFor()
  await withdrawing.getByRole('button', { name: '继续分享', exact: true }).click()
  assert.equal(
    writes.some((w) => w.action === 'withdraw_content' || w.action === 'send_message'),
    false
  )
  checks.push(
    'compact tools preserve bookmark, share, edit and withdrawal confirmation without sending a message'
  )
  await editor()
  assert.equal(await save.isDisabled(), true)
  await status.getByRole('button', { name: '可钓', exact: true }).click()
  await save.click()
  await page.waitForURL(/#\/(?:pages\/home\/index)?\?tab=spots/)
  await page.getByText('距你 1.3公里', { exact: true }).waitFor()
  assert.equal(await page.locator('.spot-card--prohibited,.spot-status-stamp').count(), 0)
  await page.screenshot({ path: `${output}/spots-restored-375.png`, fullPage: true })
  checks.push(
    'manual restore removes gray styling and the stamp; editing an unchanged spot keeps save disabled'
  )
  await openSpot()
  await editor()
  await page.getByRole('textbox', { name: '钓位名称（选填）', exact: true }).fill('尚未保存的改动')
  failEditOnce = true
  await save.click()
  await page.getByRole('textbox', { name: '钓位名称（选填）', exact: true }).fill('神仙钓位')
  await page.waitForFunction(
    () =>
      document.querySelector('#spot-name input')?.value === '神仙钓位' &&
      document.querySelector('.spot-entry .primary')?.hasAttribute('disabled')
  )
  assert.equal(await page.getByText(/这条记录已有新版本|重新读取新版本/).count(), 0)
  await page.screenshot({ path: `${output}/edit-latest-375.png`, fullPage: true })
  checks.push(
    'stale cached edits are ignored; a save race automatically loads the latest version without a conflict dialog'
  )
  await page.goto(`${base}/#/pages/home/index?tab=spots`)
  item = { ...item, precision: 'hidden', longitude: null, latitude: null, location_label: '' }
  await openSpot()
  await editor()
  assert.equal(await save.isDisabled(), true)
  await status.getByRole('button', { name: '禁钓', exact: true }).click()
  await save.click()
  await page.waitForURL(/#\/(?:pages\/home\/index)?\?tab=spots/)
  assert.equal(writes.at(-1).payload.precision, 'hidden')
  assert.equal(writes.at(-1).payload.longitude, null)
  checks.push('status-only edit preserves an old hidden location and does not request a new point')
  await openSpot()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  const removal = page.getByRole('alertdialog', { name: '删除这个钓位？', exact: true })
  await removal.waitFor()
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${output}/delete-confirm-375.png`, fullPage: true })
  await removal.getByRole('button', { name: '保留钓位', exact: true }).click()
  assert.equal(
    writes.some((w) => w.action === 'delete_content'),
    false
  )
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await removal.waitFor()
  await removal.getByRole('button', { name: '删除钓位', exact: true }).click()
  await page.waitForURL(/#\/(?:pages\/home\/index)?\?tab=spots/)
  await page.getByRole('button', { name: '新增钓位', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: '查看钓位：神仙钓位', exact: true }).count(),
    0
  )
  checks.push(
    'owner deletion supports cancellation, removes the selected spot and returns to the main list; all writes are isolated'
  )
  assert.deepEqual(errors, [])
  assert.deepEqual(escaped, [])
  await writeFile(`${output}/result.json`, JSON.stringify({ checks, errors, escaped }, null, 2))
  console.log(JSON.stringify({ checks, errors, escaped }, null, 2))
} catch (error) {
  await page.screenshot({ path: `${output}/failed.png`, fullPage: true })
  throw error
} finally {
  await context.close()
  await browser.close()
}
