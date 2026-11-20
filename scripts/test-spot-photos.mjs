// Browser contract/visual acceptance. Auth, uploads and business transport are isolated fixtures.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setH5TextScale } from './h5-text-scale.mjs'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname))
const output = resolve(process.env.FISHING_SPOT_PHOTO_ARTIFACTS || 'artifacts/spot-photos/ui')
await mkdir(output, { recursive: true })
const owner = '11111111-1111-4111-8111-111111111111',
  id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const profile = {
  id: owner,
  nickname: '钓位验收',
  handle: 'TESTSPOT',
  city: '苏州',
  method: '台钓',
  bio: ''
}
const draft = {
  id,
  name: '芦苇湾测试钓位',
  city: '苏州',
  water_type: '自然水域',
  species: '鲫鱼',
  description: '本机界面验收，非真实水域。',
  fee_note: '未核实',
  access_note: '',
  observed_on: '2026-11-20',
  audience: 'private',
  precision: 'hidden',
  longitude: null,
  latitude: null,
  media: []
}
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width: 375, height: 812 },
  locale: 'zh-CN',
  reducedMotion: 'reduce'
})
const photo = await readFile(resolve('assets/brand/fish-symbol.png'))
const errors = [],
  escaped = [],
  checks = [],
  mutations = [],
  uploads = [],
  assets = new Map()
