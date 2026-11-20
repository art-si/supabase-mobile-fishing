import { randomUUID } from 'node:crypto'

export async function spotPhotoChecks({ db, as, rpc, read, write, check, rejects, base }) {
  const owner = randomUUID(),
    friend = randomUUID(),
    stranger = randomUUID(),
    moderator = randomUUID()
  const users = [owner, friend, stranger, moderator]
  for (const user of users) await db.query('insert into auth.users(id) values($1)', [user])
  await db.query('insert into fishing_private.moderators(user_id) values($1)', [moderator])
  await db.query(
    'insert into public.friendships(user_a,user_b) values(least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid))',
    [owner, friend]
  )
  const photo = async (user = owner, kind = 'image') => {
    const id = randomUUID(),
      path = `${user}/${id}.${kind === 'image' ? 'jpg' : 'mp4'}`
    await db.query(
      'insert into public.media_assets(id,owner_id,path,width,height,kind) values($1,$2,$3,80,60,$4)',
      [id, user, path, kind]
    )
    await db.query("insert into storage.objects(bucket_id,name) values('fishing-media',$1)", [path])
    return { id, path }
  }
  const metadata = (user, asset) =>
    as(user, () => db.query('select id from public.media_assets where id=$1', [asset.id])).then(
      (r) => r.rows.length
    )
  const storage = (user, asset) =>
    as(user, () => db.query('select id from storage.objects where name=$1', [asset.path])).then(
      (r) => r.rows.length
    )
  const current = (id, user = owner) => read(user, 'spot', { id })
  const snapshot = (id) => read(owner, 'edit_content', { id, type: 'spot' })
  const edit = async (id, fields, action = 'update_content') =>
    write(owner, action, {
      ...fields,
      id,
      type: 'spot',
      revision: (await snapshot(id)).revision,
      request_id: randomUUID()
    })
  const review = async (id, action = 'decide', decision = 'published') =>
    as(moderator, () =>
      rpc('moderation', action, {
        id,
        type: 'spot',
        revision: undefined,
        request_id: randomUUID(),
        decision,
        reason: '钓位照片专项审核'
      })
    )
  const decide = async (id, action = 'decide', decision = 'published') => {
    const revision = (await snapshot(id)).revision
    return as(moderator, () =>
      rpc('moderation', action, {
        id,
        type: 'spot',
        revision,
        request_id: randomUUID(),
        decision,
        reason: '钓位照片专项审核'
      })
    )
  }
  const draft = (fields = {}) => ({
    id: randomUUID(),
    name: '隔离钓位',
    city: '苏州',
    water_type: '自然水域',
    species: '鲫鱼',
    description: '本地钓位照片权限验证',
    fee_note: '未核实',
    access_note: '不公开的入口',
    observed_on: '2026-11-20',
    audience: 'private',
    precision: 'area',
    longitude: 120.61317,
    latitude: 31.31727,
    media: [],
    ...fields
  })
  try {
    const one = await photo(),
      two = await photo(),
      added = await photo(),
      foreign = await photo(stranger),
      video = await photo(owner, 'video')
    const privateDraft = draft({ media: [two, one] })
    await write(owner, 'save_spot', privateDraft)
    check(
      (await current(privateDraft.id)).media.map((m) => m.id).join() === [two.id, one.id].join(),
      'spot preserves selected photo order and metadata'
    )
    await write(owner, 'save_spot', privateDraft)
    check(
      (await current(privateDraft.id)).media.length === 2,
      'spot create retry does not duplicate attachments'
    )
    check(
      (await metadata(owner, one)) === 1 && (await storage(owner, one)) === 1,
      'owner can read private spot metadata and Storage'
    )
    for (const user of [null, friend, stranger, moderator])
      check(
        (await metadata(user, one)) === 0 && (await storage(user, one)) === 0,
        'private spot photos are denied to guests, friends, strangers and reviewers'
      )
    const legacy = { ...privateDraft, name: '旧客户端修改文字' }
    delete legacy.media
    await edit(privateDraft.id, legacy)
    check(
      (await current(privateDraft.id)).media.length === 2,
      'legacy text-only edit does not erase photographs'
    )
    for (const media of [[foreign], [video], [added, added], Array(10).fill(added)]) {
      const invalid = draft({ media })
      await rejects(
        () => write(owner, 'save_spot', invalid),
        /FORBIDDEN|INVALID_INPUT/,
        'invalid, duplicate, excessive or foreign spot media rolls back'
      )
      check(
        (await db.query('select id from public.fishing_spots where id=$1', [invalid.id])).rows
          .length === 0,
        'failed attachment leaves no partial spot'
      )
    }
    await rejects(
      () => write(owner, 'save_spot', draft({ media: [one] })),
      /FORBIDDEN/,
      'photo bound to another spot cannot be reused'
    )
    await rejects(
      () => write(owner, 'save_post', { ...base, id: randomUUID(), media: [one] }),
      /FORBIDDEN/,
      'post cannot take a spot photograph'
    )
    const old = await photo(),
      next = await photo(),
      final = await photo()
    const shared = draft({ audience: 'public', media: [old, next] })
    await write(owner, 'save_spot', shared)
    check((await storage(null, old)) === 0, 'new shared spot photos remain hidden while pending')
    const pendingReview = await review(shared.id, 'item')
    check(
      pendingReview.media.length === 2 &&
        !JSON.stringify(pendingReview).includes('120.61317') &&
        !JSON.stringify(pendingReview).includes('不公开的入口'),
      'review gets photographs without exact coordinates or access notes'
    )
    await decide(shared.id)
    check(
      (await storage(null, old)) === 1 && (await current(shared.id, null)).longitude === 120.62,
      'approved spot photos follow public access while coordinates remain coarse'
    )
    await edit(shared.id, { ...shared, media: [next, final] })
    check(
      (await current(shared.id, null)).media.map((m) => m.id).join() === [old.id, next.id].join(),
      'pending edit preserves the effective photograph order'
    )
    check(
      (await storage(null, final)) === 0 && (await metadata(friend, final)) === 0,
      'new proposed photograph is absent from public metadata and Storage'
    )
    check(
      (await snapshot(shared.id)).item.media.map((m) => m.id).join() === [next.id, final.id].join(),
      'author resumes selected proposed photos'
    )
    const proposalReview = await review(shared.id, 'proposal_item')
    check(
      proposalReview.media[1].id === final.id && proposalReview.current.media[0].id === old.id,
      'reviewer can compare proposed and effective photographs'
    )
    await decide(shared.id, 'proposal_decide', 'rejected')
    check(
      (await storage(null, final)) === 0 && (await current(shared.id, null)).media[0].id === old.id,
      'rejected proposal never replaces public photos'
    )
    await edit(shared.id, { ...shared, media: [final, next] })
    await decide(shared.id, 'proposal_decide')
    check(
      (await current(shared.id, null)).media.map((m) => m.id).join() ===
        [final.id, next.id].join() && (await storage(null, old)) === 0,
      'approval installs selected order and revokes removed photo access'
    )
    await edit(shared.id, { ...shared, audience: 'friends', media: [final, next] })
    check(
      (await storage(null, final)) === 0 && (await storage(friend, final)) === 1,
      'tightening audience immediately applies to effective photos'
    )
    await edit(shared.id, {}, 'discard_content_update')
    check(
      (await current(shared.id, friend)).media.length === 2,
      'discard keeps effective photos and tightened audience'
    )
    await edit(shared.id, { ...shared, audience: 'friends', media: [added] })
    await edit(shared.id, {}, 'withdraw_content')
    check(
      (await current(shared.id)).media[0].id === added.id &&
        (await storage(friend, added)) === 0 &&
        (await storage(moderator, added)) === 0,
      'withdraw installs latest photos privately and removes reviewer access'
    )
    const cleanupCurrent = await photo(),
      cleanupProposed = await photo()
    const deleted = draft({ audience: 'friends', media: [cleanupCurrent] })
    await write(owner, 'save_spot', deleted)
    await decide(deleted.id)
    await edit(deleted.id, { ...deleted, media: [cleanupProposed] })
    await write(owner, 'delete_content', { id: deleted.id, type: 'spot' })
    for (const asset of [cleanupCurrent, cleanupProposed]) {
      check(
        (await metadata(owner, asset)) === 0 && (await storage(owner, asset)) === 0,
        'deletion removes both effective and proposed media access'
      )
      check(
        (
          await db.query('select state from fishing_private.media_deletions where id=$1', [
            asset.id
          ])
        ).rows[0]?.state === 'pending',
        'deleted spot photo is queued for physical Storage cleanup'
      )
    }
    for (const fn of [
      'fishing_private.spot_photos(uuid,jsonb)',
      'fishing_private.set_spot_photos(uuid,jsonb,boolean)'
    ])
      check(
        !(
          await db.query("select has_function_privilege('authenticated',$1,'EXECUTE') allowed", [
            fn
          ])
        ).rows[0].allowed,
        'private helper cannot bypass public RPC permissions'
      )
  } finally {
    await db.query('delete from auth.users where id=any($1::uuid[])', [users])
  }
}
