// Isolated UI/API contract fixture. No real SMS, upload, location request or hosted write.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { setH5TextScale } from './h5-text-scale.mjs'
import { createServer } from 'node:http'
import { extname } from 'node:path'
let server
if (process.argv.includes('--built')) {
  const root = resolve('dist/test/publishing')
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname
      const file = resolve(root, '.' + (path === '/' ? '/index.html' : decodeURIComponent(path)))
      if (!file.startsWith(root)) throw Error()
      const content = await readFile(file)
      res.writeHead(200, {
        'Content-Type':
          {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.woff2': 'font/woff2'
          }[extname(file)] || 'application/octet-stream'
      })
      res.end(content)
    } catch {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise((done) => server.listen(0, '0.0.0.0', done))
}
const base = server
  ? `http://127.0.0.1:${server.address().port}`
  : process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
const output = resolve('artifacts/publishing')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width: 375, height: 812 },
  permissions: ['geolocation'],
  geolocation: { longitude: 120.62, latitude: 31.32 },
  locale: 'zh-CN',
  reducedMotion: 'reduce'
})
const owner = '11111111-1111-4111-8111-111111111111',
  errors = [],
  checks = [],
  searches = [],
  uploads = [],
  writes = []
const author = { id: owner, nickname: '钓友100001', handle: 'DY000000000001', city: '苏州' }
let uploadFail = true,
  uploadAuthFail = false,
  holdUploads = false,
  imageFixture,
  post