let saved
const pass = (message) => {
  checks.push(message)
  console.log('PASS', message)
}
await context.addInitScript(
  ({ owner, draft }) => {
    if (localStorage.getItem('spot-photo-fixture')) return
    localStorage.setItem('spot-photo-fixture', '1')
    localStorage.setItem(
      'dyj.auth.v1',
      JSON.stringify({
        type: 'object',
        data: {
          access_token: 'spot-photo-fixture',
          refresh_token: 'fixture',
          expires_at: Date.now() / 1000 + 3600,
          user: { id: owner }
        }
      })
    )
    localStorage.setItem(
      `dyj.live.spot-draft.${owner}`,
      JSON.stringify({ type: 'object', data: draft })
    )
  },
  { owner, draft }
)
await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
await context.route('**/*', async (route) => {
  const request = route.request(),
    url = new URL(request.url())
  if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
  const reply = (json, status = 200) =>
    route.fulfill({
      status,
      json,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': '*'
      }
    })
  if (url.origin !== 'https://tlfmfokyhahlpzmpliad.supabase.co') {
    escaped.push(url.origin)
    return route.abort()
  }
  if (request.method() === 'OPTIONS') return reply({})
  if (url.pathname === '/auth/v1/user') return reply({ id: owner })
  if (url.pathname === '/functions/v1/media-upload') {
    const index = uploads.length + 1
    let release
    const pending = new Promise((resolve) => {
      release = resolve
    })
    uploads.push({ release })
    const status = await pending
    if (status !== 200) return reply({ error: 'STORAGE_UNAVAILABLE' }, status)
    const assetId = `${String(index).padStart(8, '0')}-4444-4444-8444-444444444444`
    const asset = {
      id: assetId,
      path: `${owner}/${assetId}.jpg`,
      kind: 'image',
      width: 128,
      height: 96
    }
    assets.set(assetId, asset)
    return reply(asset)
  }
  if (request.method() === 'POST' && url.pathname.startsWith('/storage/v1/object/sign/'))
    return reply({
      signedURL: `/object/sign/fishing-media/fixture/${url.pathname.split('/').at(-1)}?token=fixture`
    })
  if (url.pathname.startsWith('/storage/v1/object/'))
    return route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: photo,
      headers: { 'access-control-allow-origin': '*' }
    })
  if (url.pathname.endsWith('fishing_moderation')) return reply({ allowed: false })
  if (url.pathname.endsWith('fishing_read')) {
    const { action } = request.postDataJSON()
    if (action === 'profile') return reply(profile)
    if (action === 'spot') return reply(saved)
    if (action === 'edit_content')
      return reply({
        item: saved,
        revision: saved.review_revision,
        publication: { status: saved.status, audience: saved.audience, precision: saved.precision }
      })
    if (action === 'social') return reply({ friends: [], requests: [], conversations: [] })
    return reply({ items: [], next: null })
  }
  if (url.pathname.endsWith('fishing_write')) {
    const { action, payload } = request.postDataJSON()
    assert.ok(['save_spot', 'update_content'].includes(action))
    mutations.push({ action, payload })
    saved = {
      ...payload,
      media: payload.media.map((m) => assets.get(m.id)),
      author: profile,
      status: 'published',
      saved: false,
      review_revision: (saved?.review_revision || 0) + 1,
      created_at: new Date().toISOString()
    }
    return reply(action === 'save_spot' ? saved : { id, revision: saved.review_revision })
  }
  if (url.pathname.startsWith('/rest/')) return reply([])
  escaped.push(url.pathname)
  return route.abort()
})
const page = await context.newPage()
page.setDefaultTimeout(15000)
page.on('pageerror', (e) => errors.push(e.message))
const items = () => page.locator('.mobile-evidence__item:visible')
const waitUploads = async (count) => {
  const until = Date.now() + 15000
  while (uploads.length < count && Date.now() < until) await page.waitForTimeout(60)
  assert.equal(uploads.length, count)
}
try {
  await page.goto(`${base}/#/pages/spot/create`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '添加照片', exact: true }).waitFor()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '添加照片', exact: true }).click()
  await (
    await chooser
  ).setFiles(
    ['一', '二'].map((name) => ({ name: `${name}.png`, mimeType: 'image/png', buffer: photo }))
  )
  await waitUploads(2)
  assert.equal(await items().count(), 2)
  assert.equal(
    await page.getByRole('button', { name: '保存钓位', exact: true }).getAttribute('aria-disabled'),
    'true'
  )
  uploads[0].release(200)
  uploads[1].release(503)
  await page.getByRole('button', { name: /重试上传/ }).waitFor()
  await page.locator('.mobile-evidence__grid:visible').scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(output, 'retry-375.png') })
  await page.getByRole('button', { name: /重试上传/ }).click()
  await waitUploads(3)
  uploads[2].release(200)
  await page.waitForFunction(
    () => ![...document.querySelectorAll('.mobile-media-uploader__progress')].length
  )
  pass('钓位复用公共上传，图片并行、失败单项重试、上传中禁止保存')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelectorAll('.mobile-evidence__item').length === 2)
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.mobile-evidence__item img')].filter((n) => n.naturalWidth > 0)
        .length === 2
  )
  const rendered = await items()
    .locator('img')
    .evaluateAll((nodes) => nodes.filter((n) => n.naturalWidth > 0).length)
  assert.equal(rendered, 2)
  pass('重进新建页恢复当前账号照片并重新获取签名')
  for (const [width, height, size, scheme] of [
    [320, 740, 16, 'light'],
    [375, 812, 16, 'light'],
    [440, 956, 16, 'light'],
    [812, 375, 16, 'light'],
    [1280, 800, 16, 'dark'],
    [320, 740, 24, 'dark'],
    [375, 812, 32, 'dark']
  ]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: scheme })
    await setH5TextScale(page, size)
    await page.locator('.mobile-evidence__grid:visible').scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    const boxes = await items().evaluateAll((nodes) =>
      nodes.map((n) => {
        const b = n.getBoundingClientRect(),
          r = n.querySelector('.mobile-evidence__remove').getBoundingClientRect()
        return { h: b.height, rw: r.width, rh: r.height }
      })
    )
    assert.ok(boxes.every((b) => b.rw >= 44 && b.rh >= 44))
    assert.ok(Math.abs(boxes[0].h - boxes[1].h) < 2)
    await page.screenshot({ path: resolve(output, `editor-${width}-${size}-${scheme}.png`) })
  }
  pass('320／375／440、横屏、宽屏、深色及大字的照片区域保持可用')
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'light' })
  await setH5TextScale(page, 16)
  await page.getByRole('button', { name: '保存钓位', exact: true }).click()
  await page.waitForURL(/pages\/spot\/detail/)
  assert.equal(mutations.length, 1)
  assert.deepEqual(
    mutations[0].payload.media.map((m) => Object.keys(m)),
    [['id'], ['id']]
  )
  const previews = page.getByRole('button', { name: /钓位现场照片，查看大图/ })
  await previews.first().waitFor()
  assert.equal(await previews.count(), 2)
  await previews.first().click()
  await page.waitForTimeout(250)
  await page.screenshot({ path: resolve(output, 'preview-375.png') })
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  pass('保存只提交照片ID，详情能查看完整照片并打开预览')
  await page.getByRole('button', { name: '编辑与分享设置', exact: true }).click()
  await page.waitForURL(/pages\/spot\/create\?id=/)
  await items().first().waitFor()
  assert.equal(await items().count(), 2)
  await items().first().locator('.mobile-evidence__remove').click()
  assert.equal(await items().count(), 1)
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await page.waitForURL(/pages\/spot\/detail/)
  assert.equal(mutations[1].payload.media.length, 1)
  await previews.first().waitFor()
  assert.equal(await previews.count(), 1)
  await previews.first().scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(output, 'detail-375.png') })
  pass('编辑恢复原照片，右上角移除后保存结果与详情一致')
  assert.deepEqual(errors, [])
  assert.deepEqual(escaped, [])
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        checks,
        errors,
        escaped,
        boundary:
          'Isolated HTTP/session contract; actual local image decoding and screenshots, not hosted authentication or native device evidence.'
      },
      null,
      2
    )
  )
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {})
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify({ passed: false, checks, error: error.message, errors, escaped }, null, 2)
  )
  throw error
} finally {
  for (const upload of uploads) upload.release(503)
  await browser.close()
}
