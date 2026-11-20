import { randomUUID } from 'node:crypto'

export async function profileAvatarChecks({ db, as, read, write, check, rejects, base }) {
  const owner = randomUUID(), other = randomUUID()
  for (const id of [owner, other]) await db.query('insert into auth.users(id) values($1)', [id])
  const profile = async (who = owner) => (await read(who, 'profile', { id: owner })).profile
  const photo = async (who = owner, kind = 'image', size = 100) => {
    const id = randomUUID(), path = `${who}/${id}.${kind === 'video' ? 'mp4' : 'jpg'}`
    await db.query('insert into public.media_assets(id,owner_id,path,width,height,kind,size,duration) values($1,$2,$3,512,512,$4,$5,$6)', [id, who, path, kind, size, kind === 'video' ? 5 : null])
    await db.query("insert into storage.objects(bucket_id,name) values('fishing-media',$1)", [path])
    return { id, path }
  }
  const publiclyReadable = async (asset) => (await as(null, () => db.query('select name from storage.objects where name=$1', [asset.path]))).rows.length > 0
  const update = (payload) => write(owner, 'update_profile', payload)
  try {
    check((await profile()).avatar === null, 'profiles without an uploaded avatar retain the default fallback')
    const first = await photo(), second = await photo(), alien = await photo(other), video = await photo(owner, 'video'), legacy = await photo(owner, 'image', 0)
    check(!await publiclyReadable(first), 'an uploaded candidate is private until the author saves it as an avatar')
    const updated = await update({ nickname: '真实头像资料', avatar_id: first.id })
    check(updated.nickname === '真实头像资料' && updated.avatar.id === first.id && updated.avatar.kind === 'image', 'saving profile binds the real uploaded avatar and profile fields in one transaction')
    const publicProfile = await profile(null)
    check(publicProfile.avatar.path === first.path && !publicProfile.avatar.url && publicProfile.avatar.size === 100, 'public profiles expose only validated avatar metadata for separate authorized signing')
    check(await publiclyReadable(first), 'visitors can sign the current public profile avatar through existing Storage RLS')
    await write(other, 'block', { id: owner, enabled: true })
    check((await as(other, () => db.query('select name from storage.objects where name=$1', [first.path]))).rows.length === 0, 'blocked accounts cannot obtain new signed reads for another profile avatar')
    check(await publiclyReadable(first), 'blocking one account does not revoke the public avatar for visitors')
    await write(other, 'block', { id: owner, enabled: false })
    await write(other, 'block', { id: owner, enabled: true })
    check((await as(other,()=>db.query('select name from storage.objects where name=$1',[first.path]))).rows.length===0, 'a block also denies new avatar signatures for the blocked pair')
    check(await publiclyReadable(first), 'blocking one viewer does not hide the public avatar from unrelated visitors')
    await write(other, 'block', { id: owner, enabled: false })
    const postId = randomUUID()
    await write(owner, 'save_post', { ...base, id: postId, audience: 'public' })
    check((await read(null, 'post', { id: postId })).post.author.avatar.id === first.id, 'existing content projections use the current author avatar')
    await update({ city: '苏州市' })
    check((await profile()).avatar.id === first.id, 'older profile clients omitting avatar_id preserve the existing avatar')
    await update({ avatar_id: first.id })
    check((await db.query('select id from public.media_assets where avatar_profile_id=$1', [owner])).rows.length === 1, 'retrying the same avatar remains idempotent and keeps only one current image')
    for (const avatar_id of [alien.id, video.id, legacy.id, randomUUID(), 'bad-id', {}, []]) {
      await rejects(() => update({ nickname: '不应保存', avatar_id }), /AVATAR_UNAVAILABLE/, 'foreign, video, unverified or malformed avatars are rejected')
      check((await profile()).nickname === '真实头像资料' && (await profile()).avatar.id === first.id, 'invalid avatar input preserves existing profile text and avatar atomically')
    }
    await rejects(() => write(other, 'update_profile', { avatar_id: first.id }), /AVATAR_UNAVAILABLE/, 'a public avatar cannot be assigned to another profile')
    await rejects(() => as(owner, () => db.query('select fishing_private.set_profile_avatar($1)', [second.id])), /permission denied/, 'clients cannot bypass the profile RPC ownership and rate limits')
    await rejects(() => as(owner, () => db.query('update public.media_assets set avatar_profile_id=$1 where id=$2', [owner, second.id])), /permission denied/, 'clients cannot directly publish or transfer avatar metadata')
    await rejects(() => write(owner, 'save_post', { ...base, id: randomUUID(), media: [{ id: first.id }] }), /FORBIDDEN|INVALID_INPUT/, 'an avatar cannot simultaneously become a post attachment')
    await rejects(() => write(owner, 'save_water_report', {
      id: randomUUID(), category: 'electric', province: '湖北省', city: '黄石市', district: '阳新县',
      location_label: '独立契约验收水域', longitude: 120.12, latitude: 31.12,
      observed_at: `${base.occurred_on}T10:00:00+08:00`, description: '仅本地数据库验证头像不可被线索挪用',
      media: [{ id: first.id }], consent_version: '2026-11-19-water-v1'
    }), /FORBIDDEN|INVALID_INPUT/, 'private evidence cannot take an image already used as a profile avatar')
    const attached = await photo(), attachedPost = randomUUID()
    await write(owner, 'save_post', { ...base, id: attachedPost, media: [attached] })
    await rejects(() => update({ avatar_id: attached.id }), /AVATAR_UNAVAILABLE/, 'a photo already attached to content cannot become an avatar')
    check(!await publiclyReadable(second), 'a replacement candidate does not become public before save')
    await update({ avatar_id: second.id })
    check((await profile(null)).avatar.id === second.id && !await publiclyReadable(first) && await publiclyReadable(second), 'replacement immediately switches public metadata and revokes new signing for the old avatar')
    check((await db.query('select id from public.media_assets where id=$1', [first.id])).rows.length === 0 && (await db.query('select state from fishing_private.media_deletions where id=$1', [first.id])).rows[0]?.state === 'pending', 'replacement queues committed old-avatar deletion through the existing physical cleanup worker')
    await update({ avatar_id: null })
    check((await profile(null)).avatar === null && !await publiclyReadable(second), 'explicit removal restores default avatars and revokes future old-image signing')
    check((await db.query('select state from fishing_private.media_deletions where id=$1', [second.id])).rows[0]?.state === 'pending', 'explicit removal also queues physical cleanup without deleting the selected original')
    const last = await photo()
    await update({ avatar_id: last.id })
    await db.query('delete from auth.users where id=$1', [owner])
    check((await db.query('select id from public.media_assets where id=$1', [last.id])).rows.length === 0 && (await db.query('select state from fishing_private.media_deletions where id=$1', [last.id])).rows[0]?.state === 'pending', 'account deletion removes the avatar index and retains the durable object-cleanup task')
  } finally {
    for (const id of [owner, other]) await db.query('delete from auth.users where id=$1', [id])
  }
}
