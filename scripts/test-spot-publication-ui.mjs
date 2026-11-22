// Isolated API/GPS/map-adapter checks. No hosted writes or external app launches.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { setH5TextScale } from './h5-text-scale.mjs'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178',
  output = 'artifacts/spot-publication'
const owner = '11111111-1111-4111-8111-111111111111',
  id = '22222222-2222-4222-8222-222222222222'
const address = '万家湖'
const douyinSource = 'https://v.douyin.com/dyj-source-fixture/'
const toutiaoSource = 'https://m.toutiao.com/is/dyj-source-fixture/'
const observations = '岸边干净。工作日上午钓友很少。'
const shareText = `${observations}\n${douyinSource}?track=1\n${toutiaoSource}`
const checks = [],
  errors = [],
  escaped = [],
  writes = [],
  visitedSources = []
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
  permissions: ['geolocation'],
  geolocation: { latitude: 30.48, longitude: 114.18, accuracy: 12 },
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
  if (url.href === douyinSource || url.href === toutiaoSource) {
    visitedSources.push(url.href)
    return route.fulfill({ body: '隔离验收原文' })
  }
  if (url.origin === 'https://tiles.openfreemap.org') return route.abort()
  if (url.origin !== 'https://jupuypvmgjpnpntfetqv.supabase.co') {
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
  await page.getByRole('button', { name: /^补充钓位信息/ }).click()
  await page.getByRole('button', { name: '选择常见鱼种', exact: true }).click()
  const species = page.getByRole('dialog', { name: '选择常见鱼种', exact: true })
  await species.getByRole('checkbox', { name: '鲫鱼', exact: true }).click()
  await species.getByRole('button', { name: /^确定/ }).click()
  await species.waitFor({ state: 'hidden' })
  await page.getByRole('textbox', { name: '水域与鱼情', exact: true }).fill(shareText)
  await page.getByText('保存后可查看抖音、今日头条原文。', { exact: true }).waitFor()
  await page.screenshot({ path: `${output}/create-with-sources.png`, fullPage: true })
  await page.getByRole('button', { name: '保存钓位', exact: true }).click()
  await page.waitForURL(/#\/(?:pages\/home\/index)?\?tab=spots/)
  const created = writes.find((w) => w.action === 'save_spot').payload
  assert.equal(created.location_label, address)
  assert.equal(created.description, shareText)
  assert.equal(created.species, '鲫鱼')
  assert.equal(created.audience, 'public')
  assert.equal(created.fishing_status, 'allowed')
  assert.equal(await page.getByRole('button', { name: '记录我的钓位', exact: true }).count(), 0)
  await page.getByRole('button', { name: '新增钓位', exact: true }).waitFor()
  const sharedCard = page.locator('.spot-card').filter({ hasText: '神仙钓位' })
  await sharedCard.getByText('抖音', { exact: true }).waitFor()
  await sharedCard.getByText('今日头条', { exact: true }).waitFor()
  await sharedCard.getByText('人少', { exact: true }).waitFor()
  await page.screenshot({ path: `${output}/published-source-card.png` })
  assert.equal(await page.locator('.spot-status-stamp').count(), 0)
  checks.push(
    'header adds a public allowed spot, returns to the main list and shows no allowed stamp'
  )
  await openSpot()
  await page.getByText(observations, { exact: true }).waitFor()
  assert.equal(await page.getByText(douyinSource, { exact: false }).count(), 0)
  const original = page.getByRole('button', { name: '打开抖音原文', exact: true })
  await original.focus()
  await page.screenshot({ path: `${output}/detail-source-focus.png` })
  const openedSource = context.waitForEvent('page')
  await page.keyboard.press('Enter')
  const originalPage = await openedSource
  await originalPage.waitForLoadState()
  assert.deepEqual(visitedSources, [douyinSource])
  await originalPage.close()
  await page.getByRole('button', { name: '打开今日头条原文', exact: true }).waitFor()
  checks.push('author shares keep the saved location, show evidence labels and platform names, and open the canonical original')
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
  await page.getByText(/^距你 \d+(?:\.\d+)? km$/).first().waitFor()
  for (const row of layouts) {
    const name = await layout(row),
      card = page.locator('.spot-card--prohibited'),
      stamp = card.locator('.spot-status-stamp')
    assert.equal(await stamp.count(), 1)
    assert.ok(
      await card.evaluate(
        (node) => {
          const title = getComputedStyle(node.querySelector('.post-title'))
          return title.filter === 'grayscale(1)' && Number(title.opacity) < 0.7 &&
            getComputedStyle(node.querySelector('.heading')).color ===
              getComputedStyle(node.querySelector('.caption')).color
        }
      )
    )
    assert.equal(await stamp.evaluate((node) => getComputedStyle(node).opacity), '1')
    await card.getByRole('img', { name: '禁钓', exact: true }).waitFor()
    assert.equal((await stamp.innerText()).trim(), '')
    assert.ok(await stamp.locator('img').evaluate(async (image) => {
      await image.decode()
      return image.naturalWidth > 0
    }))
    const stampBox = await stamp.boundingBox(),
      box = await card.boundingBox(),
      titleBox = await card.locator('.post-title').boundingBox(),
      factsBox = await card.locator('.fish-facts').boundingBox()
    assert.ok(
      Math.abs(stampBox.width - stampBox.height) < 1 &&
        stampBox.x + stampBox.width <= box.x + box.width + 1 &&
        stampBox.y >= titleBox.y + titleBox.height &&
        stampBox.x >= factsBox.x + factsBox.width
    )
    assert.equal(
      await stamp.evaluate((node) => getComputedStyle(node).backgroundColor),
      'rgba(0, 0, 0, 0)'
    )
    assert.equal(
      await page.locator('.spot-card:not(.spot-card--prohibited) .spot-status-stamp').count(),
      0
    )
    await page.screenshot({ path: `${output}/spots-simple-${name}.png`, fullPage: true })
  }
  checks.push(
    'changed-only save returns to list; prohibited cards use faded text and a clear wordless stamp'
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
    assert.equal(await tools.getByRole('button').count(), 6)
    for (const text of ['收藏：神仙钓位', '编辑', '撤回', '删除']) {
      const action = tools.getByRole('button', { name: text, exact: true })
      assert.ok((await action.boundingBox()).height >= 48)
    }
    for (const text of ['打开抖音原文', '打开今日头条原文']) {
      const action = page.getByRole('button', { name: text, exact: true })
      assert.ok((await action.boundingBox()).height >= 44)
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
    assert.equal(call.place.longitude, created.longitude)
    assert.equal(call.place.latitude, created.latitude)
    await page.keyboard.press('Escape')
    await chooser.waitFor({ state: 'hidden' })
    assert.ok(await place.evaluate((node) => node === document.activeElement))
  }
  await layout(layouts[0])
  const bookmark = page.getByRole('button', { name: '收藏：神仙钓位', exact: true })
  await bookmark.click()
  const bookmarked = page.getByRole('button', { name: '取消收藏：神仙钓位', exact: true })
  await bookmarked.waitFor()
  assert.equal(await bookmarked.getAttribute('aria-pressed'), 'true')
  await bookmarked.click()
  await bookmark.waitFor()
  assert.equal(await bookmark.getAttribute('aria-pressed'), 'false')
  assert.deepEqual(writes.filter((w) => w.action === 'spot_bookmark').map((w) => w.payload.enabled), [true, false])
  await page.getByRole('button', { name: '撤回', exact: true }).click()
  const withdrawing = page.getByRole('dialog', { name: '改为仅自己可见？', exact: true })
  await withdrawing.waitFor()
  await withdrawing.getByRole('button', { name: '继续分享', exact: true }).click()
  assert.equal(
    writes.some((w) => w.action === 'withdraw_content'),
    false
  )
  checks.push(
    'compact tools preserve bookmark toggling, editing and cancellation of withdrawal'
  )
  await editor()
  assert.equal(await save.isDisabled(), true)
  await status.getByRole('button', { name: '可钓', exact: true }).click()
  await save.click()
  await page.waitForURL(/#\/(?:pages\/home\/index)?\?tab=spots/)
  await page.getByText(/^距你 \d+(?:\.\d+)? km$/).first().waitFor()
  assert.equal(await page.locator('.spot-card--prohibited,.spot-status-stamp').count(), 0)
  await page.screenshot({ path: `${output}/spots-restored-375.png`, fullPage: true })
  checks.push(
    'manual restore removes gray styling and the stamp; editing an unchanged spot keeps save disabled'
  )
  await openSpot()
  await editor()
  const spotName = page.getByRole('textbox', { name: '钓位名称（选填）', exact: true })
  await spotName.fill('尚未保存的改动')
  failEditOnce = true
  await save.click()
  await page.getByText('这条记录已有新版本', { exact: true }).waitFor()
  assert.equal(await spotName.inputValue(), '尚未保存的改动')
  assert.equal(await save.isDisabled(), true)
  const reload = page.getByRole('button', { name: '重新读取新版本', exact: true })
  const replace = page.getByRole('alertdialog', { name: '读取新版本？', exact: true })
  await reload.click()
  await replace.getByRole('button', { name: '保留当前修改', exact: true }).click()
  assert.equal(await spotName.inputValue(), '尚未保存的改动')
  await reload.click()
  await replace.getByRole('button', { name: '读取新版本', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('#spot-name input')?.value === '神仙钓位' &&
      document.querySelector('.spot-entry .primary')?.hasAttribute('disabled')
  )
  assert.equal(await page.getByText(/这条记录已有新版本|重新读取新版本/).count(), 0)
  await page.screenshot({ path: `${output}/edit-latest-375.png`, fullPage: true })
  checks.push(
    'a save conflict preserves the current draft until the author confirms reading the latest version'
  )
  item = { ...item, precision: 'hidden', longitude: null, latitude: null, location_label: '' }
  const hiddenDetail = `${base}/#/pages/spot/detail?id=${item.id}`
  await page.goto(hiddenDetail)
  await editor()
  assert.equal(await save.isDisabled(), true)
  await status.getByRole('button', { name: '禁钓', exact: true }).click()
  await save.click()
  await page.waitForURL(/#\/(?:pages\/home\/index)?\?tab=spots/)
  assert.equal(writes.at(-1).payload.precision, 'hidden')
  assert.equal(writes.at(-1).payload.longitude, null)
  checks.push('status-only edit preserves an old hidden location and does not request a new point')
  await page.goto(hiddenDetail)
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
