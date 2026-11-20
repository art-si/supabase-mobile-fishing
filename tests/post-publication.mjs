import { randomUUID } from 'node:crypto'

// Final policy checks run after the older migration-era review regression suite.
// This is PostgreSQL/RLS evidence, not a hosted Supabase integration test.
export async function postPublicationChecks({ db, as, rpc, read, write, check, rejects, base, migration }) {
  const owner = randomUUID(), friend = randomUUID(), outsider = randomUUID(), reviewer = randomUUID()
  const users = [owner, friend, outsider, reviewer]
  for (const id of users) await db.query('insert into auth.users(id) values($1)', [id])
  await db.query('insert into fishing_private.moderators values($1)', [reviewer])
  await db.query('insert into public.friendships(user_a,user_b) values(least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid))', [owner, friend])
  const save = (fields = {}) => write(owner, 'save_post', { ...base, id: randomUUID(), audience: 'public', ...fields })
  const snap = (id) => read(owner, 'edit_content', { type: 'post', id })
  const post = async (id, who = owner) => (await read(who, 'post', { id })).post
  const command = async (id, fields = {}) => ({ ...base, id, type: 'post', audience: 'public', revision: (await snap(id)).revision, request_id: randomUUID(), ...fields })
  const photo = async (who = owner, kind = 'image') => {
    const id = randomUUID(), path = `${who}/${id}.${kind === 'video' ? 'mp4' : 'jpg'}`
    await db.query('insert into public.media_assets(id,owner_id,path,width,height,kind,size,duration) values($1,$2,$3,960,540,$4,100,$5)', [id, who, path, kind, kind === 'video' ? 5 : null])
    await db.query("insert into storage.objects(bucket_id,name) values('fishing-media',$1)", [path])
    return { id, path }
  }
  try {
    const pending = await save({ body: '迁移前待发布' })
    const live = await save({ body: '迁移前正文' })
    const oldPhoto = await photo(), newVideo = await photo(owner, 'video')
    await db.query("update public.posts set status='published' where id=$1", [live.id])
    await write(owner, 'update_content', await command(live.id, { body: '迁移前已提交的新正文', media: [newVideo] }))
    const hidden = await save({ body: '保持隐藏' })
    await db.query("update public.posts set status='hidden' where id=$1", [hidden.id])
    const deleted = await save({ body: '保持删除' })
    await write(owner, 'delete_content', { type: 'post', id: deleted.id })
    const priorUid = (await db.query("select current_setting('request.jwt.claim.sub',true) uid")).rows[0].uid
    await db.exec(migration)
    check((await post(pending.id, null)).status === 'published', 'upgrade publishes previously pending fish posts')
    check((await post(live.id, null)).body === '迁移前已提交的新正文' && (await post(live.id, null)).media[0].kind === 'video', 'upgrade installs already submitted live-post replacements and promotes their ordered media')
    check((await post(live.id)).content_update === null, 'upgrade consumes the old post approval proposal')
    check((await db.query("select current_setting('request.jwt.claim.sub',true) uid")).rows[0].uid === priorUid, 'upgrade restores its transaction-local identity')
    check((await post(hidden.id)).status === 'hidden', 'upgrade keeps previously hidden posts hidden')
    await rejects(() => read(null, 'post', { id: hidden.id }), /NOT_FOUND/, 'hidden posts remain unavailable to visitors after upgrade')
    await rejects(() => snap(deleted.id), /NOT_FOUND/, 'upgrade never restores deleted posts')

    const freshVideo = await photo(owner, 'video')
    const fresh = await save({ media: [oldPhoto, freshVideo], body: '新发布', status: 'pending' })
    check((await post(fresh.id, null)).status === 'published', 'public fish posts publish immediately through the authenticated RPC')
    check((await post(fresh.id, null)).media.map((m) => m.kind).join(',') === 'image,video', 'immediate publication retains the author-selected mixed media order')
    await db.query("update public.profiles set city='苏州' where id=$1", [owner])
    check((await read(null, 'feed', { filter: 'city', city: '苏州市' })).items.some(p => p.id === fresh.id), 'canonical city picker names match legacy resident cities without trailing 市')
    await db.query("update public.profiles set city='苏州市' where id=$1", [owner])
    check((await read(null, 'feed', { filter: 'city', city: '苏州' })).items.some(p => p.id === fresh.id), 'legacy city filters match canonical saved profile cities')
    check(!(await read(null, 'feed', { filter: 'city', city: '杭州市' })).items.some(p => p.id === fresh.id), 'normalizing city suffixes never broadens matching to another city')
    await write(friend, 'reaction', { id: fresh.id, kind: 'like', enabled: true })
    await write(friend, 'comment', { id: randomUUID(), post_id: fresh.id, body: '保留原帖评论' })
    const originalCreatedAt = (await post(fresh.id)).created_at
    const edit = await command(fresh.id, { body: '编辑后直接发布', media: [freshVideo, oldPhoto] })
    const updated = await write(owner, 'update_content', edit)
    const visible = await post(fresh.id, null)
    check(visible.body === edit.body && visible.status === 'published' && visible.content_update === null, 'editing a live post immediately replaces its content without an approval state')
    check(visible.id === fresh.id && visible.like_count === 1 && visible.comment_count === 1 && visible.created_at === originalCreatedAt && visible.media[0].kind === 'video', 'republishing edits the existing post while retaining reactions, comments, creation time and new media order')
    const retried = await write(owner, 'update_content', edit)
    check(retried.revision === updated.revision && (await snap(fresh.id)).revision === updated.revision, 'retrying the same edit does not republish or increment twice')
    await rejects(() => write(owner, 'update_content', { ...edit, body: '重用标识改内容' }), /EDIT_REQUEST_REUSED/, 'edited requests cannot reuse a receipt with different content')
    await rejects(() => write(owner, 'update_content', { ...edit, request_id: randomUUID() }), /EDIT_CONFLICT/, 'a stale editor cannot overwrite a newer immediate publication')
    await rejects(() => write(outsider, 'update_content', { ...edit, request_id: randomUUID() }), /NOT_FOUND/, 'direct publication still enforces author ownership')
    const foreign = await photo(outsider), before = await snap(fresh.id)
    await rejects(async () => write(owner, 'update_content', { ...await command(fresh.id), media: [foreign] }), /FORBIDDEN/, 'immediate editing cannot steal another author media')
    check((await snap(fresh.id)).revision === before.revision && (await post(fresh.id)).body === edit.body, 'an invalid media edit atomically preserves the previous content and revision')
    await rejects(async () => write(owner, 'update_content', { ...await command(fresh.id), location_label: '' }), /POST_LOCATION_REQUIRED|INVALID_INPUT/, 'immediate editing keeps required location validation')
    await write(owner, 'update_content', await command(fresh.id, { body: '好友范围', audience: 'friends', media: [freshVideo] }))
    check((await post(fresh.id, friend)).body === '好友范围', 'friend-only editing is visible immediately to an accepted friend')
    await rejects(() => read(outsider, 'post', { id: fresh.id }), /NOT_FOUND/, 'friend-only editing immediately revokes stranger access')
    await write(owner, 'update_content', await command(fresh.id, { body: '仅自己可见', audience: 'private', media: [freshVideo] }))
    await rejects(() => read(friend, 'post', { id: fresh.id }), /NOT_FOUND/, 'private editing immediately revokes friend access')
    check((await as(friend, () => db.query('select id from public.media_assets where id=$1', [freshVideo.id]))).rows.length === 0, 'private editing also revokes new media metadata access')
    check((await as(friend, () => db.query('select name from storage.objects where name=$1', [freshVideo.path]))).rows.length === 0, 'private editing also revokes new storage access')
    await write(owner, 'update_content', await command(fresh.id, { body: '再次公开发布', media: [freshVideo] }))
    check((await post(fresh.id, null)).body === '再次公开发布', 'the author can edit and republish a private post immediately')
    await write(owner, 'update_content', await command(hidden.id, { body: '已修正后再发布' }))
    check((await post(hidden.id, null)).status === 'published', 'an author can correct and republish their own hidden post')
    await write(owner, 'delete_content', { type: 'post', id: fresh.id })
    await rejects(() => write(owner, 'update_content', { ...edit, revision: updated.revision, request_id: randomUUID() }), /NOT_FOUND/, 'direct editing cannot resurrect a deleted post')
    await rejects(() => as(owner, () => db.query("update public.posts set audience='public' where id=$1", [fresh.id])), /permission denied/, 'clients still cannot bypass the validated publication RPC')
    const spot = { id: randomUUID(), name: '钓点审核仍保持', city: '测试城市', water_type: '自然水域', species: '', description: '本机契约测试', fee_note: '', access_note: '', observed_on: base.occurred_on, audience: 'public', precision: 'hidden', media: [] }
    const createdSpot = await write(owner, 'save_spot', spot)
    check(createdSpot.status === 'pending', 'removing fish-post approval leaves the separate spot workflow unchanged')
    check((await db.query("select count(*)::int n from public.fishing_official_zones where published and (water_source_url='' or water_attribution='')")).rows[0].n === 0, 'unverified official water geometries remain unpublished')
  } finally {
    for (const id of users) await db.query('delete from auth.users where id=$1', [id])
  }
}
