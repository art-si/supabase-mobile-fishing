import { randomUUID } from 'node:crypto'

export async function spotDiscussionMediaChecks({ db, as, rpc, write, base, check, rejects, target, other }) {
  const author = randomUUID(), respondent = randomUUID(), reader = randomUUID()
  await db.query('insert into auth.users(id) values($1),($2),($3)', [author, respondent, reader])
  const call = (who, action, payload) => as(who, () => rpc('spot_community', action, { target, ...payload }))
  const image = async (owner, kind = 'image') => {
    const id = randomUUID(), path = owner + '/' + id + (kind === 'image' ? '.jpg' : '.mp4')
    await db.query('insert into public.media_assets(id,owner_id,path,width,height,kind,size,duration) values($1,$2,$3,320,180,$4,100,$5)',
      [id, owner, path, kind, kind === 'video' ? 5 : null])
    await db.query("insert into storage.objects(bucket_id,name) values('fishing-media',$1)", [path])
    return { id, path }
  }
  const canRead = async (who, asset) => (await as(who, () => db.query('select name from storage.objects where name=$1', [asset.path]))).rows.length > 0
  const page = async who => (await call(who, 'comments', { cursor: null })).items
  const root = randomUUID(), id = randomUUID()
  const first = await image(author), second = await image(author), mine = await image(respondent), video = await image(respondent, 'video')
  const pictureOnly = { id: root, body: '', media: [{ id: second.id }, { id: first.id }] }
  const reply = { id, reply_to_id: root, body: '几点去的？', media: [{ id: mine.id }] }
  await call(author, 'comment', pictureOnly)
  await call(respondent, 'comment', reply)
  const rows = await page(reader), quoted = rows.find(row => row.id === id)
  check(quoted.reply_to?.id === root && quoted.reply_to.body === '[图片]' && quoted.media[0].id === mine.id &&
    rows.find(row => row.id === root).media.map(m => m.id).join() === [second.id, first.id].join(),
    'spot photo-only comments and photo replies retain attachment order and quote the right parent')
  check((await call(respondent, 'comment', reply)).id === id && (await page(reader)).length === 2,
    'resending the same reply is idempotent')
  await rejects(() => call(respondent, 'comment', { ...reply, reply_to_id: null }), /COMMENT_REQUEST_REUSED/, 'retry cannot switch a reply to a new comment')
  await rejects(() => call(author, 'comment', { ...pictureOnly, media: [...pictureOnly.media].reverse() }), /COMMENT_REQUEST_REUSED/, 'retry cannot reorder pictures')
  await rejects(() => call(reader, 'comment', { id: randomUUID(), body: '回复', target: other, reply_to_id: root }), /COMMENT_REPLY_UNAVAILABLE/, 'cross-spot reply is rejected')
  await rejects(() => call(reader, 'comment', { id: randomUUID(), body: '', media: [{ id: mine.id }] }), /FORBIDDEN/, 'another user cannot attach someone else’s image')
  await rejects(() => call(respondent, 'comment', { id: randomUUID(), body: '', media: [{ id: video.id }] }), /FORBIDDEN/, 'spot comments only accept image uploads')
  await rejects(() => call(reader, 'comment', { id: randomUUID(), body: ' ' }), /INVALID_INPUT/, 'empty comment without an attachment is rejected')
  await rejects(() => call(reader, 'comment', { id: randomUUID(), body: '', media: Array.from({ length: 7 }, () => ({ id: randomUUID() })) }), /INVALID_INPUT/, 'six-image limit is enforced server-side')
  check(await canRead(reader, first) && await canRead(null, first), 'readers of the public discussion can access its photos')
  await db.query('insert into public.blocks(blocker_id,blocked_id) values($1,$2)', [reader, author])
  const blocked = await page(reader)
  check(blocked.length === 1 && blocked[0].reply_to === null && !await canRead(reader, first),
    'blocking hides the author, quoted content and new storage reads')
  await rejects(() => call(reader, 'comment', { id: randomUUID(), body: '回复', reply_to_id: root }), /COMMENT_REPLY_UNAVAILABLE/, 'cannot reply to a blocked author')
  await db.query("update public.fishing_spots set audience='private' where id=$1", [target.slice(5)])
  check(!await canRead(author, first) && !await canRead(respondent, mine), 'hidden spot revokes even its discussion uploaders’ photo access')
  await db.query("update public.fishing_spots set audience='public' where id=$1", [target.slice(5)])
  await call(author, 'delete_comment', { id: root })
  check((await call(respondent, 'comment', reply)).id === id && (await page(respondent))[0].reply_to === null &&
    !await canRead(author, first) && await canRead(respondent, mine), 'deleting a parent removes its images and preserves the reply and retry identity')
  await call(respondent, 'comment', { id: root, body: '另一条评论' })
  check((await page(respondent)).find(row => row.id === id).reply_to === null, 'reusing a deleted UUID never resurrects a quote')
  const likers = (who, key, cursor = null) => as(who, () => rpc('read','discussion_likes',{target:key,cursor}))
  await call(author,'react',{kind:'like',enabled:true})
  await call(respondent,'react',{kind:'like',enabled:true})
  const visible = await likers(reader,target)
  check(visible.items.length === 1 && visible.items[0].id === respondent &&
    Object.keys(visible.items[0]).sort().join() === 'avatar,id,nickname', 'spot likes expose only visible actors and public-facing identity fields')
  const extra = Array.from({length:19}, () => randomUUID())
  await db.query('insert into auth.users(id) select unnest($1::uuid[])',[extra])
  await db.query("insert into fishing_private.spot_reactions(target,kind,user_id) select $1,'like',unnest($2::uuid[])",[target,extra])
  const firstPage=await likers(reader,target), lastPage=await likers(reader,target,firstPage.next)
  check(firstPage.items.length===18 && lastPage.items.length===2 && !lastPage.next &&
    new Set([...firstPage.items,...lastPage.items].map(person=>person.id)).size===20, 'like avatar pages are stable and complete across the 18-avatar boundary')
  const post = randomUUID()
  await write(author,'save_post',{...base,id:post,audience:'public'})
  await write(respondent,'reaction',{id:post,kind:'like',enabled:true})
  check((await likers(author,'post:'+post)).items[0].id===respondent, 'post likes use the same visible profile projection')
  const inbox=await as(author,()=>rpc('notifications','page',{category:'interaction'}))
  check(inbox.items.some(item=>item.kind==='like' && item.actor?.id===respondent), 'interaction notification includes its visible actor')
  await db.query("update public.posts set audience='private' where id=$1",[post])
  await rejects(()=>likers(respondent,'post:'+post),/NOT_FOUND/,'likers of a private post are unavailable to outsiders')
  await db.query("update public.fishing_spots set audience='private' where id=$1",[target.slice(5)])
  await rejects(()=>likers(null,target),/NOT_FOUND/,'private spot cannot expose its likes to guests')
  await db.query("update public.fishing_spots set audience='public' where id=$1",[target.slice(5)])
}
