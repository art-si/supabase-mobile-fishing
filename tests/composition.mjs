import { randomUUID } from 'node:crypto'

export async function compositionChecks({
  db,
  as,
  read,
  write,
  check,
  rejects,
  alice,
  bob,
  eve,
  base
}) {
  await db.exec('delete from fishing_private.rate_events')
  const empty = { ...base, title: '', body: '', media: [], audience: 'private' }
  const save = (value) => write(alice, 'save_post', { ...empty, id: randomUUID(), ...value })
  await rejects(
    () => save({ title: 'only a title' }),
    /COMPOSITION_EMPTY/,
    'post title alone is not content'
  )
  await rejects(
    () => save({ body: '\n\t　 ' }),
    /COMPOSITION_EMPTY/,
    'whitespace does not count as post text'
  )
  for (const media of [null, {}, 'bad', Array.from({ length: 10 }, () => ({ id: randomUUID() }))])
    await rejects(
      () => save({ body: 'valid', media }),
      /INVALID_INPUT/,
      'post rejects invalid media shape or count'
    )
  for (const fields of [
    { title: 42 },
    { body: [] },
    { title: 'x'.repeat(61) },
    { body: 'x'.repeat(2001) }
  ])
    await rejects(
      () => save(fields),
      /INVALID_INPUT/,
      'composition rejects invalid field types and limits'
    )
  const text = await save({ body: '只有正文也能分享' })
  check(
    text.title === '' && text.body === '只有正文也能分享',
    'text-only post retains an empty author title'
  )
  const photos = Array.from({ length: 9 }, () => randomUUID())
  for (const [index, id] of photos.entries())
    await db.query(
      "insert into public.media_assets(id,owner_id,path,width,height,created_at) values($1,$2,$3,20,30,now()+$4::int*interval '1 second')",
      [id, alice, `test/${id}.jpg`, index]
    )
  const ordered = [photos[8], ...photos.slice(0, 8)]
  const id = randomUUID(),
    payload = {
      ...empty,
      id,
      title: undefined,
      body: undefined,
      media: ordered.map((id) => ({ id }))
    }
  await rejects(
    () => save({ media: [{ id: photos[0] }, { id: photos[0] }] }),
    /INVALID_INPUT/,
    'duplicate photo IDs cannot qualify a post'
  )
  await rejects(
    () => save({ media: [{}] }),
    /INVALID_INPUT/,
    'missing photo ID cannot qualify a post'
  )
  const result = await write(alice, 'save_post', payload)
  check(
    result.title === '' &&
      result.body === '' &&
      result.media.map((m) => m.id).join() === ordered.join(),
    'nine-photo-only post preserves requested order instead of upload time'
  )
  await rejects(
    () => read(bob, 'post', { id }),
    /NOT_FOUND/,
    'photo-only private post remains private'
  )
  await rejects(
    () => write(bob, 'save_post', payload),
    /FORBIDDEN/,
    'create retry cannot take another author photo post'
  )
  await rejects(
    () => save({ media: [{ id: ordered[0] }] }),
    /FORBIDDEN/,
    'new post cannot take a photo already attached to another record'
  )
  const before = await read(alice, 'edit_content', { type: 'post', id })
  const edit = {
    ...empty,
    id,
    type: 'post',
    revision: before.revision,
    request_id: randomUUID(),
    media: [...ordered].reverse().map((id) => ({ id }))
  }
  const saved = await write(alice, 'update_content', edit)
  const after = await read(alice, 'edit_content', { type: 'post', id })
  check(
    after.item.media.map((m) => m.id).join() === [...ordered].reverse().join(),
    'author edit persists reverse photo order'
  )
  check(
    (await write(alice, 'update_content', edit)).revision === saved.revision,
    'same order edit retry is idempotent'
  )
  check(
    (await write(alice, 'save_post', payload)).media.map((m) => m.id).join() ===
      [...ordered].reverse().join(),
    'old create retry never restores obsolete photo order'
  )
  await rejects(
    () =>
      write(alice, 'update_content', {
        ...edit,
        request_id: randomUUID(),
        revision: after.revision,
        media: []
      }),
    /COMPOSITION_EMPTY/,
    'removing the last photo requires body text'
  )
  check(
    (await read(alice, 'edit_content', { type: 'post', id })).revision === after.revision,
    'empty edit rolls back revision and media atomically'
  )
  await write(alice, 'update_content', {
    ...edit,
    request_id: randomUUID(),
    revision: after.revision,
    body: '改为文字记录',
    media: []
  })
  check(
    (
      await db.query(
        'select id from public.media_assets where id=any($1::uuid[]) and post_id is null and sort_order=0',
        [photos]
      )
    ).rows.length === 9,
    'removal detaches photos and clears their former sort positions'
  )
  const trip = randomUUID()
  const log = await write(alice, 'save_trip', {
    ...empty,
    id: trip,
    title: '仅标题的私人日志',
    media: ordered.slice(0, 3).map((id) => ({ id }))
  })
  check(log.id === trip, 'private log allows no body and saves its photo ordering')
  const logRead = await read(alice, 'edit_content', { type: 'trip', id: trip })
  check(
    logRead.item.body === '' &&
      logRead.item.media.map((m) => m.id).join() === ordered.slice(0, 3).join(),
    'private log projection respects stored photo order'
  )
  await rejects(
    () => write(alice, 'save_trip', { ...empty, id: randomUUID() }),
    /COMPOSITION_TITLE_REQUIRED/,
    'private log still requires title'
  )
  await rejects(
    () => write(alice, 'save_trip', { ...empty, id: randomUUID(), title: ' \n　' }),
    /COMPOSITION_TITLE_REQUIRED/,
    'private log rejects whitespace title'
  )
  for (const query of [
    "select fishing_private.validate_composition('post','{}')",
    "select fishing_private.set_content_media('post',gen_random_uuid(),'[]')"
  ])
    await rejects(
      () => as(alice, () => db.query(query)),
      /permission denied/,
      'private composition helpers cannot bypass RPC authorization'
    )
  // Use existing local reviewer only; this never promotes a hosted user.
  const reviewPost = await save({
    audience: 'friends',
    kind: 'experience',
    media: [{ id: photos[5] }]
  })
  const grant = await db.query(
    'insert into fishing_private.moderators(user_id) values($1) on conflict do nothing returning user_id',
    [eve]
  )
  try {
    const review = await as(eve, () =>
      db.query("select public.fishing_moderation('item',$1::jsonb) result", [
        JSON.stringify({ id: reviewPost.id, type: 'post' })
      ])
    )
    check(
      review.rows[0].result.title === '心得照片',
      'moderation detail gives photo-only content a nonempty read-only caption'
    )
  } finally {
    if (grant.rows.length)
      await db.query('delete from fishing_private.moderators where user_id=$1', [eve])
  }
}
