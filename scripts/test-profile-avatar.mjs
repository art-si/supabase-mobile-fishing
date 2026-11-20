// Isolated HTTP/auth fixtures, real image selection/cropping/decoding. No hosted write or SMS.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setH5TextScale } from './h5-text-scale.mjs'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname))
const out = resolve('artifacts/profile-avatar')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'zh-CN', reducedMotion: 'reduce' })
const owner = '11111111-1111-4111-8111-111111111111', avatarId = '66666666-4444-4444-8444-444444444444'
const image = await readFile(resolve('assets/brand/fish-symbol.png'))
const profile = { id: owner, nickname: '头像验收', city: '苏州', method: '台钓', bio: '', handle: 'DYTEST', avatar: null }
const avatar = { id: avatarId, path: `${owner}/${avatarId}.jpg`, width: 512, height: 512, kind: 'image', size: 1000 }
const checks = [], errors = [], escaped = [], updates = [], uploads = []
let failSave = true
const pass = (name) => { checks.push(name); console.log('PASS', name) }
await context.addInitScript(({ owner }) => {
  localStorage.setItem('dyj.auth.v1', JSON.stringify({ type: 'object', data: { access_token: 'avatar-isolated-fixture', refresh_token: 'fixture', expires_at: Date.now()/1000+3600, user: { id: owner } } }))
}, { owner })
await context.routeWebSocket(/supabase\.co/, socket => socket.close())
await context.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url())
  if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
  const reply = (json, status = 200) => route.fulfill({ status, json, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
  if (url.origin !== 'https://tlfmfokyhahlpzmpliad.supabase.co') { escaped.push(url.origin); return route.abort() }
  if (req.method() === 'OPTIONS') return reply({})
  if (url.pathname === '/auth/v1/user') return reply({ id: owner })
  if (url.pathname.endsWith('fishing_read')) {
    const { action } = req.postDataJSON()
    return reply(action === 'profile' ? { profile, posts: [], followers: 0, following: 0 } : { items: [], next: null, unread: 0 })
  }
  if (url.pathname.endsWith('fishing_moderation')) return reply({ allowed: false })
  if (url.pathname.endsWith('fishing_write')) {
    const { action, payload } = req.postDataJSON()
    if (action !== 'update_profile') { escaped.push(action); return route.abort() }
    updates.push(payload)
    if (failSave) { failSave = false; return reply({ code: 'SERVICE_UNAVAILABLE' }, 503) }
    Object.assign(profile, payload, { avatar: payload.avatar_id ? avatar : null })
    return reply(profile)
  }
  if (url.pathname === '/functions/v1/media-upload') {
    uploads.push(req.postDataBuffer())
    return reply(avatar)
  }
  if (url.pathname.startsWith('/storage/v1/object/sign/fishing-media/') && req.method() === 'POST') return reply({ signedURL: `/object/sign/fishing-media/${avatar.path}?token=isolated` })
  if (url.pathname.startsWith('/storage/v1/object/sign/fishing-media/') && req.method() === 'GET') return route.fulfill({ body: image, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } })
  if (url.pathname.startsWith('/rest/')) return reply([])
  escaped.push(url.pathname); return route.abort()
})
const page = await context.newPage()
page.setDefaultTimeout(20000)
page.on('pageerror', e => errors.push(e.message))
try {
  await page.goto(`${base}/#/pages/home/index?tab=mine`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByRole('button', { name: '编辑钓友资料' }).click()
  await page.getByRole('button', { name: '更换头像', exact: true }).waitFor()
  for (const [name, file] of [['WebP', 'small.webp'], ['GIF', 'animated.gif'], ['BMP', 'small.bmp'], ['AVIF', 'color.avif'], ['HEIC', '../fish-heic.heic']]) {
    const selecting = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '更换头像', exact: true }).click()
    await (await selecting).setFiles(resolve('tests/fixtures/image-formats', file))
    await page.getByRole('dialog', { name: '调整头像', exact: true }).waitFor()
    await page.getByRole('button', { name: '使用头像', exact: true }).click({ trial: true, timeout: 60000 })
    const stage = page.locator('.mobile-avatar-cropper__stage canvas')
    if (name === 'GIF') {
      await page.getByText('动图将按静态首帧保存', { exact: true }).waitFor()
      await page.waitForTimeout(150)
      const pixel = await stage.evaluate(node => [...node.getContext('2d').getImageData(384,384,1,1).data])
      assert.ok(pixel[0] > 190 && pixel[1] < 80 && pixel[2] < 80, 'avatar GIF must freeze its real first frame')
    }
    await page.screenshot({ path: resolve(out, `format-${name.toLowerCase()}.png`) })
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('dialog', { name: '调整头像', exact: true }).waitFor({ state: 'hidden' })
    assert.equal(uploads.length, 0)
  }
  pass('WebP/GIF/BMP/AVIF/HEIC 从真实头像选择入口进入裁剪，GIF 提示并固定首帧，取消不上传')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '更换头像', exact: true }).click()
  await (await chooser).setFiles(resolve('tests/fixtures/fish-heic.heic'))
  await page.getByRole('dialog', { name: '调整头像', exact: true }).waitFor()
  assert.ok(await page.getByRole('button', { name: '保存资料', exact: true }).isDisabled())
  const crop = page.locator('.mobile-avatar-cropper__stage canvas')
  await page.getByRole('button', { name: '放大照片', exact: true }).click()
  await page.getByRole('button', { name: '放大照片', exact: true }).click()
  const beforeDrag = await crop.evaluate(node => node.toDataURL())
  const box = await crop.boundingBox()
  await page.mouse.move(box.x + box.width/2, box.y + box.height/2)
  await page.mouse.down(); await page.mouse.move(box.x + box.width/2 + 30, box.y + box.height/2 + 18, { steps: 5 }); await page.mouse.up()
  assert.notEqual(await crop.evaluate(node => node.toDataURL()), beforeDrag)
  const beforeKey = await crop.evaluate(node => node.toDataURL())
  await crop.press('ArrowLeft')
  assert.notEqual(await crop.evaluate(node => node.toDataURL()), beforeKey)
  const beforeTouch = await crop.evaluate(node => node.toDataURL())
  const cdp = await context.newCDPSession(page)
  const touch = { x: box.x + box.width/2, y: box.y + box.height/2 }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touch.x + 14, y: touch.y + 12 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  assert.notEqual(await crop.evaluate(node => node.toDataURL()), beforeTouch)
  await cdp.detach()
  pass('H5鼠标、触摸拖动与键盘方向键真实改变裁剪像素')
  for (const [name, width, height] of [['320',320,720],['440',440,900],['landscape',812,375],['wide',1280,800]]) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(80)
    const bounds = await crop.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1)
    await page.screenshot({ path: resolve(out, `crop-${name}.png`) })
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await page.screenshot({ path: resolve(out, 'crop-375.png') })
  pass('头像选择进入适配窄屏/横屏/宽屏的真实裁剪界面，裁剪期间不能保存资料')
  await page.getByRole('button', { name: '旋转头像', exact: true }).click()
  await page.getByText('使用头像', { exact: true }).click()
  await page.getByRole('dialog', { name: '调整头像', exact: true }).waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.querySelector('.mobile-avatar-editor__row image, .mobile-avatar-editor__row uni-image img'))
  await page.getByRole('button', { name: '保存资料', exact: true }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => !document.querySelector('button.primary')?.disabled)
  assert.equal(uploads.length, 1)
  assert.equal(updates.length, 0)
  assert.ok(uploads[0].includes(Buffer.from([255, 216, 255])), 'the real crop/compression pipeline exports JPEG bytes')
  pass('HEIC 头像裁剪和旋转后真实上传 JPEG，候选头像不自动保存')
  for (const [name, width, height, dark, large] of [['320',320,720,false,false],['375',375,812,false,false],['440',440,900,false,false],['landscape',812,375,false,false],['wide',1280,800,false,false],['dark-large',320,740,true,true]]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
    await setH5TextScale(page, large ? 32 : 16)
    await page.screenshot({ path: resolve(out, `profile-${name}.png`), fullPage: true })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  }
  pass('320/375/440、横屏、宽屏及深色大字资料页面无横向溢出')
  await page.setViewportSize({ width: 375, height: 812 }); await setH5TextScale(page, 16)
  await page.getByRole('button', { name: '保存资料', exact: true }).click()
  await page.getByText('服务暂时不可用，请稍后重试', { exact: true }).waitFor()
  assert.equal(updates[0].avatar_id, avatarId)
  assert.ok(await page.getByRole('button', { name: '恢复默认头像', exact: true }).isVisible())
  await page.getByRole('button', { name: '保存资料', exact: true }).click()
  await page.waitForURL(/pages\/home\/index/)
  assert.equal(uploads.length, 1)
  assert.equal(updates[1].avatar_id, avatarId)
  pass('保存失败保留候选头像，重试复用已上传图片并与资料统一提交')
  await page.getByRole('button',{name:'编辑钓友资料',exact:true}).click()
  await page.getByRole('button',{name:'恢复默认头像',exact:true}).click()
  await page.getByRole('button',{name:'返回上一页',exact:true}).click()
  const discard=page.getByRole('alertdialog',{name:'放弃这次修改？',exact:true})
  await discard.waitFor()
  await discard.getByRole('button',{name:'继续编辑',exact:true}).click()
  assert.equal(updates.length,2)
  assert.equal(await page.getByRole('button',{name:'恢复默认头像',exact:true}).count(),0)
  const cancelChooser=page.waitForEvent('filechooser')
  await page.getByRole('button',{name:'更换头像',exact:true}).click()
  await(await cancelChooser).setFiles(resolve('assets/brand/fish-symbol.png'))
  await page.getByRole('dialog',{name:'调整头像',exact:true}).waitFor()
  await page.getByText('取消',{exact:true}).click()
  await page.getByRole('dialog',{name:'调整头像',exact:true}).waitFor({state:'hidden'})
  assert.equal(uploads.length,1)
  pass('恢复默认只修改草稿；返回可继续编辑，取消裁切不上传')
  const nickname=page.locator('input[aria-label="昵称"]')
  await nickname.fill('   ')
  await page.getByRole('button',{name:'保存资料',exact:true}).click()
  await page.getByText('请填写昵称',{exact:true}).waitFor()
  assert.equal(await nickname.evaluate(node=>document.activeElement===node),true)
  assert.equal(updates.length,2)
  pass('空白昵称在字段旁提示并聚焦，不向服务器提交')
  assert.deepEqual(escaped, []); assert.deepEqual(errors, [])
  await writeFile(resolve(out, 'result.json'), JSON.stringify({ evidence: 'isolated transport; real H5 cropping, no hosted write', checks }, null, 2))
} catch (error) { await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true }); throw error }
finally { await browser.close() }
