// Real SQL through the same public RPCs; no hosted users or network calls.
export async function zoneFeedbackChecks({ db, as, check, rejects, alice }) {
  const voters = Array.from(
    { length: 10 },
    (_, index) => `f1000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
  )
  for (const id of voters) await db.query('insert into auth.users(id) values($1)', [id])
  const zone = 'f2000000-0000-4000-8000-000000000001'
  const ring = {
    type: 'Polygon',
    coordinates: [
      [
        [120.499, 31.499],
        [120.501, 31.499],
        [120.501, 31.501],
        [120.499, 31.501],
        [120.499, 31.499]
      ]
    ]
  }
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 8 * 3600000 + 86400000).toISOString().slice(0, 10)
  await db.query(
    `insert into public.fishing_zone_reports(id,author_id,title,description,location_label,longitude,latitude,radius_m,boundary,observed_on,expires_on,status,revision)
    values($1,$2,'反馈测试围栏','这是本地 SQL 验收围栏，不代表任何真实水域。','本地验收水域',120.5,31.5,300,$3,$4,$5,'published',2)`,
    [zone, alice, JSON.stringify(ring), today, tomorrow]
  )
  await db.query(
    `insert into public.fishing_official_zones(id,title,description,location_label,region_adcode,longitude,latitude,boundary,issuer,source_url,boundary_source_url,boundary_note,issued_on,checked_on,valid_from,published)
    values('feedback-official-test','官方来源验收围栏','这是 SQL 接口样例，不是任何真实官方禁钓范围。','本地验收水域','320500',120.5,31.5,$1,'测试单位','https://test.gov.cn/policy','https://test.gov.cn/boundary','本地测试边界',$2,$2,$2,true)`,
    [JSON.stringify(ring), today]
  )
  const rpc = (user, action, payload) =>
    as(user, () =>
      db
        .query('select public.fishing_zone_feedback($1,$2::jsonb) result', [
          action,
          JSON.stringify(payload)
        ])
        .then((r) => r.rows[0].result)
    )
  const target = { source: 'community', id: zone }
  const initial = await rpc(null, 'state', target)
  check(
    initial.total === 0 && !initial.released && initial.minimum === 10 && initial.threshold === 60,
    'zone feedback starts empty with server-owned 10-person / 60% rule'
  )
  await rejects(
    () => rpc(null, 'vote', { ...target, version: initial.version, vote: 'can_fish' }),
    /NOT_AUTHENTICATED/,
    'guest cannot vote'
  )
  await rejects(
    () =>
      rpc(voters[0], 'vote', {
        ...target,
        version: initial.version,
        vote: 'can_fish',
        voter_id: voters[1]
      }),
    /INVALID_INPUT/,
    'voter identity cannot be forged'
  )
  const vote = (index, choice, extra = {}) =>
    rpc(voters[index], 'vote', { ...target, version: initial.version, vote: choice, ...extra })
  for (let i = 0; i < 9; i++)
    await vote(i, i < 6 ? 'can_fish' : 'cannot_fish', { note: i === 0 ? '我的现场依据' : '' })
  check(
    !(await rpc(null, 'state', target)).released,
    'six of nine does not bypass the minimum quorum'
  )
  const tenth = await vote(9, 'cannot_fish')
  check(
    tenth.total === 10 && tenth.can_fish === 6 && tenth.percent === 60 && tenth.released,
    'exactly six of ten automatically releases the fence'
  )
  await vote(9, 'cannot_fish')
  check(
    (
      await db.query(
        "select count(*)::int n from fishing_private.zone_feedback_events where target_id=$1 and event='release'",
        [zone]
      )
    ).rows[0].n === 1,
    'lost-response retry preserves one ballot and one release event'
  )
  const publicState = await rpc(null, 'state', target)
  check(
    publicState.mine === null &&
      publicState.note === '' &&
      !JSON.stringify(publicState).includes(voters[0]),
    'public tally never exposes voter identities or private notes'
  )
  check(
    (await rpc(voters[0], 'state', target)).note === '我的现场依据',
    'only the voter recovers their supplemental note'
  )
  const nearby = () =>
    as(null, () =>
      db
        .query("select public.fishing_zones_read('nearby',$1) result", [
          JSON.stringify({ west: 120, east: 121, south: 31, north: 32 })
        ])
        .then((r) => r.rows[0].result)
    )
  const released = await nearby()
  check(
    !released.items.some((z) => z.id === zone) && released.released.some((z) => z.id === zone),
    'release affects shared anonymous map reads and remains in the released list'
  )
  await vote(0, 'cannot_fish')
  check(
    (await rpc(null, 'state', target)).released,
    '50/50 after release does not make the fence flicker'
  )
  await vote(1, 'cannot_fish')
  check(
    !(await rpc(null, 'state', target)).released &&
      (await nearby()).items.some((z) => z.id === zone),
    '60% still-restricted feedback restores the shared fence'
  )
  const official = { source: 'official', id: 'feedback-official-test' }
  const officialState = await rpc(null, 'state', official)
  for (let i = 0; i < 10; i++)
    await rpc(voters[i], 'vote', {
      ...official,
      version: officialState.version,
      vote: i < 5 ? 'can_fish' : 'cannot_fish'
    })
  check(!(await rpc(null, 'state', official)).released, 'five of ten does not satisfy 60%')
  await rpc(voters[5], 'vote', { ...official, version: officialState.version, vote: 'can_fish' })
  check(
    (await rpc(null, 'state', official)).released,
    'the same application-display threshold applies to official-source fences'
  )
  check(
    (
      await db.query(
        "select published,source_url from public.fishing_official_zones where id='feedback-official-test'"
      )
    ).rows[0].published,
    'community display release never deletes or changes the authoritative source'
  )
  await db.query(
    "update public.fishing_official_zones set description=description||'依据更新' where id='feedback-official-test'"
  )
  const updated = await rpc(null, 'state', official)
  check(
    updated.version !== officialState.version && updated.total === 0 && !updated.released,
    'a changed source starts a fresh voting round and restores its fence'
  )
  await rejects(
    () => rpc(voters[0], 'vote', { ...official, version: officialState.version, vote: 'can_fish' }),
    /REVIEW_CONFLICT/,
    'stale-source ballots are rejected'
  )
  await rejects(
    () =>
      rpc(voters[0], 'state', { source: 'community', id: 'f2000000-0000-4000-8000-000000000099' }),
    /NOT_FOUND/,
    'private or missing fences cannot acquire ballots'
  )
  await rejects(
    () => as(voters[0], () => db.query('select * from fishing_private.zone_feedback_votes')),
    /permission denied/,
    'raw ballots are private even to signed-in users'
  )
  await rejects(
    () =>
      as(voters[0], () =>
        db.query("select fishing_private.zone_feedback_state('community',$1,$2)", [
          zone,
          initial.version
        ])
      ),
    /permission denied/,
    'private helpers cannot be called to bypass target visibility'
  )
  await db.query('update public.fishing_zone_reports set revision=revision+1 where id=$1', [zone])
  const newRevision = await rpc(null, 'state', target)
  check(
    newRevision.total === 0 && newRevision.version !== initial.version,
    'a revised community boundary also resets its voting round'
  )
  check(
    (
      await db.query(
        'select count(*)::int n from fishing_private.zone_feedback_votes where target_id=$1',
        [zone]
      )
    ).rows[0].n === 10,
    'old rounds remain auditable after reset'
  )
  await db.query('delete from public.fishing_zone_reports where id=$1', [zone])
  await rejects(
    () => rpc(voters[0], 'vote', { ...target, version: newRevision.version, vote: 'can_fish' }),
    /NOT_FOUND/,
    'removed source cannot be revived by a ballot'
  )
  await db.query("delete from public.fishing_official_zones where id='feedback-official-test'")
  for (const id of voters) await db.query('delete from auth.users where id=$1', [id])
}