const heldUploads = []
await context.addInitScript(
  ({ owner }) => {
    window.__postGeoFail = !location.href.includes('locationcase=')
    window.__postGeoDelay = location.href.includes('locationcase=late') ? 3000 : 0
    window.__postPlaceQueries = []
    const point = { getLng: () => 120.62345, getLat: () => 31.32789 }
    window.AMap = {
      Geolocation: class {
        getCurrentPosition(cb) {
          setTimeout(
            () =>
              cb(window.__postGeoFail ? 'error' : 'complete', {
                position: point,
                location_type: 'gps',
                accuracy: 20
              }),
            window.__postGeoDelay
          )
        }
      },
      Geocoder: class {
        getAddress(_point, cb) {
          cb('complete', {
            regeocode: {
              formattedAddress: '私密门牌不应自动展示',
              addressComponent: { city: '苏州市', district: '工业园区', province: '江苏省' }
            }
          })
        }
      },
      PlaceSearch: class {
        search(query, cb) {
          window.__postPlaceQueries.push(query)
          setTimeout(
            () =>
              cb('complete', {
                poiList: {
                  pois: query === '附近测试水域' && window.__postGeoFail ? [] : [{
                    id: query, name: query, address: '接口验收地点', location: point,
                    type: '地名地址信息;自然地名;湖泊'
                  }],
                  count: query === '附近测试水域' && window.__postGeoFail ? 0 : 1
                }
              }),
            query === '旧地点' ? 700 : 0
          )
        }
        searchNearBy(query, _point, _radius, cb) {
          setTimeout(() => this.search(query || '附近测试水域', cb), window.__postGeoDelay)
        }
      }
    }
    localStorage.setItem(
      'dyj.auth.v1',
      JSON.stringify({
        type: 'object',
        data: {
          access_token: 'publishing-fixture',
          refresh_token: 'fixture',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: owner, phone: '8613800000000' }
        }
      })
    )
  },
  { owner }
)
await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
await context.route('**/*', async (route) => {
  const req = route.request(),
    url = new URL(req.url())
  if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
  // The current water picker can request its basemap independently. This
  // publishing contract keeps that external tile service outside the fixture.
  if (url.origin === 'https://tiles.openfreemap.org') return route.abort()
  assert.equal(url.origin, 'https://jupuypvmgjpnpntfetqv.supabase.co')
  const reply = (json, status = 200) =>
    route.fulfill({
      status,
      json,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS'
      }
    })
  if (req.method() === 'OPTIONS') return reply({})
  if (url.pathname === '/auth/v1/otp') throw new Error('SMS must not be requested')
  if (url.pathname === '/auth/v1/user') return reply({ ...author, phone: '8613800000000' })
  if (url.pathname === '/auth/v1/token' || url.pathname === '/functions/v1/account-login')
    return reply({
      access_token: 'recovered-fixture',
      refresh_token: 'fixture',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: owner, phone: '8613800000000' }
    })
  if (url.pathname.startsWith('/storage/v1/object/sign/fishing-media/')) {
    if (req.method() === 'POST')
      return reply({ signedURL: url.pathname.replace('/storage/v1', '') + '?token=fixture' })
    return route.fulfill({
      status: 200,
      contentType: url.pathname.endsWith('.mp4') ? 'video/mp4' : 'image/png',
      body: url.pathname.endsWith('.mp4')
        ? await readFile(resolve('tests/fixtures/flower-cc0.mp4'))
        : imageFixture
    })
  }
  if (url.pathname === '/functions/v1/media-upload') {
    uploads.push({ size: req.postDataBuffer()?.length })
    if (holdUploads) await new Promise((done) => heldUploads.push(done))
    if (uploadAuthFail) {
      uploadAuthFail = false
      return reply({ error: 'AUTH_REQUIRED' }, 401)
    }
    if (uploadFail) {
      uploadFail = false
      return reply({ error: 'STORAGE_UNAVAILABLE' }, 503)
    }
    const isVideo = req.postDataBuffer().includes(Buffer.from('name="kind"\r\n\r\nvideo'))
    if (!isVideo) {
      const id = String(uploads.length).padStart(8, '0') + '-4444-4444-8444-444444444444'
      return reply({
        id,
        path: owner + '/' + id + '.jpg',
        kind: 'image',
        width: 64,
        height: 48,
        size: 1000
      })
    }
    return reply({
      id: String(uploads.length).padStart(8, '0') + '-3333-4333-8333-333333333333',
      path: `${owner}/${String(uploads.length).padStart(8, '0')}-3333-4333-8333-333333333333.mp4`,
      kind: 'video',
      width: 960,
      height: 540,
      duration: 5.005,
      size: 1128375
    })
  }
  const body = req.postDataJSON() || {},
    p = body.payload || {}
  if (url.pathname === '/functions/v1/amap') {
    if (body.action === 'water-places')
      return reply({ items: [{ name: searches.at(-1) || '太湖', point: [120.62345, 31.32789], flowing: false }] })
    if (body.action === 'search') {
      searches.push(body.query)
      if (body.query === '旧地点') await new Promise((done) => setTimeout(done, 700))
      return reply({
        items: [
          {
            id: body.query,
            name: body.query,
            address: '江苏省苏州市',
            longitude: 120.62345,
            latitude: 31.32789,
            adcode: '320500'
          }
        ],
        hasMore: false
      })
    }
    return reply({ error: 'MAP_RESPONSE_INVALID' }, 502)
  }
  if (url.pathname === '/rest/v1/rpc/fishing_moderation') return reply({ allowed: false })
  if (url.pathname === '/rest/v1/rpc/fishing_read') {
    if (body.action === 'profile') return reply({ profile: author, posts: [] })
    if (body.action === 'post') return reply({ post, comments: [] })
    if (body.action === 'feed')
      return reply({ items: post && p.filter === 'recommended' ? [post] : [], next: null })
    if (body.action === 'spots' || body.action === 'people') return reply({ items: [], next: null })
    if (body.action === 'library') return reply({ posts: [], trips: [], spots: [] })
    return reply([])
  }
  if (url.pathname === '/rest/v1/rpc/fishing_write') {
    writes.push(body)
    post = {
      ...p,
      author,
      weight_kg: p.weight === '' ? null : Number(p.weight),
      count: p.count === '' ? null : Number(p.count),
      length_cm: p.length === '' ? null : Number(p.length),
      media: [],
      created_at: new Date().toISOString(),
      status: 'published',
      like_count: 0,
      comment_count: 0
    }
    return reply(post)
  }
  if (url.pathname.startsWith('/rest/v1/')) return reply([])
  return reply({}, 404)
})
const page = await context.newPage()
page.setDefaultTimeout(15000)
page.on('pageerror', (e) => errors.push(e.message))
const button = (name) => page.getByRole('button', { name, exact: true })
const field = (label) =>
  page.locator(`input[aria-label="${label}"],textarea[aria-label="${label}"]`)
