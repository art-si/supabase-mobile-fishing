// Isolated API contracts, real compiled H5 UI and local image preparation. No hosted writes or SMS.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5181'
const output = resolve('artifacts/chat-attachments', new Date().toISOString().replaceAll(':', '-'))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const checks = [],
  errors = [],
  escaped = [],
  calls = []
let activePage
let passed = false,
  failure = ''
const me = '11111111-1111-4111-8111-111111111111',
  peer = '22222222-2222-4222-8222-222222222222',
  chatId = 'c1111111-1111-4111-8111-111111111111',
  postId = 'a1111111-1111-4111-8111-111111111111',
  spotId = 'b1111111-1111-4111-8111-111111111111'
const person = {
  id: peer,
  nickname: '隔离测试钓友',
  handle: 'TEST',
  city: '苏州',
  bio: '',
  method: ''
}
const post = {
  id: postId,
  author: person,
  title: '浅滩鱼情（测试）',
  body: '仅用于界面验收，不是真实鱼情。',
  kind: 'catch',
  species: '鲫鱼',
  method: '台钓',
  bait: '',
  weight_kg: null,
  occurred_on: '2026-11-19',
  location_label: '',
  audience: 'public',
  status: 'published',
  created_at: new Date().toISOString(),
  like_count: 0,
  comment_count: 0,
  liked: false,
  saved: false,
  media: []
}
const spot = {
  id: spotId,
  author: person,
  name: '芦苇水域（测试）',
  city: '苏州',
  water_type: '自然水域',
  species: '鲫鱼',
  description: '仅用于界面验收',
  fee_note: '未核实',
  access_note: '',
  observed_on: '2026-11-19',
  audience: 'public',
  precision: 'area',
  latitude: 31.26,
  longitude: 120.52,
  saved: false,
  created_at: new Date().toISOString(),
  status: 'published'
}
const asset = { id: randomUUID(), path: `${me}/chat-fixture.jpg`, width: 400, height: 300 }
let fixtureImage
const pass = (name) => {
  checks.push(name)
  console.log(`PASS ${name}`)
}
const button = (p, name) => p.getByRole('button', { name, exact: true })
async function snapshot(p, name) {
  await p.waitForFunction(() => !document.querySelector('.mobile-action--pressed'))
  await p.evaluate(() => document.fonts.ready)
  await p.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name)
  await p.screenshot({ path: resolve(output, `${name}.png`), fullPage: true })
}
async function setup(signedIn = true) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    locale: 'zh-CN',
    reducedMotion: 'reduce'
  })
  if (signedIn)
    await context.addInitScript(
      (me) =>
        localStorage.setItem(
          'dyj.auth.v1',
          JSON.stringify({
            type: 'object',
            data: {
              access_token: 'isolated-chat-fixture',
              refresh_token: 'isolated-chat-refresh',
              expires_at: Date.now() / 1000 + 3600,
              user: { id: me }
            }
          })
        ),
      me
    )
  const state = {
    canSend: true,
    hidden: false,
    readFail: false,
    uploadFail: false,
    uploadUnsupported: false,
    uploadGate: null,
    sendFail: false,
    shareFail: false,
    uploadCount: 0
  }
  const message = (sequence, kind, extra = {}) => ({
    id: randomUUID(),
    conversation_id: chatId,
    sender_id: peer,
    client_id: randomUUID(),
    sequence,
    kind,
    body: kind === 'text' ? '周末一起去看看水情？（测试）' : kind === 'image' ? '[图片]' : '[分享]',
    created_at: new Date().toISOString(),
    ...extra
  })
  const records = [
    message(1, 'text'),
    message(2, 'image', { media: [asset] }),
    message(3, 'post', {
      card: { id: postId, type: 'post', title: post.title, detail: '鲫鱼 · 台钓' }
    }),
    message(4, 'spot', {
      card: { id: spotId, type: 'spot', title: spot.name, detail: '自然水域 · 大致水域' }
    })
  ]
  const projected = (m) =>
    state.hidden && ['post', 'spot'].includes(m.kind) ? { ...m, card: null } : m
  await context.routeWebSocket(/supabase\.co/, socket => socket.close())
  await context.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url())
    if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
    if (url.origin !== 'https://jupuypvmgjpnpntfetqv.supabase.co') {
      escaped.push(url.origin)
      return route.abort()
    }
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*'
    }
    const reply = (json, status = 200) => route.fulfill({ json, status, headers })
    if (req.method() === 'OPTIONS') return reply({})
    if (url.pathname.startsWith('/storage/v1/object/sign/')) {
      if (req.method() === 'POST')
        return reply({ signedURL: '/object/sign/fishing-media/fixture.jpg?test=1' })
      return route.fulfill({ status: 200, contentType: 'image/jpeg', body: fixtureImage, headers })
    }
    if (url.pathname.endsWith('/media-upload')) {
      state.uploadCount++
      if (state.uploadGate) await state.uploadGate
      if (state.uploadUnsupported) {
        state.uploadUnsupported = false
        return reply({ error: 'IMAGE_UNSUPPORTED' }, 415)
      }
      if (state.uploadFail) {
        state.uploadFail = false
        return reply({ error: 'temporarily_unavailable' }, 503)
      }
      return reply({ ...asset, id: 'd1111111-1111-4111-8111-111111111111' })
    }
    const body = req.postDataJSON()
    calls.push({ path: url.pathname, ...body })
    if (url.pathname.endsWith('/fishing_read')) {
      if (body.action === 'profile')
        return reply({ profile: { ...person, id: me }, posts: [], relationship: {} })
      if (body.action === 'post') return reply({ post, comments: [] })
      if (body.action === 'spot') return reply(spot)
      if (body.action === 'social')
        return reply({
          friends: [person],
          requests: [],
          conversations: [
            {
              id: chatId,
              peer: person,
              last_message: '[钓位]',
              last_at: new Date().toISOString(),
              unread: 0,
              can_send: state.canSend
            }
          ]
        })
      if (['messages', 'message_content'].includes(body.action)) {
        if (state.readFail) return reply({ message: 'temporary' }, 503)
        const { payload } = body
        return reply(
          records
            .filter((m) =>
              body.action === 'message_content'
                ? payload.ids.includes(m.id)
                : m.sequence > (payload.after || 0) && m.sequence < (payload.before || Infinity)
            )
            .map(projected)
        )
      }
      return reply({ items: [], next: null })
    }
    if (url.pathname.endsWith('/fishing_moderation')) return reply({ allowed: false })
    if (url.pathname.endsWith('/fishing_write')) {
      if (body.action === 'read_conversation') return reply(true)
      if (body.action === 'conversation') return reply(chatId)
      if (body.action === 'send_message') {
        const data = body.payload
        if (!state.canSend) return reply({ code: 'P0001', message: 'NOT_FRIENDS' }, 400)
        if (state.shareFail && ['post', 'spot'].includes(data.kind)) {
          state.shareFail = false
          return reply({ message: 'temporary' }, 503)
        }
        if (state.sendFail) {
          state.sendFail = false
          return reply({ message: 'temporary' }, 503)
        }
        const old = records.find((m) => m.client_id === data.client_id)
        if (old) return reply(projected(old))
        const saved = message(records.length + 1, data.kind || 'text', {
          ...data,
          sender_id: me,
          ...(data.kind === 'image' ? { media: [{ ...asset, id: data.media_id }] } : {}),
          ...(['post', 'spot'].includes(data.kind)
            ? {
                card: {
                  id: data.reference_id,
                  type: data.kind,
                  title: data.kind === 'post' ? post.title : spot.name,
                  detail: '测试分享'
                }
              }
            : {})
        })
        records.push(saved)
        return reply(saved)
      }
    }
    escaped.push(url.pathname)
    return route.abort()
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  activePage = page
  return {
    context,
    page,
    state,
    records,
    go: async (path) => {
      await page.goto(`${base}/#${path}`)
    }
  }
}
try {
  const canvasPage = await browser.newPage()
  fixtureImage = Buffer.from(
    await canvasPage.evaluate(() => {
      const c = document.createElement('canvas')
      c.width = 400
      c.height = 300
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#dce9e4'
      ctx.fillRect(0, 0, 400, 300)
      ctx.fillStyle = '#244c42'
      ctx.font = '24px sans-serif'
      ctx.fillText('UI TEST IMAGE', 80, 150)
      return c.toDataURL('image/jpeg').split(',')[1]
    }),
    'base64'
  )
  await canvasPage.close()
  const guest = await setup(false)
  await guest.go(`/pages/chat/index?id=${chatId}`)
  await button(guest.page, '登录后查看聊天').waitFor()
  assert.ok(await button(guest.page, '照片').isDisabled())
  await guest.context.close()
  pass('guest cannot send messages or open photo input')

  const app = await setup(),
    p = app.page
  await app.go(`/pages/chat/index?id=${chatId}`)
  await button(p, `查看钓位：${spot.name}`).waitFor()
  await p.getByRole('button', { name: '聊天照片，查看大图，第1张', exact: true }).waitFor()
  for (const width of [320, 375, 440, 844, 1280]) {
    await p.setViewportSize({ width, height: width === 844 ? 390 : 900 })
    await p.waitForFunction(() => {
      const rect = document.querySelector('.chat-composer').getBoundingClientRect()
      return Math.abs(rect.bottom - innerHeight) <= 3
    })
    await snapshot(p, `chat-${width}`)
    const rect = await p.locator('.chat-composer').boundingBox()
    assert.ok(
      rect && rect.y + rect.height <= (width === 844 ? 390 : 900) + 2,
      'composer inside viewport'
    )
    assert.ok(
      await p
        .locator('.chat-card .name')
        .evaluateAll((nodes) => nodes.every((n) => parseFloat(getComputedStyle(n).fontSize) >= 16))
    )
    assert.ok(
      await p
        .locator('.chat-card .caption')
        .evaluateAll((nodes) => nodes.every((n) => parseFloat(getComputedStyle(n).fontSize) >= 14))
    )
  }
  await p.setViewportSize({ width: 320, height: 812 })
  await p.emulateMedia({ colorScheme: 'dark' })
  const enlarged = await p.addStyleTag({ content: 'html { font-size: 24px !important; }' })
  await snapshot(p, 'chat-dark-large-320')
  const darkComposer = await p.locator('.chat-composer').boundingBox()
  assert.ok(
    Math.abs(darkComposer.y + darkComposer.height - 812) <= 3,
    'large text composer remains inside visible viewport'
  )
  await button(p, '照片').click()
  await snapshot(p, 'photo-sheet-dark-large-320')
  assert.ok(
    (
      await p
        .getByRole('dialog')
        .getByRole('button')
        .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height))
    ).every((n) => n >= 44)
  )
  await p.keyboard.press('Escape')
  await p.getByRole('dialog').waitFor({ state: 'hidden' })
  await enlarged.evaluate((n) => n.remove())
  await p.emulateMedia({ colorScheme: 'light' })
  await p.setViewportSize({ width: 375, height: 812 })
  pass(
    'text/image/cards fit small phones, landscape, wide, dark 150% text; photo sheet has 44px targets and Escape'
  )

  const input = p.locator('textarea[aria-label="发送给钓友的消息"]')
  await input.fill('保留未发送的文字草稿')
  await button(p, '照片').click()
  const picker = p.waitForEvent('filechooser')
  await button(p, '从相册选择').click()
  await (
    await picker
  ).setFiles({ name: 'chat-fixture.jpg', mimeType: 'image/jpeg', buffer: fixtureImage })
  await button(p, '发送这张照片').waitFor()
  assert.equal(app.state.uploadCount, 0)
  await snapshot(p, 'photo-confirm-375')
  await p.keyboard.press('Escape')
  await button(p, '照片').click()
  await button(p, '发送这张照片').waitFor()
  app.state.uploadFail = true
  await button(p, '发送这张照片').click()
  await button(p, '重试这条消息').waitFor()
  assert.equal(await input.inputValue(), '保留未发送的文字草稿')
  app.state.sendFail = true
  await button(p, '重试这条消息').click()
  await p.getByText('服务暂时不可用，请稍后重试', { exact: true }).waitFor()
  await snapshot(p, 'photo-send-failed-375')
  const uploadCount = app.state.uploadCount
  await button(p, '重试这条消息').click()
  await button(p, '重试这条消息').waitFor({ state: 'hidden' })
  assert.equal(app.state.uploadCount, uploadCount)
  const imageSends = calls.filter((c) => c.action === 'send_message' && c.payload.kind === 'image')
  assert.equal(imageSends.at(-1).payload.client_id, imageSends.at(-2).payload.client_id)
  assert.equal(app.records.filter((m) => m.kind === 'image' && m.sender_id === me).length, 1)
  await snapshot(p, 'photo-sent-375')
  pass(
    'photo selection is confirmed, canceled selection survives, upload/send failures retry same message without reuploading confirmed asset or losing text'
  )
  await button(p, '发送').click()
  await p.getByRole('log').getByText('保留未发送的文字草稿', { exact: true }).waitFor()
  await p.waitForFunction(
    () => document.querySelector('textarea[aria-label="发送给钓友的消息"]').value === ''
  )
  pass('text sending still works alongside image composer')

  app.state.hidden = true
  await button(p, `查看钓位：${spot.name}`).waitFor({ state: 'hidden', timeout: 15000 })
  await p.getByText('内容已不可用', { exact: true }).first().waitFor()
  await snapshot(p, 'references-revoked-375')
  app.state.hidden = false
  await button(p, `查看鱼情：${post.title}`).waitFor({ timeout: 15000 })
  app.state.readFail = true
  await p.getByText('服务暂时不可用，请稍后重试', { exact: true }).waitFor({ timeout: 15000 })
  assert.equal(await button(p, `查看鱼情：${post.title}`).count(), 0)
  app.state.readFail = false
  await button(p, `查看鱼情：${post.title}`).waitFor({ timeout: 15000 })
  pass(
    'existing cards reauthorize without new messages; refresh failure clears former previews and recovers'
  )

  for (const [type, id] of [
    ['post', postId],
    ['spot', spotId]
  ]) {
    await app.go(`/pages/${type}/detail?id=${id}`)
    await button(p, '发给钓友').click()
    await button(p, person.nickname).waitFor()
    assert.ok(await button(p, '确认发送').isDisabled())
    await button(p, person.nickname).click()
    if (type === 'spot') {
      await p.setViewportSize({ width: 320, height: 812 })
      await p.emulateMedia({ colorScheme: 'dark' })
      const large = await p.addStyleTag({ content: 'html { font-size: 24px !important; }' })
      await snapshot(p, 'share-selected-dark-large-320')
      await large.evaluate((node) => node.remove())
      await p.emulateMedia({ colorScheme: 'light' })
      await p.setViewportSize({ width: 375, height: 812 })
    }
    await p.keyboard.press('Escape')
    await button(p, '发给钓友').click()
    await p.getByText('已选择', { exact: true }).waitFor()
    app.state.shareFail = true
    await button(p, '确认发送').click()
    await p.getByText('服务暂时不可用，请稍后重试', { exact: true }).waitFor()
    await snapshot(p, `${type}-share-error-375`)
    await button(p, '确认发送').click()
    await button(p, '已发送 · 查看聊天').waitFor()
    const sent = calls.filter((c) => c.action === 'send_message' && c.payload.kind === type)
    assert.equal(sent.at(-1).payload.client_id, sent.at(-2).payload.client_id)
    assert.deepEqual(Object.keys(sent.at(-1).payload).sort(), [
      'client_id',
      'conversation_id',
      'kind',
      'reference_id'
    ])
    await button(p, '已发送 · 查看聊天').click()
    await p.locator('.chat-composer').waitFor()
  }
  pass(
    'post and spot share select friend, confirm, retain failed idempotency, send references only and open chat'
  )
  app.state.canSend = false
  await p
    .getByText('当前不能发送新消息，重新成为好友后可继续。', { exact: true })
    .waitFor({ timeout: 15000 })
  assert.ok(await button(p, '照片').isDisabled())
  await p.evaluate(() => {
    localStorage.removeItem('dyj.auth.v1')
    window.dispatchEvent(new StorageEvent('storage', { key: 'dyj.auth.v1', newValue: null }))
  })
  await button(p, '登录后查看聊天').waitFor()
  assert.equal(await p.locator('.chat-turn').count(), 0)
  pass('friendship changes disable sends; account removal clears private text, media and cards')
  await app.context.close()
  const boundary = await setup(),
    b = boundary.page
  await boundary.go(`/pages/chat/index?id=${chatId}`)
  await button(b, '照片').waitFor()
  async function pickBoundaryPhoto() {
    await button(b, '照片').click()
    const chooser = b.waitForEvent('filechooser')
    await button(b, '从相册选择').click()
    await (
      await chooser
    ).setFiles({ name: 'boundary-fixture.jpg', mimeType: 'image/jpeg', buffer: fixtureImage })
    await button(b, '发送这张照片').waitFor()
  }
  await pickBoundaryPhoto()
  boundary.state.uploadUnsupported = true
  await button(b, '发送这张照片').click()
  await button(b, '重新选择可发送的照片').waitFor()
  assert.equal(await button(b, '重试这条消息').count(), 0)
  await snapshot(b, 'unsupported-photo-375')
  await button(b, '重新选择可发送的照片').click()
  assert.equal(await button(b, '发送这张照片').count(), 0)
  await b.keyboard.press('Escape')
  pass('unsupported image offers replacement instead of a futile retry')
  await pickBoundaryPhoto()
  let releaseUpload
  boundary.state.uploadGate = new Promise((resolve) => {
    releaseUpload = resolve
  })
  const imageWrites = () =>
    calls.filter((c) => c.action === 'send_message' && c.payload.kind === 'image').length
  const beforeLateUpload = imageWrites()
  const started = b.waitForRequest('**/media-upload')
  await button(b, '发送这张照片').click()
  await started
  await b.evaluate(() => {
    localStorage.removeItem('dyj.auth.v1')
    window.dispatchEvent(new StorageEvent('storage', { key: 'dyj.auth.v1', newValue: null }))
  })
  const finished = b.waitForResponse('**/media-upload')
  releaseUpload()
  await finished
  await button(b, '登录后查看聊天').waitFor()
  await b.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
  assert.equal(await b.locator('.chat-turn').count(), 0)
  assert.equal(imageWrites(), beforeLateUpload)
  await boundary.context.close()
  pass('logout during image upload discards its late result and never sends with a new session')
  assert.deepEqual(errors, [])
  assert.deepEqual(escaped, [])
  pass('no browser exceptions and no unhandled external requests')
  passed = true
} catch (error) {
  failure = String(error.message || error)
  await activePage
    ?.screenshot({ path: resolve(output, 'failure.png'), fullPage: true })
    .catch(() => {})
  throw error
} finally {
  await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(
      {
        fixtureOnly: true,
        passed,
        failure,
        checks,
        errors,
        escaped,
        calls: calls.map((c) => ({ action: c.action, kind: c.payload?.kind }))
      },
      null,
      2
    )
  )
  await browser.close()
  console.log(`Evidence: ${output}`)
}
