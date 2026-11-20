import { randomUUID } from 'node:crypto'

export async function publishingChecks({ db, as, rpc, read, write, check, rejects, base }) {
  const owner = randomUUID(),
    other = randomUUID(),
    moderator = randomUUID()
  const users = [owner, other, moderator]
  for (const id of users) await db.query('insert into auth.users(id) values($1)', [id])
  await db.query('insert into fishing_private.moderators(user_id) values($1)', [moderator])
  const asset = async (user, kind, size = 100) => {
    const id = randomUUID()
    await db.query(
      'insert into public.media_assets(id,owner_id,path,width,height,kind,size,duration) values($1,$2,$3,960,540,$4,$5,$6)',
      [
        id,
        user,
        `${user}/${id}.${kind === 'video' ? 'mp4' : 'jpg'}`,
        kind,
        size,
        kind === 'video' ? 5.005 : null
      ]
    )
    return { id }
  }
  const save = (fields = {}) => write(owner, 'save_post', { ...base, id: randomUUID(), ...fields })
  try {
    for (const fields of [
      { location_label: '' },
      { location_longitude: null },
      { location_latitude: 100 },
      { location_longitude: 'NaN' },
      { occurred_at: `${base.occurred_on}T24:00:00+08:00` },
      { occurred_at: '2020-01-01T08:00:00+08:00' },
      { topic: '字'.repeat(41) },
      { additives: {} }
    ])
      await rejects(
        () => save(fields),
        /POST_LOCATION_REQUIRED|INVALID_INPUT/,
        'post rejects incomplete location and malformed publishing fields'
      )
    const video = await asset(owner, 'video', 20971520),
      image = await asset(owner, 'image')
    await rejects(
      () => asset(owner, 'video', 20971521),
      /media_upload_size/,
      'database enforces video byte limit'
    )
    await rejects(
      () => asset(owner, 'image', 8388609),
      /media_upload_size/,
      'video limit does not expand photo limit'
    )
    const mixedVideo = await asset(owner, 'video'), mixedImage = await asset(owner, 'image')
    const mixed = await save({ media: [mixedVideo, mixedImage] })
    const mixedPost = (await read(owner, 'post', { id: mixed.id })).post
    check(mixedPost.media.length === 2 && mixedPost.media[0].kind === 'video' && mixedPost.media[1].kind === 'image', 'images and videos share one ordered attachment list')
    const foreign = await asset(other, 'video')
    await rejects(
      () => save({ media: [foreign] }),
      /MEDIA_UNAVAILABLE|FORBIDDEN|INVALID_MEDIA|PHOTO_UNAVAILABLE/,
      'another owner cannot attach a video'
    )
    const id = randomUUID()
    await save({
      id,
      location_longitude: 120.623456,
      location_latitude: 31.32789,
      occurred_at: `${base.occurred_on}T08:35:00+08:00`,
      additives: '果酸、虾油',
      media: [video]
    })
    let post = (await read(owner, 'post', { id })).post
    check(
      post.location_longitude === 120.62 &&
        post.location_latitude === 31.32 &&
        post.additives === '果酸、虾油' &&
        post.occurred_at,
      'saved posts keep selected time, multiple additives and coarse coordinates'
    )
    check(
      post.media[0].kind === 'video' &&
        post.media[0].size === 20971520 &&
        Number(post.media[0].duration) === 5.005,
      'authorized projections retain real video metadata'
    )
    await rejects(
      () => read(other, 'post', { id }),
      /NOT_FOUND|FORBIDDEN/,
      'private video post is owner-only'
    )
    const snapshot = async () => read(owner, 'edit_content', { type: 'post', id })
    const edit = async (fields) =>
      write(owner, 'update_content', {
        ...base,
        id,
        type: 'post',
        revision: (await snapshot()).revision,
        request_id: randomUUID(),
        ...fields
      })
    const review = (action, payload) => as(moderator, () => rpc('moderation', action, payload))
    const approve = async (action) =>
      review(action, {
        id,
        type: 'post',
        revision: (await snapshot()).revision,
        request_id: randomUUID(),
        decision: 'published',
        reason: '本机发布验收'
      })
    await edit({ audience: 'public', media: [video], additives: '虾油' })
    await approve('decide')
    await edit({
      audience: 'public',
      media: [image],
      kind: 'experience',
      topic: '装备心得',
      additives: '果酸',
      location_label: '新的测试水域',
      location_longitude: 120.66,
      location_latitude: 31.36
    })
    post = (await read(null, 'post', { id })).post
    check(
      post.media[0].kind === 'video' && post.location_label === base.location_label,
      'unapproved media and locations do not replace public content'
    )
    const pending = await snapshot()
    check(
      pending.item.topic === '装备心得' &&
        pending.item.additives === '' &&
        pending.item.occurred_at === null &&
        pending.item.media[0].kind === 'image',
      'experience proposals clear catch-only metadata while preserving ordered media'
    )
    await approve('proposal_decide')
    post = (await read(null, 'post', { id })).post
    check(
      post.topic === '装备心得' &&
        post.location_label === '新的测试水域' &&
        post.location_longitude === 120.66,
      'approval installs the proposed topic and coarse location together'
    )
    const trip = await write(owner, 'save_trip', {
      ...base,
      id: randomUUID(),
      occurred_at: `${base.occurred_on}T07:15:00+08:00`,
      additives: '蜂蜜',
      media: [video]
    })
    const log = await read(owner, 'edit_content', { type: 'trip', id: trip.id })
    check(
      log.item.additives === '蜂蜜' && log.item.occurred_at && log.item.media[0].kind === 'video',
      'private logs support video, time and additives'
    )
    await rejects(
      () => as(owner, () => db.query("select fishing_private.post_publishing_fields('{}')")),
      /permission denied/,
      'publishing helpers are not public RPCs'
    )
    const bucket = (
      await db.query(
        "select file_size_limit,allowed_mime_types,public from storage.buckets where id='fishing-media'"
      )
    ).rows[0]
    check(
      Number(bucket.file_size_limit) === 20971520 &&
        bucket.allowed_mime_types.includes('video/mp4') &&
        !bucket.public,
      'bucket stays private with bounded MP4 upload support'
    )
  } finally {
    await db.query('delete from auth.users where id=any($1::uuid[])', [users])
  }
}
