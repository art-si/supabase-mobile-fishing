import { randomUUID } from 'node:crypto'

// Real PostgreSQL/RLS logic with isolated local identities. Not hosted service or UI evidence.
export async function contentUpdateChecks({ db, as, rpc, read, write, check, rejects, base }) {
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
  const review = (action, payload = {}, user = moderator) =>
    as(user, () => rpc('moderation', action, payload))
  const snapshot = (type, id) => read(owner, 'edit_content', { type, id })
  const canonical = async (id, user = owner) => (await read(user, 'post', { id })).post
  const edit = async (type, id, fields) => ({
    ...fields,
    type,
    id,
    revision: (await snapshot(type, id)).revision,
    request_id: randomUUID()
  })
  const decide = async (id, type = 'post', action = 'decide', decision = 'published') => {
    const payload = {
      id,
      type,
      revision: (await snapshot(type, id)).revision,
      request_id: randomUUID(),
      decision,
      reason: action === 'decide' ? '原内容审核说明' : '隔离修改审核说明'
    }
    return { payload, result: await review(action, payload) }
  }
  const photo = async (user = owner) => {
    const id = randomUUID(),
      path = `${user}/${id}.jpg`
    await db.query(
      'insert into public.media_assets(id,owner_id,path,width,height) values($1,$2,$3,20,30)',
      [id, user, path]
    )
    await db.query("insert into storage.objects(bucket_id,name) values('fishing-media',$1)", [path])
    return { id, path }
  }
  const metadata = (user, id) =>
    as(user, () => db.query('select * from public.media_assets where id=$1', [id])).then(
      (r) => r.rows
    )
  const storage = (user, path) =>
    as(user, () => db.query('select * from storage.objects where name=$1', [path])).then(
      (r) => r.rows
    )
  const queue = async () => {
    const items = []
    let cursor
    for (let page = 0; page < 30; page++) {
      const result = await review('queue', cursor ? { cursor } : {})
      items.push(...result.items)
      if (!result.next) return items
      cursor = result.next
    }
    throw new Error('review cursor failed to finish')
  }
  const currentRow = async (type, id) =>
    (
      await db.query(
        `select * from public.${type === 'post' ? 'posts' : 'fishing_spots'} where id=$1`,
        [id]
      )
    ).rows[0]
  const stored = async (type, id) =>
    (
      await db.query(
        'select * from fishing_private.content_updates where target_type=$1 and target_id=$2',
        [type, id]
      )
    ).rows[0]
  const resetRates = () =>
    db.query('delete from fishing_private.rate_events where user_id=any($1::uuid[])', [users])
  const id = randomUUID(),
    oldPhoto = await photo(),
    newPhoto = await photo(),
    nextPhoto = await photo(),
    alienPhoto = await photo(stranger)
  const original = {
    ...base,
    id,
    audience: 'public',
    title: '原版标题',
    body: '原版正文',
    media: [oldPhoto]
  }
  try {
    await write(owner, 'save_post', original)
    await decide(id)
    const proposed = {
      ...original,
      title: '修改标题',
      body: '修改正文',
      media: [newPhoto, oldPhoto]
    }
    const request = await edit('post', id, proposed)
    const receipt = await write(owner, 'update_content', request)
    check(receipt.revision === 3, 'a staged edit advances the shared version exactly once')
    check(
      (await currentRow('post', id)).status === 'published',
      'staging never unpublishes the current version'
    )
    for (const user of [null, friend, stranger, owner]) {
      const post = await canonical(id, user)
      check(
        post.title === original.title &&
          post.body === original.body &&
          post.media.map((m) => m.id).join() === oldPhoto.id,
        'every ordinary detail retains the current text and photo order'
      )
      check(
        user === owner ? post.content_update.status === 'pending' : post.content_update === null,
        'proposal metadata is owner-only, not leaked through normal projection'
      )
    }
    const draft = await snapshot('post', id)
    check(
      draft.item.body === proposed.body &&
        draft.item.media.map((m) => m.id).join() === [newPhoto.id, oldPhoto.id].join(),
      'author editor loads the latest proposal with its independent photo order'
    )
    check(
      draft.publication.status === 'published' && draft.publication.audience === 'public',
      'editor receives a safe publication baseline separately from edited fields'
    )
    check(
      (await as(friend, () => db.query('select title from public.posts where id=$1', [id]))).rows[0]
        .title === original.title,
      'raw REST table projection contains only current fields'
    )
    for (const user of [null, friend, stranger]) {
      check(
        (await metadata(user, newPhoto.id)).length === 0 &&
          (await storage(user, newPhoto.path)).length === 0,
        'staged photos are denied by both metadata RLS and Storage policy'
      )
      check(
        (await storage(user, oldPhoto.path)).length === 1,
        'old approved photo remains readable during review'
      )
    }
    for (const user of [owner, moderator])
      check(
        (await metadata(user, newPhoto.id)).length === 1 &&
          (await storage(user, newPhoto.path)).length === 1,
        'owner and authorized reviewer can preview proposed media'
      )
    const reviewDraft = await review('proposal_item', { type: 'post', id })
    check(
      reviewDraft.is_update &&
        reviewDraft.body === proposed.body &&
        reviewDraft.current.body === original.body &&
        reviewDraft.media[0].id === newPhoto.id,
      'explicit proposal review compares complete proposed and current content'
    )
    check(
      (await review('item', { type: 'post', id })).body === original.body,
      'report/base review continues to inspect the effective content'
    )
    const searched = await read(stranger, 'feed', { query: original.title })
    check(
      searched.items.some((p) => p.id === id && p.body === original.body),
      'search indexes and returns the old approved version during review'
    )
    check(
      !(await read(stranger, 'feed', { query: proposed.title })).items.some((p) => p.id === id),
      'unapproved title cannot leak through a search hit'
    )
    await db.query('insert into public.post_bookmarks(user_id,post_id) values($1,$2)', [friend, id])
    check(
      (await read(friend, 'library', { type: 'saved' })).posts.find((p) => p.id === id)?.body ===
        original.body,
      'bookmarks reproject only the current approved version'
    )
    const conversation = await write(owner, 'conversation', { id: friend })
    const card = await write(owner, 'send_message', {
      conversation_id: conversation,
      client_id: randomUUID(),
      kind: 'post',
      reference_id: id
    })
    check(
      card.card?.title === original.title,
      'chat card caption is the current publication, never the draft'
    )
    await rejects(
      () =>
        write(owner, 'send_message', {
          conversation_id: conversation,
          client_id: randomUUID(),
          kind: 'image',
          media_id: newPhoto.id
        }),
      /PHOTO_NOT_AVAILABLE/,
      'staged photo cannot be rebound into a chat message'
    )
    check(
      (await queue()).filter((x) => x.id === id && x.is_update).length === 1,
      'staged edit appears once as a modification in the review queue'
    )
    await rejects(
      () => review('proposal_item', { type: 'post', id }, friend),
      /FORBIDDEN/,
      'regular member cannot fetch an unreviewed proposal'
    )
    await rejects(
      () => read(stranger, 'edit_content', { type: 'post', id }),
      /NOT_FOUND/,
      'public visibility does not grant the edit snapshot'
    )
    await rejects(
      () => as(owner, () => db.query('select * from fishing_private.content_updates')),
      /permission denied/,
      'private proposal table cannot be read directly'
    )
    const functions = await db.query(
      "select p.oid::regprocedure::text name from pg_proc p where p.pronamespace='fishing_private'::regnamespace and p.proname in ('content_update_fields','content_update_media','clear_content_update','install_content_update','handle_content_update','content_update_lifecycle','content_update_info','content_update_photos','content_update_review','content_update_decide','content_review_queue') and (p.prosecdef or p.proconfig is distinct from array['search_path=\"\"']::text[] or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute'))"
    )
    check(
      functions.rows.length === 0,
      'all eleven new helpers are invoker, empty-path and unavailable directly to clients'
    )
    const forged = await edit('post', id, { ...proposed, media: [alienPhoto] })
    await rejects(
      () => write(owner, 'update_content', forged),
      /FORBIDDEN/,
      'staging rejects another account photo'
    )
    const otherId = randomUUID()
    await write(owner, 'save_post', { ...base, id: otherId, media: [nextPhoto] })
    await rejects(
      () => write(owner, 'update_content', { ...forged, media: [nextPhoto] }),
      /FORBIDDEN/,
      'staging rejects a photo attached to another record'
    )
    await rejects(
      () => write(owner, 'update_content', { ...forged, media: [newPhoto, newPhoto] }),
      /INVALID_INPUT/,
      'proposal cannot contain duplicate photo identities'
    )
    check(
      (await snapshot('post', id)).revision === 3 &&
        (await stored('post', id)).fields.body === proposed.body,
      'invalid edits preserve the current proposal and version atomically'
    )
    await write(owner, 'update_content', request)
    check(
      (await snapshot('post', id)).revision === 3,
      'exact author retry does not submit a second proposal'
    )
    await rejects(
      () => write(owner, 'update_content', { ...request, body: 'forged replay' }),
      /EDIT_REQUEST_REUSED/,
      'receipt reuse cannot change proposed content'
    )
    await rejects(
      () =>
        review('proposal_decide', {
          id,
          type: 'post',
          revision: 3,
          decision: 'hidden',
          reason: 'wrong action',
          request_id: randomUUID()
        }),
      /INVALID_INPUT/,
      'proposal decision cannot hide the current publication'
    )
    await db.query('insert into fishing_private.moderators(user_id) values($1)', [owner])
    await rejects(
      () =>
        review(
          'proposal_decide',
          {
            id,
            type: 'post',
            revision: 3,
            decision: 'published',
            reason: 'self',
            request_id: randomUUID()
          },
          owner
        ),
      /SELF_REVIEW/,
      'even a moderator author cannot approve their own modification'
    )
    await db.query('delete from fishing_private.moderators where user_id=$1', [owner])
    const rejected = await decide(id, 'post', 'proposal_decide', 'rejected')
    check(
      rejected.result.revision === 4 && (await canonical(id, stranger)).body === original.body,
      'rejecting a modification leaves the current version published'
    )
    check(
      (await canonical(id)).content_update.reason === '隔离修改审核说明' &&
        (await snapshot('post', id)).item.body === proposed.body,
      'rejected proposal and reviewer explanation remain editable for the author'
    )
    check(
      !(await queue()).some((x) => x.id === id),
      'rejected modification leaves the pending queue'
    )
    check(
      (await review('own_status', { id, type: 'post' }, owner)).reason === '原内容审核说明' &&
        (await review('own_status', { id, type: 'post' }, owner)).status === 'published',
      'proposal rejection does not replace the base review status or explanation'
    )
    await write(owner, 'update_content', request)
    check(
      (await snapshot('post', id)).revision === 4 &&
        (await stored('post', id)).status === 'rejected',
      'late author retry cannot revive a rejected proposal'
    )
    await write(owner, 'update_content', await edit('post', id, proposed))
    await rejects(
      () => review('proposal_decide', { ...rejected.payload, request_id: randomUUID() }),
      /REVIEW_CONFLICT/,
      'old reviewer page cannot act on a newer author proposal'
    )
    const accepted = await decide(id, 'post', 'proposal_decide')
    const effective = await canonical(id, stranger)
    check(
      effective.title === proposed.title &&
        effective.body === proposed.body &&
        effective.media.map((m) => m.id).join() === [newPhoto.id, oldPhoto.id].join(),
      'approval atomically installs fields, media membership and independent ordering'
    )
    check(
      effective.content_update === null && !(await stored('post', id)),
      'approved proposal is consumed without keeping private snapshots in normal reads'
    )
    check(
      (await metadata(stranger, newPhoto.id))[0].is_staged === false,
      'approval makes the selected staged photo available normally'
    )
    await review('proposal_decide', accepted.payload)
    check(
      (await snapshot('post', id)).revision === 6,
      'review decision retry cannot advance or overwrite the effective version'
    )
    await rejects(
      () => review('decide', accepted.payload),
      /REVIEW_CONFLICT/,
      'proposal receipt cannot be reused for base moderation'
    )
    const notices = await as(owner, () => rpc('notifications', 'page', { category: 'system' }))
    check(
      JSON.stringify(notices).includes('动态修改已通过复核') &&
        JSON.stringify(notices).includes('动态修改未通过审核'),
      'notification labels distinguish modification decisions from base content decisions'
    )
    const tightened = await edit('post', id, {
      ...proposed,
      audience: 'friends',
      body: '好友修改稿'
    })
    await write(owner, 'update_content', tightened)
    await rejects(
      () => canonical(id, stranger),
      /NOT_FOUND/,
      'public to friends narrowing takes effect before proposal approval'
    )
    check(
      (await canonical(id, friend)).body === proposed.body,
      'friend still sees the approved version, not the narrowed proposal'
    )
    const discard = { id, type: 'post', revision: 7, request_id: randomUUID() }
    await write(owner, 'discard_content_update', discard)
    await write(owner, 'discard_content_update', discard)
    check(
      (await snapshot('post', id)).revision === 8 &&
        (await canonical(id, friend)).audience === 'friends',
      'discard is idempotent and does not undo an immediate privacy tightening'
    )
    await rejects(
      () =>
        write(owner, 'discard_content_update', {
          ...discard,
          revision: 8,
          request_id: randomUUID()
        }),
      /EDIT_CONFLICT/,
      'discarding an absent proposal cannot advance the version'
    )
    await write(owner, 'update_content', await edit('post', id, proposed))
    await rejects(
      () => canonical(id, stranger),
      /NOT_FOUND/,
      'friends to public widening waits for review'
    )
    await decide(id, 'post', 'proposal_decide')
    check(
      (await canonical(id, stranger)).audience === 'public',
      'approval applies the requested wider audience'
    )
    check(
      (await read(friend, 'message_content', { id: conversation, ids: [card.id] }))[0].card
        .title === proposed.title,
      'existing chat cards refresh to the newly approved caption'
    )
    const privatePhoto = await photo()
    await write(
      owner,
      'update_content',
      await edit('post', id, { ...proposed, body: '撤回时保留的最新稿', media: [privatePhoto] })
    )
    const withdraw = { id, type: 'post', revision: 11, request_id: randomUUID() }
    await write(owner, 'withdraw_content', withdraw)
    await write(owner, 'withdraw_content', withdraw)
    check(
      (await canonical(id)).body === '撤回时保留的最新稿' &&
        (await canonical(id)).media[0].id === privatePhoto.id &&
        (await snapshot('post', id)).revision === 12,
      'withdraw installs the latest proposed text/photos privately exactly once'
    )
    for (const user of [friend, stranger, moderator]) {
      await rejects(
        () => canonical(id, user),
        /NOT_FOUND/,
        'withdraw revokes ordinary content access, including reviewer'
      )
      check(
        (await storage(user, privatePhoto.path)).length === 0,
        'withdraw revokes subsequent private photo access'
      )
    }
    await review('proposal_decide', accepted.payload)
    check(
      (await canonical(id)).audience === 'private' && (await snapshot('post', id)).revision === 12,
      'late approval receipt cannot republish a withdrawn version'
    )
    await rejects(
      () => review('proposal_item', { id, type: 'post' }),
      /NOT_FOUND/,
      'withdrawn proposal is unavailable to reviewers'
    )
    check(
      !(await read(friend, 'library', { type: 'saved' })).posts.some((p) => p.id === id) &&
        (await read(friend, 'message_content', { id: conversation, ids: [card.id] }))[0].card ===
          null,
      'withdraw revokes bookmarked content and existing chat-card preview'
    )
    await resetRates()

    // Hidden/restored/deleted content cannot use a pending proposal to bypass base moderation.
    await write(owner, 'update_content', await edit('post', id, proposed))
    check(
      (await currentRow('post', id)).status === 'pending',
      'sharing formerly private content still needs ordinary first review'
    )
    await decide(id)
    await write(
      owner,
      'update_content',
      await edit('post', id, { ...proposed, body: '隐藏前修改', media: [privatePhoto] })
    )
    await decide(id, 'post', 'decide', 'hidden')
    check(
      (await stored('post', id)).status === 'rejected' &&
        (await snapshot('post', id)).item.body === '隐藏前修改',
      'hiding the base content retains but rejects its proposal'
    )
    await rejects(
      () => review('proposal_item', { id, type: 'post' }),
      /NOT_FOUND/,
      'hidden base has no actionable pending modification'
    )
    await decide(id)
    check(
      (await canonical(id, stranger)).body === proposed.body &&
        (await stored('post', id)).status === 'rejected',
      'restoring the base never approves its rejected proposal'
    )
    await write(
      owner,
      'update_content',
      await edit('post', id, { ...proposed, body: '删除前修改', media: [privatePhoto] })
    )
    await write(owner, 'delete_content', { id, type: 'post' })
    check(
      !(await stored('post', id)) && (await metadata(owner, privatePhoto.id))[0].post_id === null,
      'soft deletion removes proposal and detaches only staged assets'
    )
    await rejects(
      () => review('proposal_decide', { ...accepted.payload, request_id: randomUUID() }),
      /NOT_FOUND/,
      'a deleted publication cannot be revived by proposal approval'
    )

    // Spot coordinates and access notes are never projected to proposal reviewers.
    const spotId = randomUUID()
    const spot = {
      id: spotId,
      name: '原钓位',
      city: '苏州',
      water_type: '水库',
      species: '鲫鱼',
      description: '原说明',
      fee_note: '未核实',
      observed_on: '2026-11-19',
      audience: 'public',
      precision: 'exact',
      longitude: 120.513456,
      latitude: 31.257654,
      access_note: '原私密入口'
    }
    await write(owner, 'save_spot', spot)
    const baseApproval = await decide(spotId, 'spot')
    const moved = {
      ...spot,
      name: '修改钓位',
      description: '修改说明',
      audience: 'friends',
      precision: 'area',
      longitude: 121.123456,
      latitude: 30.123456,
      access_note: '新私密入口'
    }
    await write(owner, 'update_content', await edit('spot', spotId, moved))
    const oldSpot = await read(friend, 'spot', { id: spotId })
    check(
      oldSpot.name === spot.name &&
        oldSpot.precision === 'area' &&
        oldSpot.longitude === 120.52 &&
        oldSpot.latitude === 31.26 &&
        oldSpot.access_note === '',
      'spot privacy narrows immediately while current coordinates remain on the old stable grid'
    )
    const map = (bounds) =>
      as(friend, () =>
        db.query('select public.fishing_map_spots($1::jsonb) result', [JSON.stringify(bounds)])
      ).then((r) => r.rows[0].result)
    const oldBounds = { west: 120.4, east: 120.7, south: 31.1, north: 31.4 }
    const newBounds = { west: 121, east: 121.3, south: 30, north: 30.3 }
    check(
      (await map(oldBounds)).items.find((s) => s.id === spotId)?.longitude === 120.52 &&
        !(await map(newBounds)).items.some((s) => s.id === spotId),
      'map pins use old coarse coordinates, never the proposed destination'
    )
    await rejects(
      () => read(stranger, 'spot', { id: spotId }),
      /NOT_FOUND/,
      'spot narrowing removes stranger access immediately'
    )
    const spotReview = await review('proposal_item', { type: 'spot', id: spotId })
    check(
      spotReview.title === moved.name &&
        spotReview.current.title === spot.name &&
        !/121\.123456|120\.513456|私密入口|longitude|latitude|access_note/.test(
          JSON.stringify(spotReview)
        ),
      'neither comparison version leaks precise or hidden spot coordinates to reviewers'
    )
    check(
      (await snapshot('spot', spotId)).item.longitude === moved.longitude,
      'owner editor retains proposed precise coordinates'
    )
    await rejects(
      () => review('proposal_decide', baseApproval.payload),
      /REVIEW_CONFLICT/,
      'base approval receipt cannot be reused as a modification approval'
    )
    const bad = await edit('spot', spotId, moved)
    for (const fields of [
      { longitude: 'NaN' },
      { latitude: 91 },
      { longitude: null, latitude: null, precision: 'exact' },
      { name: '' },
      { city: 'x'.repeat(41) },
      { access_note: 'x'.repeat(501) },
      { observed_on: null },
      { precision: 'fake' }
    ])
      await rejects(
        () => write(owner, 'update_content', { ...bad, ...fields }),
        /INVALID_INPUT/,
        'malformed proposed spot is rejected without replacing the valid draft'
      )
    check(
      (await snapshot('spot', spotId)).revision === 3,
      'invalid spot proposals roll back version and draft'
    )
    await write(
      owner,
      'update_content',
      await edit('spot', spotId, { ...moved, audience: 'public', precision: 'exact' })
    )
    const notWidened = await read(friend, 'spot', { id: spotId })
    check(
      notWidened.audience === 'friends' &&
        notWidened.precision === 'area' &&
        notWidened.longitude === 120.52,
      'audience and coordinate precision widening both wait for review'
    )
    await decide(spotId, 'spot', 'proposal_decide')
    const newSpot = await read(stranger, 'spot', { id: spotId })
    check(
      newSpot.name === moved.name &&
        newSpot.longitude === moved.longitude &&
        newSpot.latitude === moved.latitude &&
        newSpot.access_note === moved.access_note,
      'approved spot update installs new fields and authorized exact coordinates together'
    )
    check(
      (await map(newBounds)).items.find((s) => s.id === spotId)?.longitude === moved.longitude &&
        !(await map(oldBounds)).items.some((s) => s.id === spotId),
      'approved spot moves between map viewports atomically'
    )
    await write(
      owner,
      'update_content',
      await edit('spot', spotId, { ...moved, audience: 'public', precision: 'hidden' })
    )
    const hiddenSpot = await read(stranger, 'spot', { id: spotId })
    check(
      hiddenSpot.longitude === null &&
        hiddenSpot.latitude === null &&
        hiddenSpot.access_note === '',
      'hiding coordinates applies before content review completes'
    )
    check(
      !(await map(newBounds)).items.some((s) => s.id === spotId),
      'coordinate hiding removes the map pin before the text change is approved'
    )
    await write(owner, 'withdraw_content', {
      id: spotId,
      type: 'spot',
      revision: 6,
      request_id: randomUUID()
    })
    check(
      (await snapshot('spot', spotId)).item.longitude === moved.longitude &&
        (await snapshot('spot', spotId)).item.audience === 'private',
      'spot withdrawal preserves the latest location for its owner only'
    )
    await rejects(
      () => review('proposal_item', { id: spotId, type: 'spot' }),
      /NOT_FOUND/,
      'private spot update cannot be inspected by a reviewer'
    )
    await resetRates()

    // Nine current plus nine proposed photos are allowed without leaking the second set.
    const manyId = randomUUID(),
      oldNine = [],
      newNine = []
    for (let n = 0; n < 9; n++) {
      oldNine.push(await photo())
      newNine.push(await photo())
    }
    const many = { ...base, id: manyId, audience: 'public', media: oldNine }
    await write(owner, 'save_post', many)
    await decide(manyId)
    await write(owner, 'update_content', await edit('post', manyId, { ...many, media: newNine }))
    check(
      (await canonical(manyId, stranger)).media.length === 9 &&
        (await snapshot('post', manyId)).item.media.length === 9 &&
        (await db.query('select id from public.media_assets where post_id=$1', [manyId])).rows
          .length === 18,
      'current and proposal each allow nine photos without changing the public nine-photo limit'
    )
    const cancel = { id: manyId, type: 'post', revision: 3, request_id: randomUUID() }
    await write(owner, 'discard_content_update', cancel)
    check(
      (await canonical(manyId, stranger)).media.map((m) => m.id).join() ===
        oldNine.map((m) => m.id).join() &&
        (await metadata(owner, newNine[0].id))[0].post_id === null,
      'discard preserves all original photos/order and releases only proposed-only uploads'
    )
    await write(owner, 'update_content', await edit('post', manyId, { ...many, media: newNine }))
    await decide(manyId, 'post', 'proposal_decide')
    check(
      (await canonical(manyId, stranger)).media.map((m) => m.id).join() ===
        newNine.map((m) => m.id).join() && (await storage(stranger, oldNine[0].path)).length === 0,
      'replacement approval detaches omitted current photos and revokes subsequent public reads'
    )
    await write(
      owner,
      'update_content',
      await edit('post', manyId, { ...many, media: [oldNine[0]], body: '第一修改稿' })
    )
    await write(
      owner,
      'update_content',
      await edit('post', manyId, {
        ...many,
        media: [oldNine[1]],
        body: '再次修改稿',
        author_id: stranger,
        status: 'published',
        source_url: 'https://not-an-authoritative-field.invalid/',
        content_update: { status: 'published' }
      })
    )
    const latestFields = (await stored('post', manyId)).fields
    check(
      (await metadata(owner, oldNine[0].id))[0].post_id === null &&
        (await metadata(owner, oldNine[1].id))[0].is_staged,
      'resubmitting replaces only proposed-only bindings, releasing removed draft photos'
    )
    check(
      latestFields.body === '再次修改稿' &&
        !('author_id' in latestFields) &&
        !('status' in latestFields) &&
        !('source_url' in latestFields) &&
        !('content_update' in latestFields),
      'proposal stores whitelisted editable fields, not forged authority or arbitrary metadata'
    )
    const invalidPost = await edit('post', manyId, { ...many, media: [oldNine[1]] })
    for (const fields of [
      { body: 'x'.repeat(2001) },
      { title: 'x'.repeat(61) },
      { species: 'x'.repeat(61) },
      { method: 'x'.repeat(41) },
      { weight: '-1' },
      { weight: 'NaN' },
      { kind: 'fake' },
      { occurred_on: null }
    ])
      await rejects(
        () => write(owner, 'update_content', { ...invalidPost, ...fields }),
        /INVALID_INPUT/,
        'malformed proposed post cannot replace a valid modification'
      )
    check(
      (await snapshot('post', manyId)).revision === invalidPost.revision &&
        (await stored('post', manyId)).fields.body === '再次修改稿',
      'post validation failure keeps both revision and latest valid draft'
    )
    await write(
      owner,
      'update_content',
      await edit('post', manyId, {
        ...many,
        audience: 'private',
        body: '直接改为私人',
        media: [oldNine[1]]
      })
    )
    check(
      (await canonical(manyId)).body === '直接改为私人' &&
        (await canonical(manyId)).media[0].id === oldNine[1].id &&
        (await metadata(owner, oldNine[1].id))[0].is_staged === false &&
        !(await stored('post', manyId)),
      'editing directly to private installs the submitted draft and resets staged media atomically'
    )
    await rejects(
      () => canonical(manyId, friend),
      /NOT_FOUND/,
      'direct private edit revokes access immediately'
    )

    const reportId = randomUUID(),
      reportDraft = { ...base, id: reportId, audience: 'public' }
    await write(owner, 'save_post', reportDraft)
    await decide(reportId)
    await write(
      owner,
      'update_content',
      await edit('post', reportId, { ...reportDraft, body: '举报前待审修改' })
    )
    const report = await as(friend, () =>
      rpc('reports', 'submit', { id: reportId, type: 'post', reason: '隔离测试说明' })
    )
    const reportItem = await as(moderator, () => rpc('reports', 'item', { id: report.id }))
    check(
      !JSON.stringify(reportItem).includes('举报前待审修改'),
      'community report investigation never substitutes a pending proposal for the reported publication'
    )
    await as(moderator, () =>
      rpc('reports', 'decide', {
        id: report.id,
        revision: reportItem.report.revision,
        content_revision: reportItem.content_revision,
        decision: 'hide',
        reason: '请核实后修正',
        request_id: randomUUID()
      })
    )
    check(
      (await stored('post', reportId)).status === 'rejected' &&
        (await currentRow('post', reportId)).status === 'hidden',
      'report moderation also invalidates a pending modification through the common lifecycle'
    )
    const correcting = { ...reportDraft, body: '隐藏后修正重提', media: [oldNine[0]] }
    await write(owner, 'update_content', await edit('post', reportId, correcting))
    check(
      (await snapshot('post', reportId)).item.body === correcting.body &&
        (await currentRow('post', reportId)).status === 'pending' &&
        !(await stored('post', reportId)),
      'editing hidden content uses ordinary pending review and clears the old rejected proposal'
    )
    await rejects(
      () => canonical(reportId, friend),
      /NOT_FOUND/,
      'corrected hidden content is not public until ordinary review approves it'
    )
    await resetRates()

    // Queue pagination mixes first submissions and modifications without duplicate parent rows.
    const queueIds = []
    for (let n = 0; n < 15; n++) {
      const target = randomUUID()
      queueIds.push(target)
      const fields = { ...base, id: target, audience: 'friends', title: `分页${n}` }
      await write(owner, 'save_post', fields)
      if (n % 2 === 0) {
        await decide(target)
        await write(
          owner,
          'update_content',
          await edit('post', target, { ...fields, body: `修改${n}` })
        )
      }
    }
    const mixed = (await queue()).filter((x) => queueIds.includes(x.id))
    check(
      mixed.length === 15 &&
        new Set(mixed.map((x) => `${x.type}:${x.id}`)).size === 15 &&
        mixed.filter((x) => x.is_update).length === 8,
      'keyset review queue includes initial and staged versions exactly once across pages'
    )
    const cascadeTarget = queueIds[0]
    await db.query('delete from public.posts where id=$1', [cascadeTarget])
    check(!(await stored('post', cascadeTarget)), 'hard deletion cascades the private proposal')
  } finally {
    await db.query('delete from auth.users where id=any($1::uuid[])', [users])
    await db.query('delete from fishing_private.rate_events where user_id=any($1::uuid[])', [users])
  }
  check(
    (
      await db.query(
        'select target_id from fishing_private.content_updates where owner_id=any($1::uuid[])',
        [users]
      )
    ).rows.length === 0,
    'account deletion cascades all remaining private modification drafts'
  )
}
