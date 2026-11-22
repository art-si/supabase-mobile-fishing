import { randomUUID } from 'node:crypto'

export async function spotFishingChecks({
  db,
  as,
  read,
  write,
  check,
  rejects,
  migration,
  communityMigration,
  automaticFencesMigration
}) {
  const owner = randomUUID(),
    other = randomUUID(),
    moderator = randomUUID()
  for (const id of [owner, other, moderator])
    await db.query('insert into auth.users(id) values($1)', [id])
  await db.query('insert into fishing_private.moderators(user_id) values($1)', [moderator])
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const draft = {
    id: randomUUID(),
    name: '垂钓标记数据库测试',
    city: '武汉市',
    water_type: '自然水域',
    species: '',
    description: '',
    fee_note: '免费',
    access_note: '',
    observed_on: today,
    audience: 'public',
    precision: 'exact',
    longitude: 114.18,
    latitude: 30.48,
    media: []
  }
  const callZone = (user, type, action, payload) =>
    as(
      user,
      async () =>
        (
          await db.query(`select public.fishing_zones_${type}($1,$2) result`, [
            action,
            JSON.stringify(payload)
          ])
        ).rows[0].result
    )
  try {
    await write(owner, 'save_spot', draft)
    await db.exec(migration)
    await db.exec(communityMigration)
    await db.exec(automaticFencesMigration)
    check(
      (await read(null, 'spot', { id: draft.id })).fishing_status === 'allowed',
      'existing spots default to allowed'
    )
    for (const fishing_status of [null, '', 'unknown', 'pending', {}, true])
      await rejects(
        () => write(owner, 'save_spot', { ...draft, id: randomUUID(), fishing_status }),
        /INVALID_INPUT/,
        'reject unsupported fishing status'
      )
    const marked = { ...draft, id: randomUUID(), fishing_status: 'prohibited' }
    await write(owner, 'save_spot', marked)
    check(
      (await read(null, 'spot', { id: marked.id })).fishing_status === 'prohibited',
      'new prohibited spots publish their marker immediately'
    )
    const bounds = { west: 114.17, east: 114.19, south: 30.47, north: 30.49 }
    const fencePoints = async () => (await callZone(null, 'read', 'nearby', bounds)).spot_points
    const hiddenPoint = { ...marked, id: randomUUID(), precision: 'area' }
    await write(owner, 'save_spot', hiddenPoint)
    const automaticPoints = await fencePoints()
    check(automaticPoints.some(point => point.id === marked.id && point.longitude === marked.longitude) &&
      !automaticPoints.some(point => [draft.id, hiddenPoint.id].includes(point.id)),
      'anonymous fence projection includes exact public prohibited spots only')
    const edit = async (fields) => ({
      ...fields,
      type: 'spot',
      revision: (await read(owner, 'edit_content', { id: draft.id, type: 'spot' })).revision,
      request_id: randomUUID()
    })
    const command = await edit({ ...draft, fishing_status: 'prohibited' })
    await write(owner, 'update_content', command)
    await write(owner, 'update_content', command)
    const item = await read(null, 'spot', { id: draft.id })
    check(
      item.fishing_status === 'prohibited' && item.review_revision === 2,
      'published spot marks are revisioned and retries are idempotent'
    )
    await rejects(
      () => write(other, 'update_content', { ...command, revision: 2, request_id: randomUUID() }),
      /NOT_FOUND/,
      'other users cannot overwrite a spot marker'
    )
    await rejects(
      () => write(owner, 'update_content', { ...command, request_id: randomUUID() }),
      /EDIT_CONFLICT/,
      'stale marks cannot overwrite newer content'
    )
    await rejects(
      async () =>
        write(owner, 'update_content', { ...(await edit(draft)), fishing_status: 'unknown' }),
      /INVALID_INPUT/,
      'updates also reject unknown status'
    )
    await write(owner, 'update_content', await edit(draft))
    check(
      (await read(null, 'spot', { id: draft.id })).fishing_status === 'prohibited',
      'legacy edits retain an existing prohibited marker'
    )
    await write(owner, 'update_content', await edit({ ...draft, fishing_status: 'allowed' }))
    check(
      (await read(null, 'spot', { id: draft.id })).fishing_status === 'allowed',
      'author can change prohibited back to allowed'
    )
    check(!(await fencePoints()).some(point => point.id === draft.id),
      'changing a spot to allowed immediately removes its fence')
    await write(
      owner,
      'update_content',
      await edit({ ...draft, fishing_status: 'prohibited', audience: 'private' })
    )
    await rejects(
      () => read(null, 'spot', { id: draft.id }),
      /NOT_FOUND/,
      'marking preserves spot privacy'
    )
    check(!(await fencePoints()).some(point => point.id === draft.id),
      'private prohibited spots never publish a fence')

    const zone = {
      id: randomUUID(),
      request_id: randomUUID(),
      title: '本地禁钓测试',
      description: '现场标牌显示此范围内禁止垂钓，仅数据库测试',
      location_label: '测试水域',
      longitude: 114.18,
      latitude: 30.48,
      radius_m: 150,
      boundary: {
        type: 'Polygon',
        coordinates: [
          [
            [114.179, 30.479],
            [114.181, 30.479],
            [114.181, 30.481],
            [114.179, 30.481],
            [114.179, 30.479]
          ]
        ]
      },
      observed_on: today,
      expires_on: today,
      source_url: '',
      crs: 'GCJ-02',
      consent: true
    }
    const published = await callZone(owner, 'write', 'submit', zone)
    check(published.status === 'published', 'community boundary publishes without review')
    check(
      (await callZone(owner, 'write', 'submit', zone)).revision === 1,
      'community publication retry is idempotent'
    )
    const nearby = await callZone(null, 'read', 'nearby', {
      west: 114.17,
      east: 114.19,
      south: 30.47,
      north: 30.49
    })
    const publicZone = nearby.items.find((z) => z.id === zone.id)
    check(
      publicZone?.source === 'community' &&
        publicZone.boundary &&
        !publicZone.boundary_note.includes('已审核'),
      'new fence is publicly drawn with truthful community provenance'
    )
    for (const forged of [
      { source: 'official' },
      { status: 'published' },
      { consent: false },
      { boundary: null }
    ])
      await rejects(
        () =>
          callZone(owner, 'write', 'submit', {
            ...zone,
            id: randomUUID(),
            request_id: randomUUID(),
            ...forged
          }),
        /INVALID_INPUT/,
        'direct publication still rejects forged or missing boundary data'
      )
    await rejects(
      () =>
        callZone(other, 'write', 'withdraw', {
          id: zone.id,
          request_id: randomUUID(),
          revision: 1
        }),
      /FORBIDDEN/,
      'other users cannot withdraw a community fence'
    )
    await callZone(moderator, 'write', 'decide', {
      id: zone.id,
      request_id: randomUUID(),
      revision: 1,
      decision: 'hidden',
      reason: '核对后隐藏错误标记'
    })
    check(
      !(
        await callZone(null, 'read', 'nearby', {
          west: 114.17,
          east: 114.19,
          south: 30.47,
          north: 30.49
        })
      ).items.some((z) => z.id === zone.id),
      'incorrect community fences remain removable by moderation'
    )
  } finally {
    await db.query('delete from auth.users where id=any($1::uuid[])', [[owner, other, moderator]])
  }
}