const pass = (name) => {
  checks.push(name)
  console.log('PASS', name)
}
async function shot(name) {
  await page.evaluate(() => document.fonts.ready)
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    'page must not overflow'
  )
  await page.screenshot({ path: resolve(output, `${name}.png`) })
}
async function checkPublishedInFeed() {
  await page.waitForURL(/#\/(?:pages\/home\/index)?\?tab=feed$/)
  const card = page.locator('.post-card').filter({ hasText: post.body })
  await card.getByText(post.body, { exact: true }).waitFor()
  assert.equal(await card.locator('.name').innerText(), author.nickname)
  assert.equal(
    await page.getByRole('link', { name: '钓友圈', exact: true }).getAttribute('aria-current'),
    'page'
  )
}
async function choice(label, names) {
  await button(`选择${label}`).click()
  const dialog = page.getByRole('dialog', { name: `选择${label}`, exact: true })
  await dialog.waitFor()
  assert.equal(await dialog.getByRole('button', { name: '搜索', exact: true }).count(), 0)
  for (const name of names) await dialog.getByRole('checkbox', { name, exact: true }).click()
  await dialog.getByRole('button', { name: /^确定/ }).click()
  await dialog.waitFor({ state: 'hidden' })
}
try {
  await page.goto(`${base}/#/pages/post/compose`, { waitUntil: 'domcontentloaded' })
  await button('鱼情详情').click()
  await button('选择鱼种').click()
  const dialog = page.getByRole('dialog', { name: '选择鱼种', exact: true }),
    search = field('搜索鱼种')
  await dialog.waitFor()
  assert.equal(await dialog.getByRole('button', { name: '搜索', exact: true }).count(), 0)
  await search.evaluate((n) => {
    n.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    n.value = 'ji'
    n.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
  })
  await page.waitForTimeout(420)
  assert.ok(
    await dialog.getByRole('checkbox', { name: '鲤鱼', exact: true }).isVisible(),
    'IME must not filter unfinished pinyin'
  )
  await search.evaluate((n) => {
    n.value = '鲫'
    n.dispatchEvent(new InputEvent('input', { bubbles: true }))
    n.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '鲫' }))
  })
  await dialog.getByRole('checkbox', { name: '鲫鱼', exact: true }).waitFor()
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[role="checkbox"]')].filter((x) => x.offsetHeight).length === 1
  )
  await dialog.getByRole('checkbox', { name: '鲫鱼', exact: true }).click()
  await button('清除搜索').click()
  await dialog.getByRole('checkbox', { name: '鲤鱼', exact: true }).click()
  await field('添加其他鱼种').fill('溪哥')
  await button('添加').click()
  await search.fill('不存在的鱼种')
  await dialog.getByText('没有匹配的预设，可在下方添加。', { exact: true }).waitFor()
  await button('清除搜索').click()
  await shot('multi-fish-search-375')
  await dialog.getByRole('button', { name: /^确定/ }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.match(await button('选择鱼种').innerText(), /鲫鱼、鲤鱼、溪哥/)
  pass(
    'live local filtering, IME, clear, multi-select and custom fish preserve selections without a search action'
  )
  await choice('钓法', ['路亚'])
  await choice('饵料', ['蚯蚓', '蓝鲫'])
  await choice('小药', ['果酸', '虾油'])
  await field('尾数').fill('-1e-1')
  await page.getByText('尾数请输入 0–10000 的整数', { exact: true }).waitFor()
  assert.equal(await field('尾数').inputValue(), '-1e-1')
  await field('尾数').fill('0')
  await page.locator('#count-error').waitFor({ state: 'hidden' })
  await field('今天的渔获').fill('本地接口验收：今天在水边记录。')
  await shot('catch-details-375')
  await button('分享心得').click()
  assert.equal(await button('选择鱼种').count(), 0)
  await button('选择心得主题（选填）').waitFor({ state: 'visible' })
  assert.equal(await field('分享你的心得').inputValue(), '本地接口验收：今天在水边记录。')
  await button('晒渔获').click()
  assert.match(await button('选择小药').innerText(), /果酸、虾油/)
  pass(
    'catch/experience forms differ, switches retain input, and invalid tail counts stay repairable'
  )
  await button('保存并发布').click()
  await page.getByText('选择所在位置后再发布', { exact: true }).first().waitFor()
  await button('选择所在位置').click()
  // The current product selects a waterbody through the map. Exercise its
  // supported static-search recovery when this fixture has no map renderer.
  await button('改用地点搜索与静态预览').click()
  const mapSearch = field('搜索高德地点')
  await mapSearch.waitFor()
  await mapSearch.fill('旧地点')
  await page.waitForTimeout(410)
  await mapSearch.fill('太湖')
  await page.getByRole('option', { name: /太湖/ }).waitFor()
  await page.waitForTimeout(800)
  assert.equal(await page.getByRole('option', { name: /旧地点/ }).count(), 0)
  await page.getByRole('option', { name: /太湖/ }).click()
  await button('确认这处水域').waitFor()
  await button('确认这处水域').click()
  await button('选择所在位置').waitFor()
  assert.match(await button('选择所在位置').innerText(), /太湖/)
  pass(
    'remote live search is debounced, stale responses are ignored and a chosen place returns to the draft'
  )
  const chooser = page.waitForEvent('filechooser')
  await button('添加图片 / 视频').click()
  await (
    await chooser
  ).setFiles({
    name: 'too-large.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.alloc(20 * 1024 * 1024 + 1)
  })
  await page.getByText('视频不能超过 20MB，请选择较小的视频', { exact: true }).first().waitFor()
  assert.equal(uploads.length, 0)
  const videoChooser = page.waitForEvent('filechooser')
  await button('添加图片 / 视频').click()
  await (await videoChooser).setFiles(resolve('tests/fixtures/flower-cc0.mp4'))
  await button('重试上传').waitFor()
  await page.waitForFunction(() =>
    document.querySelector('.mobile-media-uploader__image img')?.src.startsWith('data:image/jpeg')
  )
  await shot('video-retry-375')
  const retried = page
    .waitForResponse((r) => r.url().endsWith('/functions/v1/media-upload') && r.status() === 200, {
      timeout: 5000
    })
    .catch(() => null)
  await button('重试上传').click({ timeout: 4000 })
  assert.ok(await retried, 'retry must issue a new successful request')
  await page.locator('.mobile-media-uploader__progress').waitFor({ state: 'hidden' })
  await button('重试上传').waitFor({ state: 'hidden' })
  assert.equal(uploads.length, 2)
  await page.locator('.mobile-evidence__preview').click()
  await page.getByRole('dialog', { name: '视频预览', exact: true }).waitFor()
  await page.waitForFunction(() => {
    const v = document.querySelector('video')
    return v?.videoWidth === 960 && v.duration > 5
  })
  await shot('video-preview-375')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: '视频预览', exact: true }).waitFor({ state: 'hidden' })
  pass('20 MiB guard prevents upload; actual MP4 retries inline and decodes in the preview')
  assert.equal(await page.getByRole('dialog', { name: '添加图片 / 视频', exact: true }).count(), 0)
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 48
    c.getContext('2d').fillRect(0, 0, 64, 48)
    return c.toDataURL('image/png').split(',')[1]
  })
  imageFixture = Buffer.from(png, 'base64')
  const imageChooser = page.waitForEvent('filechooser')
  await button('添加图片 / 视频').click()
  await (
    await imageChooser
  ).setFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await page.waitForFunction(
    () => document.querySelectorAll('.mobile-evidence__preview').length === 2
  )
  await page.locator('.mobile-media-uploader__progress').waitFor({ state: 'hidden' })
  assert.equal(await button('重试上传').count(), 0)
  await shot('mixed-media-375')
  pass('system media chooser opens directly; image and video can coexist in the same draft')
  uploadAuthFail = true
  const authChooser = page.waitForEvent('filechooser')
  await button('添加图片 / 视频').click()
  await (
    await authChooser
  ).setFiles({ name: 'auth-recovery.png', mimeType: 'image/png', buffer: imageFixture })
  await button('登录后继续上传').waitFor()
  assert.equal(await button('重试上传').count(), 0)
  await shot('upload-auth-recovery-375')
  await button('登录后继续上传').click()
  await button('使用密码登录').click()
  await field('账号或手机号').fill('13800000000')
  await field('登录密码').fill('Fixture-only-password-7!')
  await button('登录').click()
  await button('选择所在位置').waitFor()
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.mobile-evidence__preview').length === 3 &&
      !document.querySelector('.mobile-media-uploader__progress')
  )
  assert.equal(await field('今天的渔获').inputValue(), '本地接口验收：今天在水边记录。')
  assert.match(await button('选择所在位置').innerText(), /太湖/)
  assert.equal(await button('登录后继续上传').count(), 0)
  pass(
    'authentication failure offers login, retains the owned draft and resumes pending media after password recovery'
  )
  holdUploads = true
  const parallelChooser = page.waitForEvent('filechooser')
  await button('添加图片 / 视频').click()
  await (
    await parallelChooser
  ).setFiles(
    [1, 2, 3].map((n) => ({
      name: `parallel-${n}.png`,
      mimeType: 'image/png',
      buffer: imageFixture
    }))
  )
  for (let attempt = 0; attempt < 100 && heldUploads.length < 3; attempt++)
    await page.waitForTimeout(50)
  assert.equal(heldUploads.length, 3, 'three actual uploads must run concurrently')
  await field('今天的渔获').fill('本地接口验收：传输期间仍能编辑正文。')
  const appendChooser = page.waitForEvent('filechooser')
  await button('添加图片 / 视频').click()
  await (
    await appendChooser
  ).setFiles({ name: 'queued.png', mimeType: 'image/png', buffer: imageFixture })
  await page.getByText('等待上传', { exact: true }).waitFor()
  assert.equal(heldUploads.length, 3, 'fourth upload must wait for a slot')
  const uploadingSizes = await page
    .locator('.mobile-evidence__item')
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height))
  assert.ok(
    Math.max(...uploadingSizes) - Math.min(...uploadingSizes) < 2,
    'all attachment containers have the same height'
  )
  const removeBox = await page.locator('.mobile-evidence__remove').nth(3).boundingBox(),
    previewBox = await page.locator('.mobile-evidence__preview').nth(3).boundingBox()
  assert.ok(
    removeBox.width >= 44 &&
      removeBox.height >= 44 &&
      removeBox.y <= previewBox.y + 2 &&
      removeBox.x + removeBox.width >= previewBox.x + previewBox.width - 2,
    'remove action is at the top right with a full touch target'
  )
  await shot('parallel-progress-375')
  await page.locator('.mobile-evidence__remove').nth(3).click()
  holdUploads = false
  for (const finish of heldUploads) finish()
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.mobile-evidence__preview').length === 6 &&
      !document.querySelector('.mobile-media-uploader__progress')
  )
  await page.waitForTimeout(100)
  assert.equal(
    await page.locator('.mobile-evidence__preview').count(),
    6,
    'removed upload must never return after a late completion'
  )
  await shot('parallel-complete-375')
  pass(
    'shared uploader caps concurrency at three, accepts queued additions, preserves equal heights and cancels removed uploads'
  )

  for (const [width, height, dark, scale] of [
    [320, 640, false, 16],
    [375, 812, false, 16],
    [440, 956, false, 16],
    [812, 375, false, 16],
    [1280, 800, false, 16],
    [375, 812, true, 24],
    [320, 640, false, 32]
  ]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
    await setH5TextScale(page, scale)
    await button('选择鱼种').click()
    await dialog.waitFor()
    await search.fill('鲫')
    await page.waitForTimeout(100)
    await shot(`multi-${width}-${height}-${dark ? 'dark' : 'light'}-${scale}`)
    assert.ok(
      await dialog.evaluate((n) => {
        const r = n.getBoundingClientRect()
        return r.top >= -1 && r.bottom <= innerHeight + 1 && n.scrollWidth <= r.width + 1
      })
    )
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
  }
  pass('multi-choice sheet fits narrow, landscape, wide, dark and 200% text viewports')
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'light' })
  await setH5TextScale(page, 16)
  await button('保存并发布').click()
  await checkPublishedInFeed()
  await shot('published-catch-feed-375')
  assert.equal(writes.length, 1)
  const payload = writes[0].payload
  assert.equal(payload.location_label, '太湖')
  assert.equal(payload.location_longitude, 120.62)
  assert.equal(payload.location_latitude, 31.32)
  assert.equal(payload.additives, '果酸、虾油')
  assert.equal(payload.count, '0')
  assert.equal(payload.media.length, 6)
  assert.match(payload.occurred_at, /T\d{2}:\d{2}:00\+08:00$/)
  pass('publishing contract carries ordered media, selected time, multi-values and coarse location')
  await page.goto(`${base}/?locationcase=auto#/pages/home/index?tab=feed`, {
    waitUntil: 'domcontentloaded'
  })
  await button('关注').click()
  await button('记录鱼情').click()
  await page.waitForFunction(() =>
    document.querySelector('#post-location')?.textContent.includes('苏州市')
  )
  assert.match(await button('选择所在位置').innerText(), /工业园区/)
  assert.doesNotMatch(await button('选择所在位置').innerText(), /私密门牌/)
  await button('分享心得').click()
  await field('分享你的心得').fill('今天试了两种饵料，记录一下水边的观察。')
  await button('保存并发布').click()
  await checkPublishedInFeed()
  assert.equal(writes.length, 2)
  assert.equal(writes[1].payload.kind, 'experience')
  await shot('published-experience-feed-375')
  pass(
    'new catches and experiences open the refreshed recommended feed from direct and in-app entry'
  )
  await page.goto(`${base}/?fixture-location=late#/pages/post/compose?locationcase=late`, {
    waitUntil: 'domcontentloaded'
  })
  await button('选择所在位置').click()
  await button('改用地点搜索与静态预览').click()
  await field('搜索高德地点').fill('手动选择的水域')
  await page.getByRole('option', { name: /手动选择的水域/ }).click()
  await button('确认这处水域').click()
  await button('选择所在位置').waitFor()
  await page.waitForTimeout(3400)
  assert.match(await button('选择所在位置').innerText(), /手动选择的水域/)
  await shot('location-automatic-and-manual-375')
  pass(
    'default area location excludes street address; late automatic results cannot replace a manual choice'
  )
  assert.deepEqual(errors, [])
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify(
      {
        scope: 'isolated UI contract; no hosted calls, SMS or true map fixture',
        checks,
        searches,
        uploads: uploads.length,
        screenshots: await (await import('node:fs/promises'))
          .readdir(output)
          .then((xs) => xs.filter((x) => x.endsWith('.png')))
      },
      null,
      2
    )
  )
  console.log(`${checks.length} publishing UI groups passed`)
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png') })
  console.error(await page.locator('body').innerText())
  throw error
} finally {
  await browser.close()
  if (server) await new Promise((done) => server.close(done))
}
