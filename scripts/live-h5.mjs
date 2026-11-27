import assert from 'node:assert/strict'
import { setH5TextScale } from './h5-text-scale.mjs'

const project = 'https://jupuypvmgjpnpntfetqv.supabase.co'
const readPath = '/rest/v1/rpc/fishing_read'

export async function allowPublicReads(context, base) {
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === base || !['https:', 'http:'].includes(url.protocol)) return route.continue()
    if (url.origin !== project) return route.abort()
    const method = request.method()
    if (url.pathname.startsWith('/storage/v1/object/sign/fishing-media/') &&
      ['GET', 'HEAD', 'POST', 'OPTIONS'].includes(method)) return route.continue()
    if (url.pathname === readPath && (method === 'OPTIONS' || (method === 'POST' &&
      ['feed', 'spots', 'post', 'comments', 'person'].includes(request.postDataJSON()?.action)))) return route.continue()
    if (url.pathname === '/functions/v1/amap' && (method === 'OPTIONS' ||
      (method === 'POST' && request.postDataJSON()?.action === 'region'))) return route.continue()
    return route.abort()
  })
}

export async function liveH5Smoke({ page, go, overflow, screenshot, pass, visual }) {
  const isPhoto = response => response.request().resourceType() === 'image' &&
    response.url().startsWith(project + '/storage/v1/object/sign/fishing-media/')
  const photos = new Map()
  page.on('response', response => { if (isPhoto(response)) photos.set(new URL(response.url()).pathname, response) })
  const [response] = await Promise.all([
    page.waitForResponse(response => response.url() === project + readPath &&
      response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'feed', { timeout: 45_000 }),
    go('/pages/home/index')
  ])
  assert.equal(response.status(), 200, 'Public feed must come from the configured production project')
  const { items } = await response.json()
  assert.ok(Array.isArray(items))
  if (items.length) {
    await page.locator('.post-card').first().waitFor({ timeout: 45_000 })
    assert.equal(await page.locator('.post-card').first().locator('.name').innerText(), items[0].author.nickname)
    if (items[0].title) assert.equal(await page.locator('.post-card .heading').first().innerText(), items[0].title)
    const attachment = items[0].media?.find(asset => asset.kind !== 'video')
    if (attachment) {
      const path = '/storage/v1/object/sign/fishing-media/' + attachment.path.split('/').map(encodeURIComponent).join('/')
      const target = page.locator('.post-card').first().getByRole('button', { name: /查看大图/ }).first()
      await target.scrollIntoViewIfNeeded()
      const image = photos.get(path) || await page.waitForResponse(response =>
        isPhoto(response) && new URL(response.url()).pathname === path, { timeout: 45_000 })
      assert.ok(image.ok(), `Public attachment returned HTTP ${image.status()}`)
      assert.equal(await image.finished(), null)
      await page.evaluate(() => window.scrollTo(0, 0))
      pass('public attachment downloads from signed Storage URL')
    }
  } else await page.getByText('还没有这片水域的故事', { exact: true }).waitFor()
  pass(`live feed matches the public API (${items.length} records)`)
  const sizes = visual ? [
    ['320', 320, 740], ['375', 375, 812], ['440', 440, 956],
    ['landscape', 844, 390], ['wide', 1280, 900], ['dark-large', 320, 740]
  ] : [['375', 375, 812]]
  for (const [name, width, height] of sizes) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: name === 'dark-large' ? 'dark' : 'light' })
    await setH5TextScale(page, name === 'dark-large' ? 24 : 16)
    await overflow(`public feed ${name}`)
    await screenshot(`live-feed-${name}.png`, false)
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'light' })
  await setH5TextScale(page, 16)
  await page.getByRole('button', { name: '同城', exact: true }).click()
  await page.getByRole('button', { name: '切换同城城市', exact: true }).click()
  await page.getByRole('dialog').last().waitFor()
  await screenshot('live-city-dialog.png', false)
  await page.keyboard.press('Escape')
  await go('/pages/mine/library?type=saved')
  await page.getByText('登录后查看个人记录', { exact: true }).waitFor()
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByRole('heading', { name: /^(手机号登录|密码登录|使用本机号码登录)$/ }).waitFor()
  assert.equal(await page.getByRole('button', { name: '进入本机体验' }).count(), 0)
  const input = page.locator('input:visible').first()
  await input.focus()
  assert.ok(await input.evaluate(node => node === document.activeElement))
  await screenshot('live-login-focus.png', false)
  pass('private records require a real login; guest city dialog and keyboard focus work')
}
