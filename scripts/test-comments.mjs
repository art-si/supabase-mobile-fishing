// Isolated HTTP contract backed by real local PostgreSQL migrations; no hosted/SMS writes.
import { PGlite } from '@electric-sql/pglite'
import { chromium } from 'playwright'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { commentsFlow } from './comments-flow.mjs'
import { commentModerationFlow } from './comment-moderation-flow.mjs'
import { notificationsFlow } from './notifications-flow.mjs'
import { compositionFlow } from './composition-flow.mjs'
import { contentUpdatesFlow } from './content-updates-flow.mjs'
import { randomUUID } from 'node:crypto'
const moderationSuite = process.argv.includes('--moderation')
const notificationSuite = process.argv.includes('--notifications')
const compositionSuite = process.argv.includes('--composition')
const updatesSuite = process.argv.includes('--content-updates')
const photoSuite = compositionSuite || updatesSuite
const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5179',
  project = 'https://jupuypvmgjpnpntfetqv.supabase.co'
const out = resolve(
  updatesSuite
    ? 'artifacts/content-updates'
    : compositionSuite
      ? 'artifacts/composition'
      : notificationSuite
        ? 'artifacts/notifications'
        : moderationSuite
          ? 'artifacts/comment-moderation'
          : 'artifacts/comments',
  new URL(base).port === '5181' ? 'production-contract' : 'contract'
)
await mkdir(out, { recursive: true })
const db = new PGlite()
// The same minimal managed-service stand-ins used by tests/database.mjs; NOT a Realtime test.
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;
create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated,service_role; grant select on storage.objects to anon,authenticated;
create schema realtime; create table realtime.messages(id uuid primary key default gen_random_uuid(),payload jsonb,event text,topic text,private boolean default false,extension text);
alter table realtime.messages enable row level security; grant usage on schema realtime to anon,authenticated,service_role;
grant select,insert,update on realtime.messages to anon,authenticated,service_role;
create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
create function realtime.send(payload jsonb,event text,topic text,private boolean default true) returns void language sql as $$insert into realtime.messages(payload,event,topic,private,extension) values(payload,event,topic,private,'broadcast');$$;`)
for (const file of (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort())
  await db.exec((await readFile(`supabase/migrations/${file}`, 'utf8')).replace(/\r\n/g, '\n'))
const data = {
  accounts: ['a', 'b', 'outsider'].map((label, i) => ({
    label,
    session: {
      access_token: `isolated-comment-${label}`,
      refresh_token: `isolated-refresh-${label}`,
      expires_at: Date.now() / 1000 + 3600,
      user: { id: `${i + 1}1111111-1111-4111-8111-111111111111` }
    }
  }))
}
if (photoSuite)
  data.photo = (await readFile('src/static/web/brand/logo-horizontal.png')).toString('base64')
for (const actor of data.accounts)
  await db.query('insert into auth.users(id) values($1)', [actor.session.user.id])
if (moderationSuite || notificationSuite || updatesSuite) {
  const [a, b, moderator] = data.accounts.map((x) => x.session.user.id)
  const call = async (user, action, payload) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user])
    return (
      await db.query('select public.fishing_write($1,$2::jsonb) result', [
        action,
        JSON.stringify(payload)
      ])
    ).rows[0].result
  }
  await db.query('insert into fishing_private.moderators(user_id) values($1)', [moderator])
  await call(a, 'friend_request', { id: b, note: '隔离测试' })
  const request = (await db.query('select id from public.friend_requests where sender_id=$1', [a]))
    .rows[0]
  await call(b, 'friend_respond', { id: request.id, accept: true })
  const post = randomUUID(),
    root = randomUUID(),
    reply = randomUUID()
  await call(a, 'save_post', {
    id: post,
    title: '评论举报隔离验收',
    body: '仅测试好友可见，不是真实鱼情。',
    kind: 'catch',
    species: '',
    method: '',
    bait: '',
    count: '0',
    weight: '',
    occurred_on: '2026-11-19',
    audience: 'friends',
    media: []
  })
  await db.query("update public.posts set status='published' where id=$1", [post])
  const body = '隔离验收：需要核实的评论内容。',
    replyBody = '隔离验收：保留的正常回复。'
  await call(a, 'comment', { id: root, post_id: post, body })
  await call(b, 'comment', { id: reply, post_id: post, body: replyBody, reply_to_id: root })
  data.commentFixture = { post, root, reply, body, replyBody }
}
let queue = Promise.resolve(),
  fixtureOffline = false,
  phase = 'start',
  passed = false
let pausePost = false,
  unblockPost,
  reachedPost
const pausedPost = new Promise((resolve) => {
  reachedPost = resolve
})
const checks = [],
  unexpected = [],
  errors = []
const browser = await chromium.launch({ channel: 'chrome', headless: true })
async function fixtureContext() {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    geolocation: { longitude: 114.18, latitude: 30.51, accuracy: 20 }
  })
  await context.grantPermissions(['geolocation'], { origin: new URL(base).origin })
  await context.addInitScript(() => {
    window.AMap = {
      Geolocation: class {
        getCurrentPosition(callback) {
          callback('complete', { position: { getLng: () => 114.18, getLat: () => 30.51 }, accuracy: 20 })
        }
      },
      Geocoder: class {
        getAddress(_point, callback) {
          callback('complete', { regeocode: {
            addressComponent: { city: '武汉市', district: '汉阳区' }
          } })
        }
      }
    }
  })
  return context
}
const context = await fixtureContext()
await context.addInitScript((session) => {
  if (!localStorage.getItem('dyj.auth.v1'))
    localStorage.setItem('dyj.auth.v1', JSON.stringify({ type: 'object', data: session }))
}, data.accounts[0].session)
await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
const routeRequest = async (route) => {
  const request = route.request(),
    url = new URL(request.url())
  if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
  if (url.origin !== project) {
    unexpected.push(url.origin)
    return route.abort()
  }
  if (fixtureOffline) return route.abort('internetdisconnected')
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*'
  }
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  const reply = (json, status = 200) => route.fulfill({ json, status, headers })
  if (
    !moderationSuite &&
    !notificationSuite &&
    !updatesSuite &&
    url.pathname.endsWith('/fishing_moderation')
  )
    return reply({ allowed: false })
  if (
    pausePost &&
    url.pathname.endsWith('/fishing_read') &&
    request.postDataJSON()?.action === 'post'
  ) {
    await new Promise((resolve) => {
      unblockPost = resolve
      reachedPost()
    })
  }
  const actor = data.accounts.find(
    (a) => request.headers().authorization === `Bearer ${a.session.access_token}`
  )
  const run = async () => {
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        actor?.session.user.id || ''
      ])
      if (photoSuite && url.pathname === '/functions/v1/media-upload') {
        if (!actor) return await reply({ error: 'AUTH_REQUIRED' }, 401)
        // Isolated metadata/upload stand-in, never a claim of image processing or hosted storage.
        const id = randomUUID(),
          asset = { id, path: `${actor.session.user.id}/${id}.jpg`, width: 96, height: 64 }
        await db.query(
          'insert into public.media_assets(id,owner_id,path,width,height) values($1,$2,$3,96,64)',
          [id, actor.session.user.id, asset.path]
        )
        return await reply(asset)
      }
      await db.exec(`set role ${actor ? 'authenticated' : 'anon'}`)
      if (photoSuite && url.pathname.startsWith('/storage/v1/object/sign/fishing-media/')) {
        const path = decodeURIComponent(url.pathname.split('/fishing-media/')[1])
        if (request.method() === 'POST') {
          const found = await db.query('select id from public.media_assets where path=$1', [path])
          return found.rows.length
            ? await reply({ signedURL: `/object/sign/fishing-media/${path}?fixture=1` })
            : await reply({ message: 'NOT_FOUND' }, 404)
        }
        // Synthetic signed-URL stand-in scoped to local test data; not an expiry test.
        await db.exec('reset role')
        const found = await db.query('select id from public.media_assets where path=$1', [path])
        return found.rows.length
          ? await route.fulfill({
              body: Buffer.from(data.photo, 'base64'),
              contentType: 'image/png',
              headers
            })
          : await reply({}, 404)
      }
      if (url.pathname === '/rest/v1/comments')
        return await reply(
          (
            await db.query(
              'select id,body from public.comments where ($1::uuid is not null and post_id=$1) or ($2::uuid is not null and id=$2)',
              [
                url.searchParams.get('post_id')?.replace('eq.', '') || null,
                url.searchParams.get('id')?.replace('eq.', '') || null
              ]
            )
          ).rows
        )
      const kind = ['write', 'read', 'reports', 'moderation', 'notifications'].find((kind) =>
        url.pathname.endsWith(`/fishing_${kind}`)
      )
      if (!kind) {
        unexpected.push(url.pathname)
        return await reply({ message: 'UNEXPECTED' }, 500)
      }
      const { action, payload } = request.postDataJSON()
      const result = await db.query(`select public.fishing_${kind}($1,$2::jsonb) result`, [
        action,
        JSON.stringify(payload)
      ])
      await reply(result.rows[0].result)
    } catch (e) {
      await reply({ code: 'P0001', message: e.message }, 400)
    } finally {
      await db.exec('reset role')
    }
  }
  queue = queue.then(run, run)
  await queue
}
await context.route('**/*', routeRequest)
async function accountPage(label) {
  const child = await fixtureContext()
  await child.addInitScript(
    (session) => {
      if (!localStorage.getItem('dyj.auth.v1'))
        localStorage.setItem('dyj.auth.v1', JSON.stringify({ type: 'object', data: session }))
    },
    data.accounts.find((x) => x.label === label).session
  )
  await child.routeWebSocket(/supabase\.co/, (socket) => socket.close())
  await child.route('**/*', routeRequest)
  const tab = await child.newPage()
  tab.setDefaultTimeout(20000)
  tab.on('pageerror', (e) => errors.push({ phase, message: e.message, stack: e.stack }))
  return tab
}
const page = await context.newPage()
page.setDefaultTimeout(20000)
page.on('pageerror', (e) => errors.push({ phase, message: e.message, stack: e.stack }))
const check = (value, label) => {
  assert.ok(value, label)
  checks.push(label)
}
const button = (p, name) => p.getByRole('button', { name, exact: true }),
  field = (p, label) => p.locator(`input[aria-label="${label}"],textarea[aria-label="${label}"]`)
const go = (p, path) => p.goto(`${base}/#${path}`)
const replyFor = (p, action) =>
  p.waitForResponse(
    (r) =>
      r.url().includes('/rest/v1/rpc/fishing_') && r.request().postDataJSON()?.action === action
  )
