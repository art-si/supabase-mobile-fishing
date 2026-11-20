import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5179'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext()
await context.route('**/*', (route) =>
  new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort()
)
const page = await context.newPage()
let checks = []
try {
  await page.goto(base)
  checks = await page.evaluate(async () => {
    const { execute, rememberDemoPhoto } = await import('/src/demo/database.ts')
    const { freshDraft, freshSpot } = await import('/src/domain/rules.ts')
    const { editFields } = await import('/src/domain/content-edit.ts')
    const me = '11111111-1111-4111-8111-111111111111',
      friend = '22222222-2222-4222-8222-222222222222',
      stranger = '33333333-3333-4333-8333-333333333333'
    const checks = []
    const check = (condition, label) => {
      if (!condition) throw Error(label)
      checks.push(label)
    }
    const read = (action, input = {}, viewer = me) => execute('read', action, input, viewer)
    const write = (action, input, owner = me) => execute('write', action, input, owner)
    const old = {
        id: crypto.randomUUID(),
        path: 'demo/old',
        url: 'data:image/png;base64,b2xk',
        width: 20,
        height: 20
      },
      next = {
        ...old,
        id: crypto.randomUUID(),
        path: 'demo/new',
        url: 'data:image/png;base64,bmV3'
      }
    rememberDemoPhoto(me, old)
    rememberDemoPhoto(me, next)
    const draft = { ...freshDraft(), body: '当前版本', audience: 'public', media: [old] }
    const post = write('save_post', draft)
    const payload = {
      ...editFields('post', { ...draft, body: '修改稿', audience: 'friends', media: [next] }),
      type: 'post',
      revision: 1,
      request_id: crypto.randomUUID()
    }
    const saved = write('update_content', payload)
    check(saved.revision === 2, 'Demo revision advances once')
    check(write('update_content', payload).revision === 2, 'Demo retry reuses receipt')
    check(
      read('post', { id: post.id }).post.body === '当前版本',
      'Demo owner detail keeps current body'
    )
    const projection = read('post', { id: post.id }, friend).post
    check(
      projection.body === '当前版本' &&
        projection.media[0].id === old.id &&
        !projection.content_update,
      'Demo friend sees only current body/photo'
    )
    check(
      read('post', { id: post.id }).post.content_update.status === 'pending',
      'Demo owner sees pending revision metadata'
    )
    let denied = false
    try {
      read('post', { id: post.id }, stranger)
    } catch {
      denied = true
    }
    check(denied, 'Demo public-to-friends narrowing is immediate')
    const snapshot = read('edit_content', { type: 'post', id: post.id })
    check(
      snapshot.item.body === '修改稿' && snapshot.item.media[0].id === next.id,
      'Demo edit returns latest proposal and staged media'
    )
    check(
      snapshot.publication.audience === 'friends' && snapshot.publication.status === 'published',
      'Demo edit separately describes current publication'
    )
    check(
      read('feed', { query: '修改稿' }, friend).items.length === 0,
      'Demo search cannot discover unreviewed text'
    )
    denied = false
    try {
      read('edit_content', { type: 'post', id: post.id }, friend)
    } catch {
      denied = true
    }
    check(denied, 'Demo proposal edit is owner-only')
    const cancel = { type: 'post', id: post.id, revision: 2, request_id: crypto.randomUUID() }
    write('discard_content_update', cancel)
    check(
      write('discard_content_update', cancel).revision === 3,
      'Demo discard retry is idempotent'
    )
    const after = read('post', { id: post.id }).post
    check(
      after.body === '当前版本' &&
        after.media[0].id === old.id &&
        after.audience === 'friends' &&
        !after.content_update,
      'Demo discard preserves current content and narrowed audience'
    )
    denied = false
    try {
      write('update_content', { ...payload, request_id: crypto.randomUUID() })
    } catch (e) {
      denied = e.code === 'EDIT_CONFLICT'
    }
    check(denied, 'Demo stale update cannot replace a newer version')
    write('update_content', { ...payload, revision: 3, request_id: crypto.randomUUID() })
    write('withdraw_content', {
      type: 'post',
      id: post.id,
      revision: 4,
      request_id: crypto.randomUUID()
    })
    const withdrawn = read('post', { id: post.id }).post
    check(
      withdrawn.body === '修改稿' &&
        withdrawn.media[0].id === next.id &&
        withdrawn.audience === 'private' &&
        !withdrawn.content_update,
      'Demo withdraw installs latest proposal privately'
    )
    denied = false
    try {
      read('post', { id: post.id }, friend)
    } catch {
      denied = true
    }
    check(denied, 'Demo withdrawn content is inaccessible to friends')
    const spotDraft = {
      ...freshSpot(),
      name: '版本测试水域',
      city: '苏州',
      description: '当前水情',
      audience: 'friends',
      precision: 'exact',
      longitude: 120.52345,
      latitude: 31.26345,
      access_note: '私人入口'
    }
    const spot = write('save_spot', spotDraft)
    write('update_content', {
      ...editFields('spot', {
        ...spotDraft,
        description: '更新水情',
        precision: 'hidden',
        longitude: 121.123,
        latitude: 32.123
      }),
      type: 'spot',
      revision: 1,
      request_id: crypto.randomUUID()
    })
    const friendSpot = read('spot', { id: spot.id }, friend)
    check(
      friendSpot.description === '当前水情' &&
        friendSpot.longitude === null &&
        friendSpot.latitude === null &&
        !friendSpot.access_note &&
        !friendSpot.content_update,
      'Demo spot keeps old description and hides position immediately'
    )
    const spotEdit = read('edit_content', { type: 'spot', id: spot.id })
    check(
      spotEdit.item.description === '更新水情' &&
        spotEdit.item.longitude === 121.123 &&
        spotEdit.publication.precision === 'hidden',
      'Demo spot owner can edit private proposed coordinates'
    )
    write('discard_content_update', {
      type: 'spot',
      id: spot.id,
      revision: 2,
      request_id: crypto.randomUUID()
    })
    check(
      read('spot', { id: spot.id }, friend).longitude === null,
      'Demo discard never restores coordinate precision'
    )
    const privateDraft = { ...freshDraft(), body: '私人的原文', audience: 'private' }
    write('save_post', privateDraft)
    write('update_content', {
      ...editFields('post', { ...privateDraft, body: '私人的新文' }),
      type: 'post',
      revision: 1,
      request_id: crypto.randomUUID()
    })
    check(
      read('post', { id: privateDraft.id }).post.body === '私人的新文' &&
        !read('post', { id: privateDraft.id }).post.content_update,
      'Demo private edit remains immediate'
    )
    return checks
  })
  await mkdir('artifacts/content-updates/demo-repository', { recursive: true })
  await writeFile(
    'artifacts/content-updates/demo-repository/result.json',
    JSON.stringify(
      {
        evidence:
          'Browser-local demo repository unit checks via Vite source, no hosted writes or UI acceptance',
        checks
      },
      null,
      2
    )
  )
  console.log(`${checks.length} demo content-update repository checks passed`)
} finally {
  await browser.close()
}
