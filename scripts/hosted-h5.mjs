// Real browser/business acceptance, driven only by test-hosted-business.ps1.
// No mock API responses and no phone-login claim. Temporary sessions arrive on
// stdin, never in source, command arguments, environment variables, or artifacts.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { chatAttachments } from './hosted-chat-attachments.mjs'
import { realtime } from './hosted-realtime.mjs'
import { zones } from './hosted-zones.mjs'
import { tripCatchesFlow } from './trip-catches-flow.mjs'
import { commentsFlow } from './comments-flow.mjs'
import { commentModerationFlow } from './comment-moderation-flow.mjs'
import { notificationsFlow } from './notifications-flow.mjs'
import { compositionFlow } from './composition-flow.mjs'
import { contentUpdatesFlow } from './content-updates-flow.mjs'
import { spotPhotosFlow } from './spot-photos-flow.mjs'
import { amapWebServiceFlow } from './amap-web-service-flow.mjs'

const project = 'https://jupuypvmgjpnpntfetqv.supabase.co'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5179'
assert.ok(
  /^http:\/\/127\.0\.0\.1:(5178|5179|5181)$/.test(base),
  'Acceptance must use a local H5 server'
)
let input = ''
for await (const chunk of process.stdin) input += chunk
const data = JSON.parse(input)
input = ''
assert.match(data.run, /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)
assert.ok(
  [
    'h5-amap',
    'h5-large-photo',
    'h5-media',
    'h5-social',
    'h5-chat-attachments',
    'h5-realtime',
    'h5-zones',
    'h5-trip-catches',
    'h5-comments',
    'h5-comment-moderation',
    'h5-notifications',
    'h5-composition',
    'h5-content-updates',
    'h5-spot-photos',
    'h5-report',
    'h5-report-manual'
  ].includes(data.suite)
)
const directory = resolve('artifacts/hosted-business', data.run)
await mkdir(directory, { recursive: true })
const checks = []
const network = []
let phase = 'browser-start',
  page,
  passed = false,
  failureKind = '',
  pageErrors = 0
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
function check(condition, label) {
  assert.ok(condition, label)
  checks.push(label)
}
async function accountPage(label) {
  const session = data.accounts.find((a) => a.label === label)?.session
  assert.ok(session?.access_token && session?.refresh_token)
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    locale: 'zh-CN',
    ...(data.suite.startsWith('h5-report') || data.suite === 'h5-amap' ? {
      permissions: ['geolocation'], geolocation: { longitude: 114.19, latitude: 30.51 }
    } : {}),
    reducedMotion: 'reduce'
  })
  await context.addInitScript(
    ({ session, base }) => {
      if (location.origin === base && !localStorage.getItem('dyj.auth.v1'))
        localStorage.setItem('dyj.auth.v1', JSON.stringify({ type: 'object', data: session }))
    },
    { session, base }
  )
  const tab = await context.newPage()
  if (data.suite === 'h5-realtime')
    await context.addInitScript(() => {
      // Disable ONLY existing business polling, not SDK heartbeats/retries.
      const original = window.setInterval.bind(window)
      window.setInterval = (callback, delay, ...args) =>
        original(delay === 5000 || delay === 10000 ? () => {} : callback, delay, ...args)
    })
  tab.setDefaultTimeout(20000)
  tab.on('pageerror', () => pageErrors++)
  tab.on('response', (reply) => {
    const url = new URL(reply.url())
    if (url.origin !== project) return
    // Path only; signed image query strings and request bodies are sensitive.
    network.push({ method: reply.request().method(), path: url.pathname, status: reply.status() })
  })
  return tab
}
const button = (tab, name) => tab.getByRole('button', { name, exact: true })
const field = (tab, label) =>
  tab.locator(`input[aria-label="${label}"],textarea[aria-label="${label}"]`)
