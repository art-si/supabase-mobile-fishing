export async function zoneChecks({ db, as, check, rejects, alice, bob, eve }) {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 8 * 3600000 + 86400000).toISOString().slice(0, 10)
  const call = (user, kind, action, payload = {}) =>
    as(user, () =>
      db
        .query(`select public.fishing_zones_${kind}($1,$2) result`, [
          action,
          JSON.stringify(payload)
        ])
        .then((r) => r.rows[0].result)
    )
  const bounds = { west: 120, east: 121, south: 31, north: 32 }
  const base = {
    id: crypto.randomUUID(),
    request_id: crypto.randomUUID(),
    crs: 'GCJ-02',
    consent: true,
    title: '测试圈选',
    description: '标牌显示本水域暂时禁止垂钓，仅测试使用',
    location_label: '数据库测试水域',
    longitude: 120.5,
    latitude: 31.5,
    radius_m: 300,
    boundary: { type: 'Polygon', coordinates: [[[120.499,31.499],[120.501,31.499],[120.501,31.501],[120.499,31.501],[120.499,31.499]]] },
    observed_on: today,
    expires_on: tomorrow
  }
  await db.query(
    'insert into fishing_private.moderators(user_id) values($1) on conflict do nothing',
    [eve]
  )
  await rejects(
    () => call(null, 'write', 'submit', base),
    /permission denied/,
    'zone guest cannot submit'
  )
  for (const fields of [
    { consent: false },
    { boundary: null },
    { boundary: { type: 'Point', coordinates: [120.5,31.5] } },
    { boundary: { type: 'Polygon', coordinates: [[[120.499,31.499],[120.501,31.501],[120.501,31.499],[120.499,31.501],[120.499,31.499]]] } },
    { source: 'official' },
    { status: 'published' },
    { crs: 'WGS84' },
    { radius_m: 0 },
    { radius_m: 5001 },
    { longitude: 'NaN' },
    { latitude: 86 },
    { description: '短' },
    { expires_on: '2099-01-01' },
    { source_url: 'javascript:alert(1)' }
  ])
    await rejects(
      () => call(alice, 'write', 'submit', { ...base, ...fields }),
      /INVALID_INPUT/,
      'invalid or forged circle submission rejected'
    )
  const first = await call(alice, 'write', 'submit', base)
  check(first.status === 'pending' && first.revision === 1, 'zone starts private pending')
  check(
    (await call(alice, 'write', 'submit', base)).revision === 1,
    'same zone submission is idempotent'
  )
  await rejects(
    () => call(alice, 'write', 'submit', { ...base, title: 'changed' }),
    /EDIT_REQUEST_REUSED/,
    'changed idempotency payload denied'
  )
  check(
    (await call(null, 'read', 'nearby', bounds)).items.length === 0,
    'pending circle absent from public map'
  )
  check(
    (await call(bob, 'read', 'mine')).items.length === 0,
    'another member cannot read private pending circle'
  )
  check(
    (await call(alice, 'read', 'mine')).items.length === 1,
    'owner can recover pending submission'
  )
  await rejects(
    () => as(alice, () => db.query('select * from public.fishing_zone_reports')),
    /permission denied/,
    'raw zone table denied even to owner'
  )
  const decide = {
    id: base.id,
    revision: 1,
    request_id: crypto.randomUUID(),
    decision: 'published',
    reason: '测试审核'
  }
  await rejects(
    () => call(alice, 'write', 'decide', decide),
    /FORBIDDEN/,
    'ordinary author cannot approve'
  )
  await db.query(
    'insert into fishing_private.moderators(user_id) values($1) on conflict do nothing',
    [alice]
  )
  await rejects(
    () => call(alice, 'write', 'decide', decide),
    /SELF_REVIEW/,
    'moderator cannot self-review zone'
  )
  await db.query('delete from fishing_private.moderators where user_id=$1', [alice])
  check(
    (await call(eve, 'write', 'decide', decide)).revision === 2,
    'independent reviewer publishes circle'
  )
  check(
    (await call(eve, 'write', 'decide', decide)).revision === 2,
    'moderation retry creates no second revision'
  )
  const published = (await call(null, 'read', 'nearby', bounds)).items[0]
  check(
    published.source === 'community' &&
      published.crs === 'GCJ-02' &&
      !('author_id' in published) &&
      !('review_note' in published),
    'public projection never turns approval into official authority or reveals author/review fields'
  )
  check(
    (await call(null, 'read', 'nearby', { west: 110, east: 111, south: 20, north: 21 })).items
      .length === 0,
    'viewport filters remote circles'
  )
  check(
    (await call(null, 'read', 'nearby', { west: 70, east: 140, south: 0, north: 60 })).zoom_in,
    'unbounded nationwide reads require zooming'
  )
  await rejects(
    () =>
      call(eve, 'write', 'decide', {
        ...decide,
        request_id: crypto.randomUUID(),
        decision: 'hidden'
      }),
    /REVIEW_CONFLICT/,
    'stale moderator revision rejected'
  )
  await rejects(
    () =>
      call(bob, 'write', 'withdraw', { id: base.id, request_id: crypto.randomUUID(), revision: 2 }),
    /FORBIDDEN/,
    'other user cannot withdraw'
  )
  const withdraw = { id: base.id, request_id: crypto.randomUUID(), revision: 2 }
  await call(alice, 'write', 'withdraw', withdraw)
  check(
    (await call(null, 'read', 'nearby', bounds)).items.length === 0,
    'withdrawal immediately removes public circle'
  )
  check(
    (await call(alice, 'write', 'withdraw', withdraw)).revision === 3,
    'withdrawal retry is idempotent'
  )
  await call(eve, 'write', 'decide', decide)
  check(
    (await call(null, 'read', 'nearby', bounds)).items.length === 0,
    'late approval receipt cannot resurrect withdrawn zone'
  )
  await db.query('delete from fishing_private.moderators where user_id=$1', [eve])
  await rejects(
    () => call(eve, 'write', 'decide', decide),
    /FORBIDDEN/,
    'revoked reviewer cannot replay approval receipt'
  )
  await db.query('insert into fishing_private.moderators values($1)', [eve])
  const second = { ...base, id: crypto.randomUUID(), request_id: crypto.randomUUID() }
  await call(alice, 'write', 'submit', second)
  await call(eve, 'write', 'decide', { ...decide, id: second.id, request_id: crypto.randomUUID() })
  await db.query(
    'update public.fishing_zone_reports set observed_on=current_date-2,expires_on=current_date-1 where id=$1',
    [second.id]
  )
  check(
    (await call(null, 'read', 'nearby', bounds)).items.length === 0,
    'expired reminders disappear even without a scheduled job'
  )
}
