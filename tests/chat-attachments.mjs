import { randomUUID } from 'node:crypto'

export async function chatAttachmentChecks({
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
  // Local PostgreSQL fixtures only. Never insert these people, messages or objects in hosted data.
  await db.exec('delete from fishing_private.rate_events; delete from public.blocks')
  await db.query(
    'insert into public.friendships(user_a,user_b) values($1,$2) on conflict do nothing',
    [alice, bob]
  )
  const conversation = await write(alice, 'conversation', { id: bob })
  const send = (u, extra = {}) =>
    write(u, 'send_message', { conversation_id: conversation, client_id: randomUUID(), ...extra })
  async function asset(owner = alice, parent = {}) {
    const id = randomUUID(),
      path = `${owner}/${id}.jpg`
    await db.query(
      'insert into public.media_assets(id,owner_id,path,width,height,post_id,trip_id,report_id) values($1,$2,$3,800,600,$4,$5,$6)',
      [id, owner, path, parent.post || null, parent.trip || null, parent.report || null]
    )
    await db.query("insert into storage.objects(bucket_id,name) values('fishing-media',$1)", [path])
    return { id, path }
  }
  const image = await asset(),
    input = { kind: 'image', media_id: image.id, client_id: randomUUID() }
  const sent = await send(alice, input),
    retry = await send(alice, input)
  check(
    sent.id === retry.id && sent.sequence === retry.sequence && sent.media[0].id === image.id,
    'photo retry keeps one message and attachment'
  )
  const history = await read(bob, 'message_content', { id: conversation, ids: [sent.id] })
  check(
    history[0].media[0].path === image.path,
    'recipient reads current authorized photo metadata'
  )
  check(
    (await as(bob, () => db.query('select name from storage.objects where name=$1', [image.path])))
      .rows.length === 1,
    'private bucket authorizes conversation recipient'
  )
  check(
    (await as(eve, () => db.query('select name from storage.objects where name=$1', [image.path])))
      .rows.length === 0,
    'nonmember cannot sign or read chat image'
  )
  check(
    (await as(null, () => db.query('select name from storage.objects where name=$1', [image.path])))
      .rows.length === 0,
    'anonymous visitor cannot read chat image'
  )
  await db.query(
    'insert into fishing_private.moderators(user_id) values($1) on conflict do nothing',
    [eve]
  )
  check(
    (await as(eve, () => db.query('select id from public.media_assets where id=$1', [image.id])))
      .rows.length === 0,
    'moderator status does not expose private chat photos'
  )
  await rejects(
    () => read(eve, 'message_content', { id: conversation, ids: [sent.id] }),
    /FORBIDDEN/,
    'nonmember cannot refresh message previews'
  )
  await rejects(
    () => read(null, 'message_content', { id: conversation, ids: [sent.id] }),
    /NOT_AUTHENTICATED/,
    'anonymous preview refresh is denied'
  )
  await rejects(
    () => read(bob, 'message_content', { id: conversation, ids: Array(101).fill(sent.id) }),
    /INVALID_INPUT/,
    'preview refresh is bounded to 100 ids'
  )
  await rejects(
    () => send(alice, { kind: 'image', media_id: image.id }),
    /PHOTO_NOT_AVAILABLE/,
    'attached image cannot be reused in a different message'
  )
  const strangerPhoto = await asset(eve)
  await rejects(
    () => send(alice, { kind: 'image', media_id: strangerPhoto.id }),
    /PHOTO_NOT_AVAILABLE/,
    'cannot send another owner upload'
  )
  const trip = randomUUID()
  await write(alice, 'save_trip', { ...base, id: trip })
  const tripPhoto = await asset(alice, { trip })
  await rejects(
    () => send(alice, { kind: 'image', media_id: tripPhoto.id }),
    /PHOTO_NOT_AVAILABLE/,
    'private trip photo cannot be reassigned to chat'
  )
  await rejects(
    () => write(alice, 'save_post', { ...base, id: randomUUID(), media: [image] }),
    /FORBIDDEN/,
    'chat photo cannot be reassigned to a public post'
  )
  await rejects(
    () => send(alice, { kind: 'image' }),
    /INVALID_INPUT/,
    'photo message requires an uploaded asset'
  )
  await rejects(
    () => send(alice, { kind: 'text', body: 'hello', media_id: image.id }),
    /INVALID_INPUT/,
    'text cannot smuggle photo metadata'
  )
  await rejects(
    () => send(alice, { kind: 'video', body: 'unsupported' }),
    /INVALID_INPUT/,
    'unsupported message type is rejected'
  )

  const post = randomUUID()
  await write(alice, 'save_post', { ...base, id: post, title: '分享测试鱼情', audience: 'friends' })
  await rejects(
    () => send(alice, { kind: 'post', reference_id: post }),
    /CHAT_CONTENT_UNAVAILABLE/,
    'pending post cannot be shared even by author'
  )
  await db.query("update public.posts set status='published' where id=$1", [post])
  const sharedInput = {
    kind: 'post',
    reference_id: post,
    client_id: randomUUID(),
    body: 'forged snapshot'
  }
  const card = await send(alice, sharedInput)
  check(
    card.body === '[鱼情]' && card.card.title === '分享测试鱼情' && !('media' in card),
    'message card uses server fields and never stores a supplied snapshot'
  )
  const raw = (
    await as(bob, () => db.query('select * from public.messages where id=$1', [card.id]))
  ).rows[0]
  check(
    !JSON.stringify(raw).includes('分享测试鱼情') &&
      !JSON.stringify(raw).includes('forged snapshot'),
    'raw message table holds references, not content copies'
  )
  await db.query("update public.posts set title='更新后的鱼情' where id=$1", [post])
  check(
    (await read(bob, 'message_content', { id: conversation, ids: [card.id] }))[0].card.title ===
      '更新后的鱼情',
    'existing card refreshes after author edit'
  )
  await db.query("update public.posts set audience='private' where id=$1", [post])
  check(
    (await read(bob, 'message_content', { id: conversation, ids: [card.id] }))[0].card === null,
    'privacy tightening removes cached title on next projection'
  )
  check(
    (await send(alice, sharedInput)).card === null,
    'idempotent receipt also sanitizes later private content'
  )
  await rejects(
    () => send(alice, { kind: 'post', reference_id: post }),
    /CHAT_CONTENT_UNAVAILABLE/,
    'even owner cannot forward private post'
  )
  await db.query("update public.posts set audience='public',status='hidden' where id=$1", [post])
  check(
    (await read(alice, 'message_content', { id: conversation, ids: [card.id] }))[0].card === null,
    'moderation hidden content disappears from owner chat card too'
  )
  await db.query('delete from public.posts where id=$1', [post])
  check(
    (await read(bob, 'message_content', { id: conversation, ids: [card.id] }))[0].card === null,
    'hard-deleted reference leaves neutral message placeholder'
  )

  const spot = randomUUID()
  await write(alice, 'save_spot', {
    id: spot,
    name: '私密入口旁水域',
    city: '苏州',
    water_type: '自然水域',
    species: '',
    description: '测试',
    fee_note: '',
    observed_on: '2026-11-19',
    audience: 'public',
    precision: 'area',
    longitude: 120.51234,
    latitude: 31.25678,
    access_note: '隐藏到达说明'
  })
  await db.query("update public.fishing_spots set status='published' where id=$1", [spot])
  const spotMessage = await send(alice, { kind: 'spot', reference_id: spot })
  check(
    spotMessage.card.detail.includes('大致水域') &&
      !JSON.stringify(spotMessage).includes('120.51234') &&
      !JSON.stringify(spotMessage).includes('隐藏到达说明'),
    'area spot card has no coordinates or arrival note, even for owner'
  )
  await db.query("update public.fishing_spots set precision='hidden' where id=$1", [spot])
  check(
    (
      await read(bob, 'message_content', { id: conversation, ids: [spotMessage.id] })
    )[0].card.detail.includes('位置未分享'),
    'spot card reflects tightened location precision'
  )
  const thirdPost = randomUUID()
  await write(eve, 'save_post', { ...base, id: thirdPost, audience: 'friends' })
  await db.query("update public.posts set status='published' where id=$1", [thirdPost])
  await db.query('insert into public.friendships(user_a,user_b) values($1,$2)', [alice, eve])
  await rejects(
    () => send(alice, { kind: 'post', reference_id: thirdPost }),
    /CHAT_CONTENT_UNAVAILABLE/,
    'sender access cannot grant recipient access to third-party friends content'
  )
  const elsewhere = await write(alice, 'conversation', { id: eve })
  check(
    (await read(alice, 'message_content', { id: elsewhere, ids: [sent.id] })).length === 0,
    'message refresh cannot cross conversation scope'
  )
  await rejects(
    () => write(alice, 'send_message', { ...input, conversation_id: elsewhere }),
    /INVALID_INPUT/,
    'retry key cannot be reused across conversations'
  )
  await write(bob, 'block', { id: alice, enabled: true })
  check(
    (await send(alice, input)).id === sent.id,
    'already-saved image receipt remains recoverable after block'
  )
  await rejects(
    () => send(alice, { body: 'new message' }),
    /NOT_FRIENDS/,
    'block stops all new text and media sends'
  )
  check(
    (await read(bob, 'message_content', { id: conversation, ids: [spotMessage.id] }))[0].card ===
      null,
    'block removes content reference preview despite retained message history'
  )
  check(
    (await as(bob, () => db.query('select name from storage.objects where name=$1', [image.path])))
      .rows.length === 1,
    'previously shared image remains part of retained conversation history'
  )
  await rejects(
    () =>
      as(bob, () => db.query('select fishing_private.chat_card($1,$2,$3)', ['spot', spot, alice])),
    /permission denied/,
    'client cannot invoke internal card projection with forged viewer'
  )
  await db.query('delete from fishing_private.moderators where user_id=$1', [eve])
  await db.exec('delete from fishing_private.rate_events')
}