const go = (tab, path) => tab.goto(`${base}/#${path}`)
function replyFor(tab, action) {
  return tab.waitForResponse(
    (reply) => {
      const request = reply.request()
      if (!reply.url().startsWith(`${project}/rest/v1/rpc/fishing_`)) return false
      try {
        return request.postDataJSON().action === action
      } catch {
        return false
      }
    },
    { timeout: 50000 }
  )
}
async function shot(name, tab = page, fullPage = true) {
  // A full-page screenshot does not trigger lazy images below the viewport.
  // Wait for real image rendering, not merely for the surrounding post text.
  for (const photo of await tab.locator('.photo-action, .mobile-media-gallery__preview:not(:has(.mobile-media-gallery__play))').all()) {
    await photo.scrollIntoViewIfNeeded()
    await photo.locator('img').waitFor()
    await photo.locator('img').evaluate((image) => {
      if (image.complete && image.naturalWidth > 0) return
      return new Promise((resolve, reject) => {
        image.addEventListener('load', resolve, { once: true })
        image.addEventListener('error', reject, { once: true })
        setTimeout(() => reject(new Error('Image not rendered')), 35000)
      })
    })
  }
  await tab.evaluate(() => window.scrollTo(0, 0))
  await tab.screenshot({ path: resolve(directory, `${name}.png`), fullPage })
}
async function fits(label, tab = page) {
  const dimensions = await tab.evaluate(() => ({
    client: document.documentElement.clientWidth,
    content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  }))
  check(dimensions.content <= dimensions.client + 1, label)
}
async function upload(tab, photo, mimeType = 'image/png') {
  const chooser = tab.waitForEvent('filechooser')
  await tab.getByRole('button', { name: /^添加照片/ }).click()
  await (
    await chooser
  ).setFiles({
    name: mimeType === 'image/jpeg' ? 'synthetic-acceptance.jpg' : 'synthetic-acceptance.png',
    mimeType,
    buffer: photo
  })
}
async function largePhoto() {
  phase = 'large-photo-compose'
  await go(page, '/pages/post/compose')
  await field(page, '标题').fill('大图上传·私密验收')
  await field(page, '鱼情与心得').fill('合成图像测试，非真实渔获或举报，验收完成后清理。')
  await button(page, '分享范围').click()
  await button(page, '仅自己').click()
  const assets = []
  for (const [name, input, width, height] of [
    ['textured', data.largePhoto, 2048, 1536],
    ['portrait', data.portraitPhoto, 1536, 2048]
  ]) {
    phase = `large-photo-${name}`
    const source = Buffer.from(input, 'base64')
    const uploaded = page.waitForResponse(
      (r) => r.url() === `${project}/functions/v1/media-upload`,
      { timeout: 55000 }
    )
    await upload(page, source, 'image/jpeg')
    const response = await uploaded
    check(response.status() === 200, `H5 12MP ${name} photo uploads through the real service`)
    const asset = await response.json()
    assets.push(asset)
    check(
      asset.width === width && asset.height === height,
      `H5 12MP ${name} photo keeps aspect ratio within 2048 pixels`
    )
    await page.waitForFunction(
      () => ![...document.querySelectorAll('uni-text')].some((e) => e.textContent === '上传中…')
    )
    // Read the selected preview after upload/disposal: the original blob must still exist unchanged.
    const hash = await page
      .locator('.photo-grid .photo img')
      .last()
      .evaluate(async (img) => {
        const response = await fetch(img.src)
        const bytes = await response.arrayBuffer()
        const digest = await crypto.subtle.digest('SHA-256', bytes)
        return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('')
      })
    check(
      hash === createHash('sha256').update(source).digest('hex'),
      `H5 ${name} source remains readable and byte-identical after upload`
    )
  }
  phase = 'large-photo-local-rejection'
  const before = network.filter(
    (r) => r.path === '/functions/v1/media-upload' && r.method === 'POST'
  ).length
  // Unsupported content is stopped locally. Do not coerce arbitrary SVG into a supported photo.
  await upload(
    page,
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"></svg>'),
    'image/svg+xml'
  )
  await page.getByRole('alert').filter({ hasText: '仅支持 JPG 或 PNG' }).waitFor()
  check(
    (await button(page, '重试照片').count()) === 0,
    'H5 unsupported photo offers removal instead of retrying the same invalid file'
  )
  check(
    network.filter((r) => r.path === '/functions/v1/media-upload' && r.method === 'POST').length ===
      before,
    'H5 unsupported photo is rejected before any cloud upload'
  )
  check(
    (await field(page, '标题').inputValue()) === '大图上传·私密验收',
    'H5 rejected photo preserves the existing text and uploaded photos'
  )
  await page.setViewportSize({ width: 320, height: 812 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addStyleTag({ content: 'html{font-size:24px!important}' })
  await fits('H5 photo format error fits dark 320 with large text')
  check(
    await page
      .locator('.photo-entry--failed')
      .evaluate(
        (e) => e.getBoundingClientRect().width >= e.parentElement.getBoundingClientRect().width - 1
      ),
    'H5 failed photo message uses a full row in the narrow large-text layout'
  )
  await shot('large-photo-error-dark-320')
  await button(page, '移除照片 3').click()
  phase = 'large-photo-save'
  const saved = replyFor(page, 'save_post')
  await button(page, '保存并发布').click()
  const response = await saved
  check(response.status() === 200, 'H5 optimized photos save with the private post')
  const post = await response.json()
  check(
    post.audience === 'private' && post.media.length === 2,
    'H5 optimized photo post remains private'
  )
  phase = 'large-photo-detail'
  await page.waitForURL(/#\/(?:pages\/home\/index)?\?tab=feed$/)
  await go(page, `/pages/post/detail?id=${post.id}`)
  await button(page, '编辑这条鱼情').waitFor()
  phase = 'large-photo-render'
  await shot('large-photo-detail-dark-320')
  phase = 'large-photo-dimensions'
  const actual = await page
    .locator('.photo-action img')
    .evaluateAll((images) =>
      images.map((img) => ({ width: img.naturalWidth, height: img.naturalHeight }))
    )
  check(
    actual.length === 2 &&
      actual[0].width === 2048 &&
      actual[0].height === 1536 &&
      actual[1].width === 1536 &&
      actual[1].height === 2048,
    'H5 stored optimized JPEGs render their actual upright dimensions'
  )
  // Sample the downloaded portrait via a local canvas, not just its metadata.
  phase = 'large-photo-upright'
  const upright = await page
    .locator('.photo-action img')
    .last()
    .evaluate(async (img) => {
      const blob = await (await fetch(img.src)).blob()
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(bitmap, 0, 0)
      const top = ctx.getImageData(1400, 100, 1, 1).data,
        bottom = ctx.getImageData(1400, 1900, 1, 1).data
      bitmap.close()
      return top[0] > 200 && bottom[0] < 100
    })
  check(upright, 'H5 EXIF portrait pixels remain upright after client and server processing')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize({ width: 812, height: 375 })
  await fits('H5 optimized photo detail fits landscape with large text')
  await shot('large-photo-detail-landscape')
  const other = await accountPage('outsider')
  const denied = replyFor(other, 'post')
  await go(other, `/pages/post/detail?id=${post.id}`)
  check(
    [400, 403, 404].includes((await denied).status()),
    'H5 optimized private post is denied to another account'
  )
}
async function media() {
  phase = 'media-compose'
  await go(page, '/pages/post/compose')
  await field(page, '标题').fill('私人鱼情·界面验收')
  await field(page, '鱼情与心得').fill('系统验收记录，虚构鱼情，仅临时账号可见，完成后删除。')
  // Explicitly choose private even if the product default later changes.
  await button(page, '分享范围').click()
  await button(page, '仅自己').click()
  phase = 'media-upload'
  const photo = Buffer.from(data.photo, 'base64')
  const uploaded = page.waitForResponse((r) => r.url() === `${project}/functions/v1/media-upload`, {
    timeout: 55000
  })
  await upload(page, photo)
  check(
    (await uploaded).status() === 200,
    'H5 file chooser uploads a real photo to the confirmed project'
  )
  await button(page, '移除照片 1').waitFor()
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll('uni-text')).some((e) => e.textContent === '上传中…')
  )
  phase = 'media-offline-recovery'
  await page.context().setOffline(true)
  await upload(page, photo)
  await button(page, '重试照片').waitFor()
  check(
    (await page.getByRole('alert').count()) > 0,
    'H5 failed upload exposes an accessible error announcement'
  )
  check(
    (await field(page, '标题').inputValue()) === '私人鱼情·界面验收',
    'H5 simulated offline upload retains typed content and exposes retry'
  )
  await page.setViewportSize({ width: 320, height: 812 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await fits('H5 upload error fits dark 320 viewport')
  await shot('upload-error-dark-320')
  await page.context().setOffline(false)
  const retried = page.waitForResponse((r) => r.url() === `${project}/functions/v1/media-upload`, {
    timeout: 55000
  })
  await button(page, '重试照片').click()
  check(
    (await retried).status() === 200,
    'H5 photo retry reaches the real upload service successfully'
  )
  await button(page, '重试照片').waitFor({ state: 'hidden' })
  phase = 'media-save-private'
  const saved = replyFor(page, 'save_post')
  await button(page, '保存并发布').click()
  const result = await saved
  check(result.status() === 200, 'H5 private post saves through the real user RPC')
  const post = await result.json()
  check(
    post.audience === 'private' && post.media.length === 2,
    'H5 saved post is private and owns both uploaded photos'
  )
  await page.waitForURL(/#\/(?:pages\/home\/index)?\?tab=feed$/)
  await go(page, `/pages/post/detail?id=${post.id}`)
  await button(page, '编辑这条鱼情').waitFor()
  const images = page.locator('.photo-action img')
  await images.first().waitFor()
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('.photo-action img')]
    return images.length === 2 && images.every((image) => image.complete && image.naturalWidth > 0)
  })
  check(true, 'H5 private photo signatures render actual storage images')
  check(
    (await page.locator('.photo-grid--full').count()) === 1,
    'H5 private detail uses full photo presentation instead of feed thumbnails'
  )
  await fits('H5 real private detail fits dark 320 viewport')
  await shot('private-detail-dark-320')
  phase = 'media-owner-edit'
  await button(page, '编辑这条鱼情').click()
  await field(page, '标题').fill('私人鱼情·已编辑')
  const edited = replyFor(page, 'update_content')
  await button(page, '保存修改').click()
  check((await edited).status() === 200, 'H5 owner edit persists through the real RPC')
  await button(page, '编辑这条鱼情').waitFor()
  await page.reload()
  await page.getByText('私人鱼情·已编辑', { exact: true }).waitFor()
  check(true, 'H5 edited private content survives a fresh page load')
  await page.emulateMedia({ colorScheme: 'light' })
  for (const [width, height] of [
    [375, 812],
    [440, 956],
    [812, 375],
    [1280, 800]
  ]) {
    await page.setViewportSize({ width, height })
    await fits(`H5 real private detail fits ${width} viewport`)
    await shot(`private-detail-${width}`)
  }
  await page.setViewportSize({ width: 320, height: 812 })
  await page.addStyleTag({ content: 'html{font-size:24px!important}' })
  await fits('H5 real private detail fits 320 with 150 percent text')
  await shot('private-detail-large-text-320')
  phase = 'media-other-account'
  const other = await accountPage('outsider')
  const denied = replyFor(other, 'post')
  await go(other, `/pages/post/detail?id=${post.id}`)
  check(
    [400, 403, 404].includes((await denied).status()),
    'H5 other account cannot read the private detail'
  )
  check(
    (await other.getByText('私人鱼情·已编辑', { exact: true }).count()) === 0,
    'H5 other account never displays private text'
  )
  await shot('private-detail-other-account', other)
}
async function social() {
  phase = 'chat-open'
  await go(page, `/pages/chat/index?id=${data.conversation}`)
  const receiver = await accountPage('b')
  await go(receiver, `/pages/chat/index?id=${data.conversation}`)
  const composer = field(page, '发送给钓友的消息')
  const message = '界面验收：岸边风小，明天再聊。'
  await composer.fill(message)
  check(
    (await composer.getAttribute('aria-describedby')) === 'chat-message-count',
    'H5 editable chat input has its own accessible name and count description'
  )
  check(
    await page.locator('.chat-input').evaluate((e) => getComputedStyle(e).outlineStyle !== 'none'),
    'H5 chat composer exposes a visible keyboard focus indicator'
  )
  phase = 'chat-send'
  const sent = replyFor(page, 'send_message')
  await button(page, '发送').click()
  check((await sent).status() === 200, 'H5 sender persists a message through the real RPC')
  await page.getByText('已发送', { exact: true }).waitFor()
  await receiver.getByText(message, { exact: true }).waitFor()
  check(true, 'H5 second account receives the real message through normal polling')
  check((await composer.inputValue()) === '', 'H5 successful send clears the composer')
  phase = 'chat-offline-recovery'
  const pending = '界面验收：断网保留这条消息，恢复后只发送一次。'
  await page.context().setOffline(true)
  await composer.fill(pending)
  await button(page, '发送').click()
  await button(page, '重试这条消息').waitFor()
  await page.setViewportSize({ width: 320, height: 812 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await fits('H5 failed chat fits dark 320 viewport')
  await shot('chat-offline-dark-320')
  await page.context().setOffline(false)
  const retried = replyFor(page, 'send_message')
  await button(page, '重试这条消息').click()
  check((await retried).status() === 200, 'H5 failed message retries against the real service')
  await button(page, '重试这条消息').waitFor({ state: 'hidden' })
  await receiver.getByText(pending, { exact: true }).waitFor()
  await receiver.reload()
  await receiver.getByText(pending, { exact: true }).waitFor()
  check(
    (await receiver.getByText(pending, { exact: true }).count()) === 1,
    'H5 receiver reload shows exactly one retried message'
  )
  phase = 'chat-layout'
  await page.emulateMedia({ colorScheme: 'light' })
  for (const [width, height] of [
    [375, 812],
    [440, 956],
    [812, 375],
    [1280, 800]
  ]) {
    await page.setViewportSize({ width, height })
    await fits(`H5 real chat fits ${width} viewport`)
    await page.waitForFunction(() => {
      const send = [...document.querySelectorAll('.chat-composer [role="button"]')].find(
        (b) => b.textContent.trim() === '发送'
      )
      const box = send?.getBoundingClientRect()
      return box && box.top >= 0 && box.bottom <= window.innerHeight + 1
    })
    const send = await button(page, '发送').boundingBox()
    check(
      send && send.y >= 0 && send.y + send.height <= height + 1,
      `H5 chat send remains in ${width} viewport`
    )
    await shot(`chat-${width}`)
  }
  await page.setViewportSize({ width: 320, height: 812 })
  await page.addStyleTag({ content: 'html{font-size:24px!important}' })
  await fits('H5 real chat fits 320 with 150 percent text')
  await shot('chat-large-text-320')
}
async function waterReport() {
  const manual = data.suite === 'h5-report-manual'
  phase = 'report-edit'
  await go(page, '/pages/water-report/index')
  await page.locator('#report-region').click()
  const region = page.getByRole('dialog', { name: '选择事发地区', exact: true })
  await region.locator('input[aria-label="搜索地区"]').fill('汉阳区')
  await region.getByRole('button', { name: '选择汉阳区', exact: true }).click()
  await field(page, '现场情况').fill(
    '系统验收虚构线索，并非真实事件，不向任何机关发送，测试后删除。'
  )
  if (manual) {
    phase = 'report-manual-location'
    await field(page, '具体水域与位置').fill('手动填写的测试水域')
    const writes = () => network.filter(r => r.path.endsWith('/fishing_write')).length
    const before = writes()
    await button(page, '上报').click()
    await page.getByText('请选择事发水域，获取经纬度', { exact: true }).waitFor()
    check(writes() === before, 'H5 requires a selected water coordinate before saving a report')
    return
  } else {
    phase = 'report-amap-selection'
    await button(page, '水域地图选点').click()
    const search = page.locator('input[name="map-search"]')
    await search.waitFor()
    await page.waitForFunction(
      () => window.AMap && !document.body.innerText.includes('正在加载高德地图')
    )
    await search.fill('北太子湖')
    await search.press('Enter')
    await page.getByRole('option').first().waitFor({ timeout: 30000 })
    await page.getByRole('option').first().click()
    await button(page, '确认这处水域').click()
    await page.getByText(/^已选位置：/).waitFor()
    check(
      (await field(page, '具体水域与位置').inputValue()).includes('北太子湖'),
      'H5 report receives a real AMap search selection through normal navigation'
    )
    check(
      (await field(page, '现场情况').inputValue()) ===
        '系统验收虚构线索，并非真实事件，不向任何机关发送，测试后删除。',
      'H5 report preserves entered material while choosing a map location'
    )
  }
  phase = 'report-attachment'
  const uploaded = page.waitForResponse(r => r.url() === `${project}/functions/v1/media-upload` && r.request().method() === 'POST')
  const chooser = page.waitForEvent('filechooser')
  await button(page, '添加图片 / 视频').click()
  await (
    await chooser
  ).setFiles({
    name: 'synthetic-report.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data.photo, 'base64')
  })
  check((await uploaded).ok(), 'H5 uploads a selected report image directly')
  phase = 'report-save'
  const saved = replyFor(page, 'save_water_report')
  await button(page, '上报').click()
  const response = await saved
  check(response.status() === 200, 'H5 report saves through the real user RPC')
  const report = await response.json()
  check(
    report.status === 'saved' &&
      report.media.length === 1 &&
      Number.isFinite(report.longitude) && Number.isFinite(report.latitude),
    'H5 report privately stores the selected coordinates and owned evidence'
  )
  await page.getByText('到官方渠道完成上报', { exact: true }).waitFor()
  const agencies=page.getByRole('dialog',{name:'选择举报机构',exact:true})
  await agencies.waitFor()
  check(true, 'H5 report explicitly distinguishes private storage from official delivery')
  await shot('report-saved-375')
  await page.setViewportSize({ width: 320, height: 812 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addStyleTag({ content: 'html{font-size:24px!important}' })
  await fits('H5 real private report fits dark 320 with 150 percent text')
  await shot('report-large-text-dark-320')
  phase = 'report-confirmations'
  await agencies.getByRole('button',{name:'复制文字材料',exact:true}).click()
  const copy = page.getByRole('dialog', { name: '复制私密材料？' })
  await copy.waitFor()
  check(
    (await page.evaluate(() => document.activeElement?.textContent?.trim())) === '取消',
    'H5 private material copy confirmation initially focuses cancel'
  )
  await shot('report-copy-confirm-dark-320', page, false)
  await copy.getByRole('button', { name: '取消', exact: true }).click()
  await copy.waitFor({ state: 'hidden' })
  await agencies.getByRole('button',{name:'关闭机构选择',exact:true}).click()
  await agencies.waitFor({state:'hidden'})
  await button(page,'举报联系方式').click()
  const phone = page.getByRole('button', { name: /^拨打/ }).first()
  await phone.click()
  const dial = page.getByRole('dialog', { name: '打开拨号？' })
  await dial.waitFor()
  await dial.getByRole('button', { name: '取消', exact: true }).click()
  await dial.waitFor({ state: 'hidden' })
  check(true, 'H5 official channel contact is cancellable and no real call is made')
  phase = 'report-privacy'
  const other = await accountPage('outsider')
  const denied = replyFor(other, 'water_reports')
  await go(other, `/pages/water-report/index?id=${report.id}`)
  check(
    [400, 403, 404].includes((await denied).status()),
    'H5 other account cannot open private report material'
  )
  phase = 'report-delete'
  await button(page, '返回上报记录').click()
  await button(page, '查看详情').waitFor()
  await button(page, '删除材料').click()
  await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click()
  // The closing popup briefly contains a second button with the same label.
  // Wait for dismissal before testing the next independent user action.
  await page.getByRole('alertdialog').waitFor({ state: 'hidden' })
  await button(page, '查看详情').waitFor()
  check(true, 'H5 cancelling report deletion preserves the history entry')
  await button(page, '删除材料').click()
  const removed = replyFor(page, 'delete_water_report')
  await page.getByRole('alertdialog').getByRole('button', { name: '删除材料', exact: true }).click()
  check((await removed).status() === 200, 'H5 confirmed report deletion reaches the real service')
  await page.getByText('还没有保存的上报记录。', { exact: true }).waitFor()
  check(true, 'H5 deleted report disappears from private history')
}
try {
  page = await accountPage('a')
  if (data.suite === 'h5-amap')
    await amapWebServiceFlow({ page, project, button, field, go, shot, fits, check, setPhase: value => { phase = value } })
  else if (data.suite === 'h5-large-photo') await largePhoto()
  else if (data.suite === 'h5-media') await media()
  else if (data.suite === 'h5-social') await social()
  else if (data.suite === 'h5-spot-photos')
    await spotPhotosFlow({ page, data, project, button, field, go, replyFor, shot, fits, check, accountPage, setPhase: value => { phase = value } })
  else if (data.suite === 'h5-content-updates')
    await contentUpdatesFlow({
      page,
      data,
      project,
      button,
      field,
      go,
      replyFor,
      shot,
      check,
      accountPage,
      setPhase: (value) => {
        phase = value
      }
    })
  else if (data.suite === 'h5-composition')
    await compositionFlow({
      page,
      data,
      project,
      button,
      field,
      go,
      replyFor,
      shot,
      check,
      setPhase: (value) => (phase = value)
    })
  else if (data.suite === 'h5-notifications')
    await notificationsFlow({
      page,
      data,
      project,
      button,
      go,
      replyFor,
      shot,
      check,
      accountPage,
      setPhase: (value) => {
        phase = value
      }
    })
  else if (data.suite === 'h5-comment-moderation')
    await commentModerationFlow({
      page,
      data,
      project,
      button,
      field,
      go,
      replyFor,
      shot,
      check,
      accountPage,
      setPhase: (value) => {
        phase = value
      }
    })
  else if (data.suite === 'h5-comments')
    await commentsFlow({
      page,
      data,
      project,
      button,
      field,
      go,
      replyFor,
      shot,
      fits,
      check,
      setPhase: (value) => {
        phase = value
      }
    })
  else if (data.suite === 'h5-trip-catches')
    await tripCatchesFlow({
      page,
      data,
      project,
      button,
      field,
      go,
      replyFor,
      shot,
      fits,
      check,
      setPhase: (value) => {
        phase = value
      }
    })
  else if (data.suite === 'h5-zones')
    await zones({
      page,
      data,
      project,
      accountPage,
      button,
      field,
      go,
      replyFor,
      shot,
      fits,
      check,
      setPhase: (value) => {
        phase = value
      }
    })
  else if (data.suite === 'h5-realtime')
    await realtime({
      page,
      data,
      project,
      accountPage,
      button,
      field,
      go,
      replyFor,
      shot,
      fits,
      check,
      setPhase: (value) => {
        phase = value
      }
    })
  else if (data.suite === 'h5-chat-attachments')
    await chatAttachments({
      page,
      data,
      project,
      accountPage,
      button,
      field,
      go,
      replyFor,
      shot,
      fits,
      check,
      setPhase: (value) => {
        phase = value
      }
    })
  else await waterReport()
  phase = 'no-page-errors'
  check(pageErrors === 0, 'H5 business pages have no uncaught browser exceptions')
  passed = true
} catch (error) {
  // Never serialize Playwright errors: they can include credential-bearing URLs.
  failureKind =
    error?.name === 'TimeoutError'
      ? 'browser-timeout'
      : error?.message?.includes('strict mode violation')
        ? 'selector-ambiguous'
        : error?.code === 'ERR_ASSERTION'
          ? 'assertion'
          : error?.message?.includes('Image not rendered')
            ? 'image-render-timeout'
            : 'browser-operation'
  try {
    if (page) await shot(`failed-${phase}`)
  } catch {
    /* no page left */
  }
} finally {
  await browser.close()
  await writeFile(
    resolve(directory, 'result.json'),
    JSON.stringify({ passed, phase, failureKind, checks, network }, null, 2)
  )
  process.stdout.write(JSON.stringify({ passed, phase, checks }))
  process.exitCode = passed ? 0 : 1
}
