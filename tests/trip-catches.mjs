import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'

export async function tripCatchChecks({
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
  await db.exec('delete from fishing_private.rate_events')
  const id = randomUUID()
  const records = [
    { species: ' 鲫鱼 ', count: 3, weight_kg: 0.3 },
    { species: '鲤鱼', count: 1, weight_kg: null }
  ]
  const normalized = [{ ...records[0], species: '鲫鱼' }, records[1]]
  const draft = {
    ...base,
    id,
    catch_records: records,
    weight: '99999',
    count: '99999',
    species: '伪造汇总',
    audience: 'public'
  }
  const snapshot = () => read(alice, 'edit_content', { type: 'trip', id })
  await write(alice, 'save_trip', draft)
  const initial = await snapshot()
  assert.deepEqual(initial.item.catch_records, normalized)
  check(
    initial.item.count === 4 &&
      initial.item.weight_kg === null &&
      initial.item.species === '多条渔获',
    'multi-catch summary comes from server detail, never client totals'
  )
  check(!('audience' in initial.item), 'trip catch details have no shareable audience')
  for (const user of [null, bob, eve]) {
    await rejects(
      () => read(user, 'edit_content', { type: 'trip', id }),
      /AUTH_REQUIRED|NOT_FOUND/,
      'visitor, other author and moderator cannot read private catches'
    )
    if (user)
      check(
        (await as(user, () => db.query('select catch_records from public.trips where id=$1', [id])))
          .rows.length === 0,
        'direct trip RLS hides catch JSON from unauthorized readers'
      )
    else
      await rejects(
        () => as(null, () => db.query('select catch_records from public.trips where id=$1', [id])),
        /permission denied/,
        'visitor has no direct trip table grant'
      )
  }
  await rejects(
    () =>
      as(alice, () =>
        db.query('update public.trips set catch_records=$1 where id=$2', [JSON.stringify([]), id])
      ),
    /permission denied/,
    'owner cannot bypass revision RPC with direct catch write'
  )
  await rejects(
    () =>
      as(alice, () =>
        db.query('select fishing_private.trip_catches_input($1)', [JSON.stringify(draft)])
      ),
    /permission denied/,
    'private catch helper cannot bypass RPC authorization'
  )
  const edit = {
    ...draft,
    type: 'trip',
    revision: 1,
    request_id: randomUUID(),
    catch_records: [
      { species: '鲫鱼', count: 0, weight_kg: 0 },
      { species: '鲤鱼', count: 2, weight_kg: 1.2 }
    ]
  }
  await write(alice, 'update_content', edit)
  await write(alice, 'update_content', edit)
  check(
    (await snapshot()).revision === 2 && (await snapshot()).item.weight_kg === 1.2,
    'multi-catch edit and receipt retry commit once atomically'
  )
  await write(alice, 'save_trip', draft)
  check(
    (await snapshot()).item.catch_records[1].count === 2,
    'replaying create cannot overwrite a later catch edit'
  )
  await rejects(
    () => write(alice, 'update_content', { ...edit, request_id: randomUUID() }),
    /EDIT_CONFLICT/,
    'stale catch editor cannot overwrite current entries'
  )
  await rejects(
    () => write(alice, 'update_content', { ...edit, catch_records: [] }),
    /EDIT_REQUEST_REUSED/,
    'changed catches cannot reuse an accepted receipt'
  )
  await rejects(
    () => write(bob, 'update_content', { ...edit, revision: 2 }),
    /NOT_FOUND/,
    'another user cannot edit catch details'
  )
  const { catch_records, ...legacy } = { ...edit, revision: 2, request_id: randomUUID() }
  await rejects(
    () => write(alice, 'update_content', legacy),
    /CATCH_DETAILS_REQUIRED/,
    'old client cannot flatten a multi-catch log'
  )
  check(
    (await snapshot()).revision === 2,
    'rejected legacy edit preserves revision and complete details'
  )
  for (const invalid of [
    null,
    {},
    'bad',
    [null],
    [{ species: 'a', count: '1' }],
    [{ species: 'a', count: 1.5 }],
    [{ species: 'a', count: -1 }],
    [{ species: 'a', weight_kg: 10001 }],
    [
      { species: 'a', count: 10000 },
      { species: 'b', count: 1 }
    ],
    [
      { species: 'a', weight_kg: 10000 },
      { species: 'b', weight_kg: 0.1 }
    ],
    [{ species: 'x'.repeat(61) }],
    [{ species: 'a', owner_id: bob }],
    Array.from({ length: 21 }, () => ({ species: 'a' }))
  ]) {
    await rejects(
      () =>
        write(alice, 'update_content', {
          ...edit,
          revision: 2,
          request_id: randomUUID(),
          catch_records: invalid
        }),
      /INVALID_INPUT/,
      'malformed, unbounded or forged catch details are rejected'
    )
  }
  const foreign = randomUUID()
  await db.query(
    'insert into public.media_assets(id,owner_id,path,width,height) values($1,$2,$3,40,40)',
    [foreign, bob, `test/${foreign}.jpg`]
  )
  await rejects(
    () =>
      write(alice, 'update_content', {
        ...edit,
        revision: 2,
        request_id: randomUUID(),
        catch_records: [],
        media: [{ id: foreign }]
      }),
    /FORBIDDEN/,
    'invalid media rolls back catch removal and revision together'
  )
  check(
    (await snapshot()).revision === 2 && (await snapshot()).item.catch_records.length === 2,
    'no partial writes survive a rejected multi-catch edit'
  )
  await write(alice, 'update_content', {
    ...edit,
    revision: 2,
    request_id: randomUUID(),
    catch_records: []
  })
  const empty = (await snapshot()).item
  check(
    empty.catch_records.length === 0 &&
      empty.count === null &&
      empty.weight_kg === null &&
      empty.species === '',
    'explicitly clearing entries clears summary without converting unknown to zero'
  )
  await write(alice, 'update_content', {
    ...base,
    id,
    type: 'trip',
    revision: 3,
    request_id: randomUUID(),
    count: '0',
    weight: ''
  })
  const oldClient = (await snapshot()).item
  check(
    oldClient.catch_records.length === 1 && oldClient.count === 0 && oldClient.weight_kg === null,
    'legacy single-catch edits stay compatible with zero and unknown'
  )
  await write(alice, 'delete_content', { type: 'trip', id })
  await write(alice, 'update_content', edit)
  check(
    (await db.query('select id from public.trips where id=$1', [id])).rows.length === 0,
    'old edit receipt cannot resurrect deleted private catches'
  )
  await rejects(
    () => write(alice, 'save_trip', draft),
    /NOT_FOUND/,
    'delayed create retry cannot resurrect a deleted log or catch details'
  )
  await rejects(
    () => as(alice, () => db.query('select * from fishing_private.trip_create_receipts')),
    /permission denied/,
    'create receipts are server-only and contain no private content'
  )
}