const shot = async (name, tab = page, fullPage = true) => {
  await tab.screenshot({ path: resolve(out, `${name}.png`), fullPage })
}
const fits = async (label) =>
  check(
    await page.evaluate(
      () =>
        Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) <= innerWidth + 1
    ),
    label
  )
try {
  if (updatesSuite) {
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
      setPhase: (v) => (phase = v),
      offline: async (v) => (fixtureOffline = v)
    })
  } else if (compositionSuite) {
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
      setPhase: (v) => (phase = v)
    })
  } else if (notificationSuite) {
    const guestContext = await fixtureContext()
    await guestContext.route('**/*', routeRequest)
    const guest = await guestContext.newPage()
    await go(guest, '/pages/notifications/index?settings=1')
    await guest.getByText('登录后查看通知', { exact: true }).waitFor()
    check(
      (await guest.getByRole('dialog').count()) === 0,
      'Guest settings deep link stays at login without an endless loading sheet'
    )
    await guestContext.close()
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
      setPhase: (v) => (phase = v),
      offline: async (v) => (fixtureOffline = v)
    })
  } else if (moderationSuite) {
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
      setPhase: (v) => (phase = v),
      offline: async (v) => (fixtureOffline = v)
    })
  } else {
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
      setPhase: (v) => (phase = v),
      offline: async (v) => (fixtureOffline = v)
    })
    phase = 'comments-permission-revoked'
    const post = new URLSearchParams(page.url().split('?').at(-1)).get('id')
    await page.reload()
    await page.locator('.post-comments__item').first().waitFor()
    await queue
    await db.query("update public.posts set status='deleted' where id=$1", [post])
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.getByText('内容不存在或你暂时无权查看', { exact: true }).waitFor()
    check(
      (await page.locator('.post-card:visible,.post-comments:visible').count()) === 0,
      'Contract revoked post clears previously loaded comments and content'
    )
    pausePost = true
    await button(page, '重试').click()
    await pausedPost
    check(
      (await page.locator('.post-card:visible,.post-comments:visible').count()) === 0,
      'Contract retry never flashes revoked cached content while request is pending'
    )
    pausePost = false
    unblockPost()
    await page.getByText('内容不存在或你暂时无权查看', { exact: true }).waitFor()
    await shot('comments-revoked-375')
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(unexpected, [])
  passed = true
} catch (e) {
  console.error(`Failed comment contract at ${phase}: ${e.message}`)
  await shot('failed').catch(() => {})
} finally {
  unblockPost?.()
  await browser.close()
  await queue
  await db.close()
  await writeFile(
    resolve(out, 'result.json'),
    JSON.stringify(
      {
        evidence: 'isolated HTTP contract backed by local PostgreSQL, not hosted',
        base,
        passed,
        phase,
        checks,
        errors,
        unexpected
      },
      null,
      2
    )
  )
}
console.log(JSON.stringify({ passed, phase, checks: checks.length, output: out }))
process.exitCode = passed ? 0 : 1
