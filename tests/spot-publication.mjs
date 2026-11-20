import { randomUUID } from 'node:crypto'

// Actual PostgreSQL/RLS checks, isolated from hosted data and external maps.
export async function spotPublicationChecks({
  db,
  as,
  rpc,
  read,
  write,
  check,
  rejects,
  migration
}) {
  const owner = randomUUID(),
    friend = randomUUID(),
    outsider = randomUUID()
  const users = [owner, friend, outsider]
  for (const id of users) await db.query('insert into auth.users(id) values($1)', [id])
  await db.query(
    'insert into public.friendships(user_a,user_b) values(least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid))',
    [owner, friend]
  )
  const draft = (fields = {}) => ({
    id: randomUUID(),
    name: '独立钓位名称',
    city: '武汉市',
    water_type: '自然水域',
    species: '鲫鱼',
    description: '本地验证',
    fee_note: '免费',
    access_note: '步行入口',
    observed_on: '2026-11-20',
    audience: 'public',
    precision: 'exact',
    longitude: 114.313,
    latitude: 30.613,
    media: [],
    ...fields
  })
  const spot = (id, user = owner) => read(user, 'spot', { id })
  const snapshot = (id) => read(owner, 'edit_content', { id, type: 'spot' })
  const command = async (fields) => ({
    ...fields,
    type: 'spot',
    revision: (await snapshot(fields.id)).revision,
    request_id: randomUUID()
  })
  try {
    const pending = draft(),
      live = draft(),
      hidden = draft(),
      rejected = draft(),
      deleted = draft()
    for (const fields of [pending, live, hidden, rejected, deleted])
      await write(owner, 'save_spot', fields)
    await db.query("update public.fishing_spots set status='published' where id=$1", [live.id])
    await write(owner, 'update_content', await command({ ...live, description: '已提交的新水情' }))
    await db.query("update public.fishing_spots set status='hidden' where id=$1", [hidden.id])
    await db.query("update public.fishing_spots set status='rejected' where id=$1", [rejected.id])
    await write(owner, 'delete_content', { type: 'spot', id: deleted.id })
    await db.exec(migration)
    check(
      (await spot(pending.id, null)).status === 'published',
      'upgrade publishes pending spots without review'
    )
    check(
      (await spot(live.id, null)).description === '已提交的新水情' &&
        !(await spot(live.id)).content_update,
      'upgrade installs submitted edits and consumes their review proposal'
    )
    check(
      (await spot(hidden.id)).status === 'hidden' &&
        (await spot(rejected.id)).status === 'rejected',
      'upgrade retains hidden and rejected spot states'
    )
    await rejects(() => spot(hidden.id, null), /NOT_FOUND/, 'hidden spots stay inaccessible')
    await rejects(() => snapshot(deleted.id), /NOT_FOUND/, 'deleted spots are never restored')

    const fields = draft({ location_label: '湖北省武汉市蔡甸区测试地址' }),
      asset = randomUUID()
    await db.query(
      'insert into public.media_assets(id,owner_id,path,width,height) values($1,$2,$3,80,60)',
      [asset, owner, `${owner}/${asset}.jpg`]
    )
    fields.media = [{ id: asset }]
    await write(owner, 'save_spot', fields)
    const published = await spot(fields.id, null)
    check(
      published.status === 'published' &&
        published.name === fields.name &&
        published.location_label === fields.location_label,
      'new spot immediately exposes its independent name and selected address'
    )
    check(published.media[0].id === asset, 'direct publication keeps ordered spot media')
    await write(owner, 'save_spot', fields)
    check((await spot(fields.id)).media.length === 1, 'create retry is idempotent')
    const edit = await command({
      ...fields,
      name: '自定义短名称',
      location_label: '湖北省武汉市新的实际地址',
      description: '立即生效的新描述'
    })
    await write(owner, 'update_content', edit)
    const changed = await spot(fields.id, null)
    check(
      changed.name === edit.name &&
        changed.location_label === edit.location_label &&
        changed.description === edit.description &&
        !changed.content_update,
      'spot edits immediately replace the effective address and content'
    )
    await write(owner, 'update_content', edit)
    check((await snapshot(fields.id)).revision === 2, 'edit retry does not create another revision')
    await rejects(
      () => write(owner, 'update_content', { ...edit, request_id: randomUUID() }),
      /EDIT_CONFLICT/,
      'stale revisions cannot overwrite current content'
    )
    await rejects(
      () => write(outsider, 'update_content', { ...edit, revision: 2, request_id: randomUUID() }),
      /NOT_FOUND/,
      'another user cannot edit a spot'
    )
    await write(owner, 'update_content', await command({ ...fields, media: [] }))
    check(
      (await spot(fields.id, null)).media.length === 0,
      'direct edits install attachment removals without a review stage'
    )
    await write(owner, 'update_content', await command({ ...fields, audience: 'friends' }))
    check(
      (await spot(fields.id, friend)).location_label === fields.location_label,
      'friends see exact addresses only within the chosen audience'
    )
    await rejects(
      () => spot(fields.id, outsider),
      /NOT_FOUND/,
      'friend-only spots stay inaccessible to strangers'
    )
    await write(owner, 'update_content', await command({ ...fields, audience: 'private' }))
    await rejects(
      () => spot(fields.id, friend),
      /NOT_FOUND/,
      'private spot edits immediately revoke friend access'
    )
    await write(owner, 'update_content', await command({ ...fields, precision: 'area' }))
    const area = await spot(fields.id, null)
    check(
      area.location_label === '' &&
        area.access_note === '' &&
        area.longitude !== fields.longitude &&
        area.latitude !== fields.latitude,
      'area projection strips detailed address and rounds coordinates'
    )
    await write(owner, 'update_content', await command({ ...fields, precision: 'hidden' }))
    const concealed = await spot(fields.id, null)
    check(
      concealed.location_label === '' &&
        concealed.longitude === null &&
        concealed.latitude === null,
      'hidden projection strips address and coordinates'
    )
    check(
      (await spot(fields.id)).location_label === fields.location_label,
      'owner retains their address while hiding location'
    )
    for (const label of ['x'.repeat(241), null, 123])
      await rejects(
        () => write(owner, 'save_spot', draft({ location_label: label })),
        /INVALID_INPUT/,
        'invalid address payload is rejected atomically'
      )
    await rejects(
      () => as(null, () => rpc('write', 'save_spot', draft())),
      /AUTH_REQUIRED|NOT_AUTHENTICATED|permission denied/,
      'anonymous spot creation is rejected'
    )
    check(
      !(
        await db.query(
          "select has_function_privilege('authenticated','fishing_private.spot_location_label(jsonb)','EXECUTE') allowed"
        )
      ).rows[0].allowed,
      'address helper is unavailable outside the checked RPC'
    )
  } finally {
    await db.query('delete from auth.users where id=any($1::uuid[])', [users])
  }
}
