import { randomUUID } from 'node:crypto'

export async function moderationChecks({
  db,
  as,
  rpc,
  read,
  write,
  check,
  rejects,
  alice,
  bob,
  eve,
  base
}) {
  const review = (user, action, payload = {}) => as(user, () => rpc('moderation', action, payload))
  const id = randomUUID(),
    own = randomUUID(),
    spot = randomUUID()
  await write(alice, 'save_post', { ...base, id, audience: 'public' })
  await write(eve, 'save_post', { ...base, id: own, audience: 'public' })
  const draft = {
    id: spot,
    name: '审核用钓位',
    city: '苏州',
    water_type: '水库',
    species: '鲫鱼',
    description: '禁止野泳，请核实开放时间',
    fee_note: '未核实',
    observed_on: '2026-11-19',
    audience: 'public',
    precision: 'hidden',
    latitude: 31.287654,
    longitude: 120.523456,
    access_note: '私密入口不能进入审核数据'
  }
  await write(alice, 'save_spot', draft)
  await rejects(
    () => review(null, 'access'),
    /permission denied/,
    'anonymous cannot invoke moderation RPC'
  )
  check(
    !(await review(alice, 'access')).allowed && (await review(eve, 'access')).allowed,
    'moderator capability comes from private membership, not user input'
  )
  await rejects(
    () => review(alice, 'queue'),
    /FORBIDDEN/,
    'ordinary member cannot enumerate the review queue'
  )
  await rejects(
    () => review(bob, 'own_status', { type: 'post', id }),
    /NOT_FOUND/,
    'review reason is owner-only'
  )
  await rejects(
    () => as(alice, () => db.query('select fishing_private.review_item($1,$2)', ['post', id])),
    /permission denied/,
    'internal detail helper is not callable by app users'
  )
  const queue = await review(eve, 'queue')
  check(
    queue.items.some((i) => i.id === id) &&
      queue.items.some((i) => i.id === spot) &&
      queue.items.every((i) => i.audience !== 'private'),
    'pending shared posts and spots enter the same queue, private content does not'
  )
  const detail = await review(eve, 'item', { type: 'spot', id: spot })
  check(
    !JSON.stringify(detail).includes('120.523456') &&
      !JSON.stringify(detail).includes('私密入口') &&
      !('longitude' in detail),
    'review detail never exposes exact coordinates or private access notes'
  )
  const privatePost = await write(alice, 'save_post', { ...base, id: randomUUID() })
  await rejects(
    () => review(eve, 'item', { type: 'post', id: privatePost.id }),
    /NOT_FOUND/,
    'moderator cannot read a private post'
  )
  const file = `${alice}/review-${id}.jpg`
  await db.query(
    'insert into public.media_assets(owner_id,path,width,height,post_id) values($1,$2,100,100,$3)',
    [alice, file, id]
  )
  await db.query("insert into storage.objects(bucket_id,name) values('fishing-media',$1)", [file])
  const media = (user) =>
    as(user, () => db.query('select name from storage.objects where name=$1', [file]))
  check(
    (await media(eve)).rows.length === 1 && (await media(bob)).rows.length === 0,
    'reviewer can read pending attached photos; unrelated user cannot'
  )
  check(
    (
      await as(eve, () =>
        db.query('select name from storage.objects where name=$1', [`${alice}/trip.jpg`])
      )
    ).rows.length === 0,
    'review authority does not unlock private trip photos'
  )
  const decision = {
    id,
    type: 'post',
    revision: 1,
    decision: 'published',
    reason: '内容符合社区规范',
    request_id: randomUUID()
  }
  await rejects(
    () => review(eve, 'decide', { ...decision, id: own }),
    /SELF_REVIEW/,
    'reviewer cannot approve their own submission'
  )
  await rejects(
    () => review(eve, 'decide', { ...decision, reason: ' ' }),
    /INVALID_INPUT/,
    'blank review reason is rejected'
  )
  await rejects(
    () => review(eve, 'decide', { ...decision, revision: null }),
    /INVALID_INPUT/,
    'review decision must identify the inspected revision'
  )
  await review(eve, 'decide', decision)
  await review(eve, 'decide', decision)
  check(
    (
      await db.query(
        'select count(*)::int n from fishing_private.moderation_actions where request_id=$1',
        [decision.request_id]
      )
    ).rows[0].n === 1,
    'retry of the same decision is idempotent and creates one audit record'
  )
  await rejects(
    () => review(eve, 'decide', { ...decision, decision: 'hidden' }),
    /REVIEW_CONFLICT/,
    'request id cannot be reused for a different decision'
  )
  check(
    (await read(null, 'post', { id })).post.status === 'published',
    'approved shared content becomes publicly readable'
  )
  await review(eve, 'decide', {
    ...decision,
    decision: 'hidden',
    revision: 2,
    reason: '开放信息需进一步核实',
    request_id: randomUUID()
  })
  await rejects(
    () => read(null, 'post', { id }),
    /NOT_FOUND/,
    'hiding published content immediately revokes public detail access'
  )
  const status = await review(alice, 'own_status', { type: 'post', id })
  check(
    status.status === 'hidden' && status.reason === '开放信息需进一步核实',
    'author sees the current moderation outcome and reason'
  )
  await rejects(
    () => review(eve, 'decide', { ...decision, revision: 2, request_id: randomUUID() }),
    /REVIEW_CONFLICT/,
    'another moderator cannot overwrite a newer decision from an old screen'
  )
  const spotDecision = { ...decision, id: spot, type: 'spot', request_id: randomUUID() }
  await write(alice, 'update_content', {
    ...draft,
    type: 'spot',
    revision: 1,
    request_id: randomUUID(),
    description: '作者刚修改的正文'
  })
  await rejects(
    () => write(eve, 'moderate', spotDecision),
    /REVIEW_CONFLICT/,
    'legacy write RPC also refuses approving a pre-edit revision'
  )
  await review(eve, 'decide', {
    ...spotDecision,
    revision: 2,
    decision: 'rejected',
    reason: '请补充开放时间'
  })
  check(
    (await review(alice, 'own_status', { type: 'spot', id: spot })).reason === '请补充开放时间',
    'spot rejection reason is available to its author'
  )
  await write(alice, 'update_content', {
    ...draft,
    type: 'spot',
    revision: 3,
    request_id: randomUUID(),
    description: '重新提交并补充开放说明'
  })
  check(
    (await review(alice, 'own_status', { type: 'spot', id: spot })).reason === '',
    'resubmission clears the previous rejection notice while awaiting review'
  )
  await write(alice, 'withdraw_content', {
    id: spot,
    type: 'spot',
    revision: 4,
    request_id: randomUUID()
  })
  await rejects(
    () => review(eve, 'item', { type: 'spot', id: spot }),
    /NOT_FOUND/,
    'withdrawing sharing also withdraws review access'
  )
  await write(alice, 'delete_content', { type: 'post', id })
  await rejects(
    () => review(eve, 'decide', { ...decision, revision: 4, request_id: randomUUID() }),
    /NOT_FOUND/,
    'reviewer cannot resurrect deleted content'
  )
  check(
    (await media(eve)).rows.length === 0,
    'deleted shared content revokes new review photo access'
  )
  for (let i = 0; i < 13; i++)
    await write(alice, 'save_post', { ...base, id: randomUUID(), audience: 'public' })
  const first = await review(eve, 'queue'),
    second = await review(eve, 'queue', { cursor: first.next })
  check(
    first.items.length === 12 &&
      Boolean(first.next) &&
      second.items.length > 0 &&
      !first.items.some((a) => second.items.some((b) => a.id === b.id && a.type === b.type)),
    'review queue pagination is bounded and has no overlap'
  )
  await db.query('delete from fishing_private.moderators where user_id=$1', [eve])
  await rejects(
    () => review(eve, 'queue'),
    /FORBIDDEN/,
    'revoked moderator is denied without waiting for token refresh'
  )
}
