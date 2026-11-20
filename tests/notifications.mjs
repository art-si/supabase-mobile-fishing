import { randomUUID } from 'node:crypto'

export async function notificationChecks({ db, as, rpc, read, write, check, rejects, base }) {
  const owner = randomUUID(),
    peer = randomUUID(),
    other = randomUUID(),
    reviewer = randomUUID()
  await db.query('insert into auth.users(id) values($1),($2),($3),($4)', [
    owner,
    peer,
    other,
    reviewer
  ])
  await db.query('insert into fishing_private.moderators(user_id) values($1)', [reviewer])
  await db.query("update public.profiles set nickname='通知钓友' where id=$1", [peer])
  const call = (user, action, payload = {}) => as(user, () => rpc('notifications', action, payload))
  const review = (payload) => as(reviewer, () => rpc('moderation', 'decide', payload))
  const page = (user, category = 'interaction') => call(user, 'page', { category })
  const count = async (user, category = 'interaction') => (await call(user, 'summary'))[category]
  const post = randomUUID(),
    root = randomUUID(),
    reply = randomUUID()
  await write(owner, 'save_post', { ...base, id: post, audience: 'public' })
  const publish = {
    id: post,
    type: 'post',
    revision: 1,
    decision: 'published',
    reason: '通知验收',
    request_id: randomUUID()
  }
  await review(publish)
  const approved = (await page(owner, 'system')).items[0]
  check(
    approved.kind === 'review' && approved.target.id === post && !approved.read,
    'review outcome reaches only the author inbox'
  )
  await review(publish)
  check(
    (await page(owner, 'system')).items.length === 1,
    'replayed review creates no duplicate notification'
  )
  await rejects(
    () => call(null, 'page'),
    /permission denied/,
    'anonymous cannot read notifications'
  )
  await rejects(
    () => call(randomUUID(), 'page'),
    /NOT_AUTHENTICATED/,
    'deleted identity cannot read notifications'
  )
  await rejects(
    () => as(owner, () => db.query('select * from fishing_private.notifications')),
    /permission denied/,
    'raw inbox is inaccessible even to its owner'
  )
  await rejects(
    () =>
      as(owner, () =>
        db.query('select fishing_private.enqueue_notification($1,$2,$3,$4)', [
          other,
          'like',
          owner,
          post
        ])
      ),
    /permission denied/,
    'client cannot forge a notification'
  )
  check(
    (await page(other)).items.length === 0 && (await count(other, 'system')) === 0,
    'other account sees no notifications or unread count'
  )
  await rejects(
    () => call(other, 'open', { id: approved.id }),
    /NOT_FOUND/,
    'notification IDs cannot cross account ownership'
  )

  await write(owner, 'reaction', { id: post, kind: 'like', enabled: true })
  check((await count(owner)) === 0, 'self-like produces no notification')
  await write(peer, 'reaction', { id: post, kind: 'like', enabled: true })
  const liked = (await page(owner)).items[0]
  check(
    liked.kind === 'like' && liked.title === '通知钓友赞了你的动态' && liked.target.id === post,
    'like event projects current actor and post'
  )
  check(
    (await read(owner, 'social')).notifications.interaction === 1,
    'social summary exposes inbox unread separately from conversations'
  )
  await write(peer, 'reaction', { id: post, kind: 'like', enabled: true })
  check((await page(owner)).items.length === 1, 'idempotent like does not create duplicate events')
  await call(owner, 'open', { id: liked.id })
  await write(peer, 'reaction', { id: post, kind: 'like', enabled: false })
  const undone = (await call(owner, 'refresh', { ids: [liked.id] })).items[0]
  check(
    !undone.available &&
      undone.target === null &&
      undone.read &&
      !undone.title.includes('通知钓友'),
    'unlike redacts actor and target and removes unread'
  )
  await write(peer, 'reaction', { id: post, kind: 'like', enabled: true })
  check(
    (await page(owner)).items.length === 1 && (await page(owner)).items[0].read,
    'unlike/re-like cannot reset read state or spam new events'
  )

  await write(peer, 'comment', { id: root, post_id: post, body: '通知评论原文' })
  await write(owner, 'comment', { id: reply, post_id: post, body: '作者回复', reply_to_id: root })
  const rootNotice = (await page(owner)).items.find((n) => n.kind === 'comment')
  const replyNotice = (await page(peer)).items[0]
  check(
    rootNotice.preview === '通知评论原文' &&
      replyNotice.kind === 'reply' &&
      replyNotice.target.id === post,
    'comment reaches post author and reply reaches quoted author'
  )
  await write(peer, 'comment', { id: root, post_id: post, body: '通知评论原文' })
  check((await page(owner)).items.length === 2, 'comment create retry is deduplicated')
  const third = randomUUID()
  await write(other, 'comment', {
    id: third,
    post_id: post,
    body: '同时回复作者',
    reply_to_id: reply
  })
  check(
    (await page(owner)).items.filter((n) => n.preview === '同时回复作者').length === 1 &&
      (await page(owner)).items[0].kind === 'reply',
    'quoted post author gets one reply instead of two events'
  )
  const loaded = (await page(owner)).items.map((n) => n.id)
  await write(other, 'comment', { id: randomUUID(), post_id: post, body: '并发新通知' })
  await call(owner, 'mark_read', { ids: [...loaded, replyNotice.id] })
  check(
    (await count(owner)) === 1 && !(await page(peer)).items[0].read,
    'batch read only marks loaded own IDs, not concurrent or foreign events'
  )
  await write(owner, 'block', { id: peer, enabled: true })
  const blocked = await call(owner, 'refresh', { ids: [liked.id, rootNotice.id] })
  check(
    blocked.items.every((n) => !n.available && n.read && n.target === null) &&
      !JSON.stringify(blocked).includes('通知评论原文'),
    'block redacts interaction content and badges on next read'
  )
  check(
    !(await call(peer, 'open', { id: replyNotice.id })).available,
    'open rechecks a block instead of trusting cached target'
  )
  await write(owner, 'block', { id: peer, enabled: false })

  check((await call(owner, 'preferences')).comments, 'notification preferences default on')
  await call(owner, 'set_preference', { key: 'likes', enabled: false })
  await call(owner, 'set_preference', { key: 'comments', enabled: false })
  check(
    !(await call(owner, 'preferences')).likes &&
      !(await call(owner, 'preferences')).comments &&
      (await call(peer, 'preferences')).likes,
    'independent preference patches preserve other settings and account isolation'
  )
  const before = (await page(owner)).items.length
  await write(other, 'reaction', { id: post, kind: 'like', enabled: true })
  await write(other, 'comment', { id: randomUUID(), post_id: post, body: '关闭后不通知' })
  check(
    (await page(owner)).items.length === before,
    'disabled preferences stop only future likes and comments'
  )
  await call(owner, 'set_preference', { key: 'comments', enabled: true })
  check(
    (await page(owner)).items.length === before,
    'reenabling preferences does not backfill suppressed events'
  )
  for (const [action, payload] of [
    ['page', { category: 'all' }],
    ['page', { cursor: '1 or true' }],
    ['open', { id: '-1' }],
    ['set_preference', { key: 'system', enabled: false }],
    ['set_preference', { key: 'likes', enabled: 'false' }],
    ['refresh', { ids: [null] }],
    ['refresh', { ids: [1] }],
    ['mark_read', { ids: Array(201).fill('1') }],
    ['refresh', { ids: [], category: 'bad' }]
  ])
    await rejects(
      () => call(owner, action, payload),
      /INVALID_INPUT/,
      'malformed inbox input is rejected'
    )

  await db.query("update public.posts set audience='private' where id=$1", [post])
  check(
    (await page(owner)).items.every((n) => !n.available) &&
      !(await page(peer)).items[0].available &&
      (await count(owner)) === 0,
    'private parent redacts all interaction previews including owner notifications'
  )
  check(
    (await page(owner, 'system')).items[0].available,
    'own review result can still open own private content'
  )
  await db.query("update public.posts set audience='public' where id=$1", [post])
  await write(peer, 'delete_comment', { id: root, post_id: post })
  check(
    !(await call(owner, 'open', { id: rootNotice.id })).available &&
      !(await call(peer, 'open', { id: replyNotice.id })).available,
    'deleted comment and deleted quote cannot leak through inbox'
  )

  await write(owner, 'friend_request', { id: peer, note: '通知测试' })
  const request = (await read(peer, 'social')).requests[0]
  await write(peer, 'friend_respond', { id: request.id, accept: true })
  const friend = (await page(owner)).items.find((n) => n.kind === 'friend_accepted')
  check(
    friend?.available && friend.target.id === peer,
    'accepted friend request sends an interaction notification'
  )
  await write(owner, 'unfriend', { id: peer })
  check(
    !(await call(owner, 'open', { id: friend.id })).available,
    'unfriend revokes previous friend notification target'
  )

  const report = await as(other, () =>
    rpc('reports', 'submit', { type: 'post', id: post, reason: '通知回执验证' })
  )
  const reportItem = await as(reviewer, () => rpc('reports', 'item', { id: report.id }))
  await as(reviewer, () =>
    rpc('reports', 'decide', {
      id: report.id,
      revision: 1,
      content_revision: reportItem.content.revision,
      decision: 'dismiss',
      reason: '检查后无需处理',
      request_id: randomUUID()
    })
  )
  const result = (await page(other, 'system')).items[0]
  check(
    result.kind === 'report_result' &&
      result.target.type === 'reports' &&
      !JSON.stringify(result).includes(reviewer) &&
      !result.preview.includes('通知回执验证'),
    'report outcome uses safe own-report route and no reviewer/evidence snapshot'
  )

  // Bulk fixture is local PostgreSQL only; verifies keyset pages without spending write quotas.
  await db.query(
    "insert into public.comments(id,post_id,author_id,body) select gen_random_uuid(),$1,$2,'分页通知-'||n from generate_series(1,44)n",
    [post, other]
  )
  const first = await page(owner)
  await db.query(
    "insert into public.comments(id,post_id,author_id,body) values(gen_random_uuid(),$1,$2,'分页中新到')",
    [post, other]
  )
  const second = await call(owner, 'page', { category: 'interaction', cursor: first.next })
  check(
    first.items.length === 20 &&
      second.items.length === 20 &&
      first.next === first.items.at(-1).id &&
      !second.items.some((n) => first.items.some((p) => p.id === n.id)),
    'keyset cursor returns 20 unique older events despite a concurrent insert'
  )
  const refreshed = await call(owner, 'refresh', { ids: first.items.map((n) => n.id) })
  check(
    refreshed.items.length === 20 && BigInt(refreshed.latest) > BigInt(first.items[0].id),
    'refresh reauthorizes loaded rows and signals new events without shifting pagination'
  )
  await db.query('delete from public.posts where id=$1', [post])
  check(
    (await call(owner, 'refresh', { ids: first.items.map((n) => n.id) })).items.length === 0,
    'hard-deleted content cascades and disappears from refresh'
  )
  const zoneCall = (user, action, payload) =>
    as(user, () =>
      db
        .query('select public.fishing_zones_write($1,$2::jsonb) result', [
          action,
          JSON.stringify(payload)
        ])
        .then((r) => r.rows[0].result)
    )
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 8 * 3600000 + 86400000).toISOString().slice(0, 10)
  const zone = randomUUID()
  await zoneCall(owner, 'submit', {
    id: zone,
    request_id: randomUUID(),
    crs: 'GCJ-02',
    consent: true,
    title: '通知测试水域',
    description: '通知验收的测试水域标识，不是真实禁钓信息。',
    location_label: '测试水域',
    longitude: 120.5,
    latitude: 31.5,
    radius_m: 300,
    observed_on: today,
    expires_on: tomorrow
  })
  const zoneDecision = {
    id: zone,
    revision: 1,
    request_id: randomUUID(),
    decision: 'published',
    reason: '隔离通知测试'
  }
  await zoneCall(reviewer, 'decide', zoneDecision)
  const zoneNotice = (await page(owner, 'system')).items.find((n) => n.kind === 'zone_review')
  check(
    zoneNotice.available &&
      zoneNotice.target.type === 'zones' &&
      !JSON.stringify(zoneNotice).includes('120.5'),
    'zone review notification opens own marks without copying exact coordinates'
  )
  await zoneCall(reviewer, 'decide', zoneDecision)
  check(
    (await page(owner, 'system')).items.filter((n) => n.kind === 'zone_review').length === 1,
    'zone review retry emits no duplicate notification'
  )
  await zoneCall(owner, 'withdraw', { id: zone, revision: 2, request_id: randomUUID() })
  check(
    !(await call(owner, 'open', { id: zoneNotice.id })).available,
    'withdrawn zone reminder is redacted in old notifications'
  )
  check(
    (
      await db.query(
        "select payload,topic from realtime.messages where topic=$1 and event='invalidate'",
        [`fishing:user:${owner}`]
      )
    ).rows.every((r) => JSON.stringify(r.payload) === '{"v":1}'),
    'notification invalidations carry no inbox text or content identifiers'
  )
  await db.query('delete from auth.users where id in ($1,$2,$3,$4)', [owner, peer, other, reviewer])
  check(
    (
      await db.query(
        'select id from fishing_private.notifications where recipient_id=any($1::uuid[])',
        [[owner, peer, other, reviewer]]
      )
    ).rows.length === 0 &&
      (
        await db.query(
          'select user_id from fishing_private.notification_preferences where user_id=$1',
          [owner]
        )
      ).rows.length === 0,
    'account cleanup cascades inbox and notification preferences'
  )
}
