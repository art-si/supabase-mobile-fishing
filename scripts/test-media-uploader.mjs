// Local transport/session fixtures; real local image/video decoding. No hosted write or SMS.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setH5TextScale } from './h5-text-scale.mjs'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
const output = resolve('artifacts/media-uploader')
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width: 375, height: 812 },
  locale: 'zh-CN',
  reducedMotion: 'reduce'
})
const owner = '11111111-1111-4111-8111-111111111111'
const checks = [],
  errors = [],
  escaped = [],
  requests = []
const pass = (name) => {
  checks.push(name)
  console.log('PASS', name)
}
await context.addInitScript(
  ({ owner }) => {
    localStorage.setItem(
      'dyj.auth.v1',
      JSON.stringify({
        type: 'object',
        data: {
          access_token: 'upload-acceptance-fixture',
          refresh_token: 'fixture',
          expires_at: Date.now() / 1000 + 3600,
          user: { id: owner }
        }
      })
    )
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: async () => ({ state: 'denied' }) }
    })
  },
  { owner }
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
    const index = requests.length + 1
    const video = request.postDataBuffer().includes(Buffer.from('name="kind"\r\n\r\nvideo'))
    let release
    const wait = new Promise((resolve) => {
      release = resolve
    })
    const item = { index, video, release, replied: false }
    requests.push(item)
    const status = await wait
    item.replied = true
    const id = String(index).padStart(8, '0') + '-4444-4444-8444-444444444444'
    try {
      return status === 503
        ? await reply({ error: 'STORAGE_UNAVAILABLE' }, 503)
        : await reply({
            id,
            path: `${owner}/${id}.${video ? 'mp4' : 'jpg'}`,
            kind: video ? 'video' : 'image',
            width: video ? 960 : 64,
            height: video ? 540 : 64,
            duration: video ? 5.005 : undefined,
            size: 1000
          })
    } catch {
      /* The component can abort a request while it is held by this fixture. */
    }
    return
  }
  if (url.pathname.endsWith('fishing_moderation')) return reply({ allowed: false })
  if (url.pathname.endsWith('fishing_read')) return reply({ items: [], next: null })
  if (url.pathname.startsWith('/rest/')) return reply([])
  escaped.push(url.pathname)
  return route.abort()
})
const page = await context.newPage()
page.setDefaultTimeout(15000)
page.on('pageerror', (error) => errors.push(error.message))
const choose = async (files) => {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '添加图片 / 视频', exact: true }).click()
  await (await chooser).setFiles(files)
}
async function waitRequests(count) {
  const deadline = Date.now() + 15000
  while (requests.length < count && Date.now() < deadline) await page.waitForTimeout(80)
  assert.equal(requests.length, count)
}
async function checkGeometry(name) {
  const boxes = await page.locator('.mobile-evidence__item').evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect(),
        remove = node.querySelector('.mobile-evidence__remove').getBoundingClientRect()
      return {
        w: box.width,
        h: box.height,
        x: box.x,
        y: box.y,
        remove: { w: remove.width, h: remove.height, right: remove.right, top: remove.top },
        right: box.right
      }
    })
  )
  assert.ok(boxes.length > 1)
  assert.ok(
    Math.max(...boxes.map((b) => b.h)) - Math.min(...boxes.map((b) => b.h)) < 2,
    `${name}: equal attachment heights`
  )
  for (const box of boxes) {
    assert.ok(box.remove.w >= 44 && box.remove.h >= 44, `${name}: removal touch size`)
    assert.ok(
      Math.abs(box.remove.right - box.right) < 3 && Math.abs(box.remove.top - box.y) < 3,
      `${name}: top-right removal`
    )
  }
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `${name}: page width`
  )
}
try {
  await page.goto(`${base}/#/pages/post/compose`, { waitUntil: 'domcontentloaded' })
  const image = await readFile(resolve('assets/brand/fish-symbol.png'))
  const files = ['one', 'two', 'three'].map((name) => ({
    name: `${name}.png`,
    mimeType: 'image/png',
    buffer: image
  }))
  files.splice(1, 0, {
    name: 'real-video.mp4',
    mimeType: 'video/mp4',
    buffer: await readFile(resolve('tests/fixtures/flower-cc0.mp4'))
  })
  await choose(files)
  await waitRequests(3)
  await page.waitForTimeout(300)
  assert.equal(requests.length, 3)
  assert.equal(await page.locator('.mobile-evidence__item').count(), 4)
  assert.equal(await page.getByRole('dialog', { name: '添加图片 / 视频' }).count(), 0)
  await page.locator('.mobile-evidence__grid').scrollIntoViewIfNeeded()
  await checkGeometry('uploading')
  await page.screenshot({ path: resolve(output, 'parallel-upload-375.png') })
  await page.setViewportSize({ width: 320, height: 740 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await setH5TextScale(page, 32)
  await page.locator('.mobile-evidence__grid').scrollIntoViewIfNeeded()
  await checkGeometry('uploading-large-dark')
  const progressLines = await page.locator('.mobile-media-uploader__progress').evaluateAll(nodes => nodes.map(node => ({ line: parseFloat(getComputedStyle(node).lineHeight), font: parseFloat(getComputedStyle(node).fontSize) })))
  assert.ok(progressLines.every(value => value.line >= value.font * 1.2), 'progress text must not inherit the image button zero line-height')
  await page.screenshot({ path: resolve(output, 'parallel-upload-320-large-dark.png') })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'light' })
  await setH5TextScale(page, 16)
  pass('四项混选直接进入公共队列，三个请求同时在途、第四项等候；删除按钮在右上且格子等高')

  await page.waitForFunction(() => {
    const video = [...document.querySelectorAll('.mobile-evidence__preview')].find((node) =>
      node.getAttribute('aria-label')?.includes('视频')
    )
    const poster = video?.querySelector('img')
    return poster?.src.startsWith('data:image/') && poster.naturalWidth > 0
  })
  await page.getByRole('button', { name: '预览视频 2', exact: true }).click()
  const player = page.locator('video').filter({ visible: true })
  await player.waitFor()
  const playback = await player.evaluate(async (video) => {
    video.muted = true
    await video.play()
    await new Promise((resolve) => setTimeout(resolve, 300))
    const result = { width: video.videoWidth, height: video.videoHeight, time: video.currentTime }
    video.pause()
    return result
  })
  assert.ok(playback.width > 0 && playback.time > 0)
  const viewer = await page.getByRole('dialog',{name:'视频预览',exact:true}).boundingBox()
  assert.ok(viewer.height>=800 && viewer.y<=1)
  const close = await page.getByRole('button',{name:'关闭视频预览',exact:true}).boundingBox()
  assert.ok(close.x>300 && close.y<20 && close.width>=44 && close.height>=44)
  await page.screenshot({ path: resolve(output, 'video-playback-375.png') })
  await page.getByRole('button', { name: '关闭视频预览', exact: true }).click()
  pass('真实MP4帧生成封面，上传完成前即可解码播放')

  const interrupted = requests[0]
  await page.getByRole('button', { name: '移除第 1 张图片', exact: true }).click()
  await waitRequests(4)
  interrupted.release(200)
  await page.waitForTimeout(100)
  assert.equal(await page.locator('.mobile-evidence__item').count(), 3)
  assert.equal(await page.getByRole('dialog', { name: '视频预览' }).count(), 0)
  pass('移除上传中附件会释放队列槽位，迟到响应不能把附件加回，移除不触发预览')

  const failed = requests.find((item) => item !== interrupted && !item.video)
  failed.release(503)
  for (const item of requests) if (item !== failed && item !== interrupted) item.release(200)
  await page.getByRole('button', { name: '重试上传', exact: true }).waitFor()
  await checkGeometry('failed-and-completed')
  await page.screenshot({ path: resolve(output, 'failed-and-completed-375.png') })
  await page.getByRole('button', { name: '重试上传', exact: true }).click()
  await waitRequests(5)
  requests[4].release(200)
  await page.locator('.mobile-media-uploader__progress').waitFor({ state: 'hidden' })
  await checkGeometry('complete')
  pass('失败和完成状态仍等高，重试只发一项')
  assert.equal(await page.getByRole('button',{name:'调整附件顺序',exact:true}).count(),0)
  const kinds = () => page.locator('.mobile-evidence__preview').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label').includes('视频')?'video':'image'))
  const before = await kinds()
  const centers = () => page.locator('.mobile-evidence__preview').evaluateAll(nodes=>nodes.slice(0,2).map(node=>{const r=node.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}}))
  let boxes = await centers()
  await page.mouse.move(boxes[0].x,boxes[0].y)
  await page.mouse.down()
  await page.mouse.move(boxes[1].x,boxes[1].y,{steps:10})
  await page.locator('.mobile-evidence__item--target').waitFor()
  await page.screenshot({path:resolve(output,'drag-mouse-375.png')})
  await page.mouse.up()
  await page.waitForFunction(()=>document.querySelector('[role="status"].mobile-evidence__announcement')?.textContent.includes('已交换'))
  assert.deepEqual(await kinds(),[before[1],before[0],...before.slice(2)])
  await page.locator('.mobile-evidence__preview').nth(1).focus();await page.keyboard.press('Alt+ArrowLeft')
  await page.waitForTimeout(100)
  assert.deepEqual(await kinds(),before)
  assert.equal(requests.length,5)
  pass('图片和视频可在网格中直接拖拽交换；键盘替代操作可交换回来，上传不重启')
  const session = await context.newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled',{enabled:true})
  boxes = await centers()
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:boxes[0].x,y:boxes[0].y,id:1}]})
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:boxes[0].x,y:boxes[0].y-45,id:1}]})
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  assert.deepEqual(await kinds(),before)
  assert.equal(await page.locator('.mobile-evidence__item--dragging').count(),0)
  await page.locator('.mobile-evidence__grid').scrollIntoViewIfNeeded()
  boxes = await centers()
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:boxes[0].x,y:boxes[0].y,id:1}]})
  await page.locator('.mobile-evidence__item--dragging').waitFor()
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:boxes[1].x,y:boxes[1].y,id:1}]})
  await page.locator('.mobile-evidence__item--target').waitFor()
  const during = await centers()
  assert.ok(Math.abs(during[0].y-boxes[0].y)<2,'long-press horizontal drag must not scroll the page')
  await page.screenshot({path:resolve(output,'drag-touch-375.png')})
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  await page.waitForTimeout(100)
  assert.deepEqual(await kinds(),[before[1],before[0],...before.slice(2)])
  await session.detach()
  assert.equal(await page.getByRole('dialog',{name:'视频预览',exact:true}).count(),0)
  pass('H5触屏短滑保留滚动，长按拖动交换图片与视频且不滚页，松手不会误开预览')
  for (const [width, height, scale, color] of [
    [320, 740, 16, 'light'],
    [440, 956, 16, 'light'],
    [812, 375, 16, 'light'],
    [1280, 800, 16, 'dark'],
    [320, 740, 24, 'dark'],
    [375, 812, 32, 'dark']
  ]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: color })
    await setH5TextScale(page, scale)
    await page.locator('.mobile-evidence__grid').scrollIntoViewIfNeeded()
    await checkGeometry(`${width}-${scale}`)
    await page.screenshot({
      path: resolve(output, `complete-${width}-${height}-${scale}-${color}.png`)
    })
  }
  pass('窄屏、横屏、宽屏、深色与大字布局通过')
  assert.deepEqual(escaped, [])
  assert.deepEqual(errors, [])
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        checks,
        errors,
        escaped,
        requests: requests.length,
        boundary:
          'Real local video/photo decoding with isolated transport/session fixtures. Network progress events and native file selection require separate verification.'
      },
      null,
      2
    )
  )
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  for (const request of requests) request.release(200)
  await context.close()
  await browser.close()
}
