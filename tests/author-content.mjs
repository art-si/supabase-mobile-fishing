import { randomUUID } from 'node:crypto'

export async function authorChecks({ db, as, read, write, check, rejects, alice, bob, eve, base }) {
  await db.exec('delete from fishing_private.rate_events')
  const id = randomUUID(),
    other = randomUUID(),
    photo = randomUUID(),
    foreign = randomUUID()
  const snapshot = (user, type, target = id) => read(user, 'edit_content', { type, id: target })
  const edit = {
    ...base,
    id,
    type: 'post',
    revision: 1,
    request_id: randomUUID(),
    title: '修改后的记录'
  }
  await write(alice, 'save_post', { ...base, id })
  await write(alice, 'save_post', { ...base, id: other })
  await db.query(
    'insert into public.media_assets(id,owner_id,path,width,height,post_id) values($1,$2,$3,40,40,$4),($5,$6,$7,40,40,null)',
    [photo, alice, `test/${photo}.jpg`, other, foreign, bob, `test/${foreign}.jpg`]
  )
  check(
    (await snapshot(alice, 'post')).revision === 1,
    'owner edit snapshot includes current revision'
  )
  await rejects(
    () => snapshot(null, 'post'),
    /AUTH_REQUIRED/,
    'anonymous cannot fetch an edit snapshot'
  )
  await rejects(
    () => snapshot(bob, 'post'),
    /NOT_FOUND/,
    'another author cannot fetch an edit snapshot'
  )
  await rejects(
    () => write(bob, 'update_content', edit),
    /NOT_FOUND/,
    'another author cannot update a record'
  )
  await rejects(
    () =>
      as(alice, () =>
        db.query('select fishing_private.author_write($1,$2::jsonb)', [
          'update_content',
          JSON.stringify(edit)
        ])
      ),
    /permission denied/,
    'author helpers cannot bypass the write RPC rate limit'
  )
  await rejects(
    () => write(alice, 'update_content', { ...edit, media: [{ id: foreign }] }),
    /FORBIDDEN/,
    'editing cannot attach another author photo'
  )
  await rejects(
    () => write(alice, 'update_content', { ...edit, media: [{ id: photo }] }),
    /FORBIDDEN/,
    'editing cannot steal a photo from another record'
  )
  check(
    (await snapshot(alice, 'post')).revision === 1,
    'invalid photo rolls back title and revision atomically'
  )
  const result = await write(alice, 'update_content', edit)
  check(
    result.revision === 2 && (await snapshot(alice, 'post')).item.title === edit.title,
    'owner edit changes the existing record and increments revision'
  )
  const retry = await write(alice, 'update_content', edit)
  check(
    retry.revision === 2 && (await snapshot(alice, 'post')).revision === 2,
    'same request retry does not apply the edit twice'
  )
  await rejects(
    () => write(alice, 'update_content', { ...edit, title: 'changed retry' }),
    /EDIT_REQUEST_REUSED/,
    'reusing a request ID with changed fields is rejected'
  )
  await rejects(
    () => write(alice, 'update_content', { ...edit, request_id: randomUUID() }),
    /EDIT_CONFLICT/,
    'a stale editor cannot overwrite a newer record'
  )
  await rejects(
    () =>
      write(alice, 'update_content', { ...edit, revision: undefined, request_id: randomUUID() }),
    /EDIT_CONFLICT/,
    'missing revision cannot bypass stale edit checks'
  )
  const ownPhoto = randomUUID()
  await db.query(
    'insert into public.media_assets(id,owner_id,path,width,height) values($1,$2,$3,40,40)',
    [ownPhoto, alice, `test/${ownPhoto}.jpg`]
  )
  const shared = {
    ...edit,
    revision: 2,
    request_id: randomUUID(),
    audience: 'public',
    media: [{ id: ownPhoto }]
  }
  await write(alice, 'update_content', shared)
  check(
    (await snapshot(alice, 'post')).item.status === 'pending',
    'shared edit returns to review instead of self-approving'
  )
  await db.query("update public.posts set status='published' where id=$1", [id])
  check(
    (await read(null, 'post', { id })).post.media.length === 1,
    'approved edited post exposes its attached photo'
  )
  await rejects(
    () => write(alice, 'update_content', { ...shared, revision: 3, request_id: randomUUID() }),
    /EDIT_CONFLICT/,
    'moderation changes invalidate an old author editor'
  )
  const withdraw = { id, type: 'post', revision: 4, request_id: randomUUID() }
  await write(alice, 'withdraw_content', withdraw)
  check(
    (await snapshot(alice, 'post')).item.audience === 'private',
    'withdraw retains the record for its owner'
  )
  await rejects(
    () => read(null, 'post', { id }),
    /NOT_FOUND/,
    'withdraw revokes visitor detail access'
  )
  await rejects(
    () => read(eve, 'post', { id }),
    /NOT_FOUND/,
    'withdraw revokes reviewer ordinary detail access'
  )
  check(
    (await as(eve, () => db.query('select id from public.media_assets where id=$1', [ownPhoto])))
      .rows.length === 0,
    'withdraw revokes new reviewer photo access'
  )
  await write(alice, 'withdraw_content', withdraw)
  check((await snapshot(alice, 'post')).revision === 5, 'withdraw retry leaves revision unchanged')
  await write(alice, 'update_content', {
    ...edit,
    revision: 5,
    request_id: randomUUID(),
    media: []
  })
  check(
    (await db.query('select post_id,trip_id from public.media_assets where id=$1', [ownPhoto]))
      .rows[0].post_id === null,
    'removing a photo detaches it instead of leaving a public parent'
  )
  await write(alice, 'delete_content', { type: 'post', id })
  await rejects(
    () => snapshot(alice, 'post'),
    /NOT_FOUND/,
    'deleted record cannot reopen an editor'
  )
  await rejects(
    () => write(alice, 'update_content', { ...edit, revision: 7, request_id: randomUUID() }),
    /NOT_FOUND/,
    'edit cannot resurrect a deleted post'
  )
  await write(alice, 'update_content', edit)
  check(
    (await db.query('select status from public.posts where id=$1', [id])).rows[0].status ===
      'deleted',
    'replaying an old successful edit does not resurrect deleted data'
  )
  const trip = randomUUID()
  await write(alice, 'save_trip', { ...base, id: trip })
  await write(alice, 'update_content', {
    ...base,
    id: trip,
    type: 'trip',
    revision: 1,
    request_id: randomUUID(),
    weight: '',
    count: '0',
    media: [{ id: ownPhoto }]
  })
  const log = await snapshot(alice, 'trip', trip)
  check(
    log.revision === 2 &&
      log.item.weight_kg === null &&
      log.item.count === 0 &&
      log.item.media.length === 1,
    'trip edit preserves unknown weight versus zero fish and attached photos'
  )
  await rejects(() => snapshot(bob, 'trip', trip), /NOT_FOUND/, 'edited trip stays owner-only')
  const spot = randomUUID()
  const spotDraft = {
    id: spot,
    name: '秘密岸边',
    city: '苏州',
    water_type: '自然水域',
    observed_on: '2026-11-19',
    audience: 'public',
    precision: 'area',
    longitude: 120.123456,
    latitude: 31.123456,
    access_note: '秘密入口'
  }
  await write(alice, 'save_spot', spotDraft)
  await write(alice, 'save_spot', spotDraft)
  check(
    (await snapshot(alice, 'spot', spot)).revision === 1,
    'retrying spot creation is idempotent'
  )
  await rejects(
    () => write(alice, 'save_spot', { ...spotDraft, name: '旧客户端覆盖' }),
    /EDIT_REQUEST_REUSED/,
    'legacy spot upsert cannot overwrite existing content'
  )
  await db.query("update public.fishing_spots set status='published' where id=$1", [spot])
  await write(alice, 'withdraw_content', {
    id: spot,
    type: 'spot',
    revision: 2,
    request_id: randomUUID()
  })
  const privateSpot = await snapshot(alice, 'spot', spot)
  check(
    privateSpot.item.longitude === spotDraft.longitude &&
      privateSpot.item.access_note === '秘密入口',
    'spot withdrawal preserves owner exact coordinates and access notes'
  )
  await rejects(
    () => read(null, 'spot', { id: spot }),
    /NOT_FOUND/,
    'withdrawn spot no longer exposes even approximate coordinates'
  )
  await write(alice, 'delete_content', { type: 'spot', id: spot })
  await rejects(
    () => write(alice, 'save_spot', spotDraft),
    /NOT_FOUND/,
    'old create retry cannot resurrect a deleted spot'
  )
  check(
    (
      await db.query(
        "select relrowsecurity from pg_class where oid='fishing_private.author_write_receipts'::regclass"
      )
    ).rows[0].relrowsecurity,
    'edit receipts are RLS protected without client access'
  )
  await rejects(
    () => as(alice, () => db.query('select * from fishing_private.author_write_receipts')),
    /permission denied/,
    'even authors cannot read internal receipt signatures'
  )
}
