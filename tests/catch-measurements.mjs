import { randomUUID } from 'node:crypto'

export async function catchMeasurementChecks({ db, as, rpc, read, write, check, rejects, base }) {
  const owner = randomUUID(),
    stranger = randomUUID(),
    moderator = randomUUID()
  const users = [owner, stranger, moderator]
  for (const user of users) await db.query('insert into auth.users(id) values($1)', [user])
  await db.query('insert into fishing_private.moderators(user_id) values($1)', [moderator])
  const id = randomUUID()
  const input = {
    ...base,
    id,
    body: '独立鱼情计量验收',
    count: '0',
    weight: '0.0005',
    length: '38.5'
  }
  const current = async (user = owner) => (await read(user, 'post', { id })).post
  const snapshot = async () => read(owner, 'edit_content', { type: 'post', id })
  const edit = async (fields) =>
    write(owner, 'update_content', {
      ...input,
      ...fields,
      id,
      type: 'post',
      revision: (await snapshot()).revision,
      request_id: randomUUID()
    })
  const review = (action, payload) => as(moderator, () => rpc('moderation', action, payload))
  const decide = async (action) =>
    review(action, {
      id,
      type: 'post',
      revision: (await snapshot()).revision,
      request_id: randomUUID(),
      decision: 'published',
      reason: '本机数据库鱼情计量验收'
    })
  try {
    await write(owner, 'save_post', input)
    let post = await current()
    check(
      post.count === 0 && post.length_cm === 38.5 && post.weight_kg === 0.0005,
      'optional post facts preserve zero, cm and sub-gram kg without rounding'
    )
    await rejects(
      () => read(stranger, 'edit_content', { type: 'post', id }),
      /NOT_FOUND|FORBIDDEN/,
      'private catch facts retain owner-only access'
    )
    const legacy = {
      ...input,
      type: 'post',
      revision: (await snapshot()).revision,
      request_id: randomUUID()
    }
    delete legacy.count
    delete legacy.length
    await write(owner, 'update_content', legacy)
    post = await current()
    check(
      post.count === 0 && post.length_cm === 38.5,
      'legacy edit omission preserves new catch facts'
    )
    for (const fields of [
      { count: '1.5' },
      { count: '-1' },
      { count: '-1e-1' },
      { count: '4.0' },
      { count: '1e2' },
      { length: '10001' },
      { length: {} },
      { weight: 'NaN' },
      { weight: '-0.00001' }
    ]) {
      await rejects(
        () => edit(fields),
        /INVALID_INPUT/,
        'invalid catch measurements are rejected before storage'
      )
    }
    await edit({ count: '4', length: '42.25', audience: 'public' })
    const firstReview = await review('item', { type: 'post', id })
    check(
      firstReview.details['尾数'] === '4' && firstReview.details['鱼长（cm）'] === '42.25',
      'initial moderator view contains the actual catch facts'
    )
    await decide('decide')
    await edit({ count: '5', length: '43', weight: '0.0015', audience: 'public' })
    post = await current(null)
    const proposed = await snapshot()
    check(
      post.count === 4 &&
        post.length_cm === 42.25 &&
        proposed.item.count === 5 &&
        proposed.item.length_cm === 43,
      'pending catch edits remain separate from the published facts'
    )
    const pendingReview = await review('proposal_item', { type: 'post', id })
    check(
      pendingReview.details['尾数'] === '5' && pendingReview.current.details['尾数'] === '4',
      'moderator compares proposed measurements with the existing version'
    )
    await decide('proposal_decide')
    post = await current(null)
    check(
      post.count === 5 && post.length_cm === 43 && post.weight_kg === 0.0015,
      'approval installs the full catch measurement set'
    )
    await edit({ count: '', length: '', weight: '', audience: 'public' })
    await decide('proposal_decide')
    post = await current(null)
    check(
      post.count === null && post.length_cm === null && post.weight_kg === null,
      'explicit clearing stays unknown through proposal approval'
    )
    const trip = await write(owner, 'save_trip', {
      ...base,
      id: randomUUID(),
      catch_records: [
        { species: '鲫鱼', count: 0, weight_kg: 0.0005 },
        { species: '鲤鱼', count: 1, weight_kg: 0.001 }
      ]
    })
    const log = await read(owner, 'edit_content', { type: 'trip', id: trip.id })
    check(
      log.item.weight_kg === 0.0015 && log.item.count === 1,
      'journal summary and its detailed catches keep the same decimal quantity'
    )
    await rejects(
      () => as(owner, () => db.query("select fishing_private.post_catch_fields('{}')")),
      /permission denied/,
      'measurement validator is not an exposed client function'
    )
  } finally {
    await db.query('delete from auth.users where id=any($1::uuid[])', [users])
  }
}
