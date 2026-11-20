// Local PostgreSQL only. No synthetic community records are created in production.
export async function mapSpotChecks({ db, as, check, rejects, alice, bob }) {
  const call = (user, bounds) =>
    as(user, () =>
      db
        .query('select public.fishing_map_spots($1::jsonb) result', [JSON.stringify(bounds)])
        .then((r) => r.rows[0].result)
    )
  const bounds = { west: 100, east: 101, south: 20, north: 21 }
  const ids = {}
  async function insert(
    key,
    audience = 'public',
    precision = 'exact',
    status = 'published',
    x = 100.123456,
    y = 20.287654
  ) {
    const id = crypto.randomUUID()
    ids[key] = id
    await db.query(
      `insert into public.fishing_spots(id,author_id,name,city,water_type,audience,precision,status,observed_on)
      values($1,$2,$3,'测试城市','自然水域',$4,$5,$6,current_date)`,
      [id, alice, key, audience, precision, status]
    )
    await db.query(
      'insert into public.spot_locations(spot_id,longitude,latitude,access_note) values($1,$2,$3,$4)',
      [id, x, y, '秘密入口']
    )
    return id
  }
  await insert('exact')
  await insert('area', 'public', 'area')
  await insert('hidden-location', 'public', 'hidden')
  await insert('private', 'private')
  await insert('friends', 'friends')
  await insert('pending', 'public', 'exact', 'pending')
  await insert('hidden-content', 'public', 'exact', 'hidden')
  await insert('deleted', 'public', 'exact', 'deleted')
  await insert('outside', 'public', 'exact', 'published', 102, 22)
  const guest = await call(null, bounds)
  check(
    guest.items.length === 2 && !guest.truncated && !guest.zoom_in,
    'map returns only visible pins inside the viewport'
  )
  const area = guest.items.find((p) => p.id === ids.area)
  check(
    area.longitude === 100.12 && area.latitude === 20.28 && area.precision === 'area',
    'map returns the same stable coarse point as spot detail'
  )
  check(
    guest.items.every(
      (p) =>
        !('author_id' in p) && !('access_note' in p) && !('description' in p) && !('audience' in p)
    ),
    'map minimum projection excludes private and unrelated fields'
  )
  const exactBox = { west: 100.1234, east: 100.1235, south: 20.2876, north: 20.2877 }
  check(
    (await call(null, exactBox)).items.every((p) => p.id !== ids.area),
    'tiny queries around hidden exact coordinates do not reveal an area-only spot'
  )
  const coarseBox = { west: 100.1199, east: 100.1201, south: 20.2799, north: 20.2801 }
  check(
    (await call(null, coarseBox)).items.some((p) => p.id === ids.area),
    'area-only filtering uses its public coarse point, not the secret coordinate'
  )
  await db.query(
    'update public.spot_locations set longitude=100.126,latitude=20.286 where spot_id=$1',
    [ids.area]
  )
  check(
    (await call(null, coarseBox)).items.some((p) => p.id === ids.area),
    'moving the hidden point inside one grid cell does not change public membership'
  )
  const owner = await call(alice, exactBox)
  check(
    owner.items.some((p) => p.id === ids.private && p.own && p.precision === 'exact') &&
      !owner.items.some((p) => p.id === ids.deleted),
    'owner can recover private and unpublished pins but not deleted ones'
  )
  await db.query(
    'insert into public.friendships(user_a,user_b) values(least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid)) on conflict do nothing',
    [alice, bob]
  )
  check(
    (await call(bob, bounds)).items.some((p) => p.id === ids.friends),
    'current friends can see friends-only map pins'
  )
  await db.query(
    'delete from public.friendships where user_a=least($1::uuid,$2::uuid) and user_b=greatest($1::uuid,$2::uuid)',
    [alice, bob]
  )
  check(
    !(await call(bob, bounds)).items.some((p) => p.id === ids.friends),
    'removing friendship revokes pins on next read'
  )
  await db.query('insert into public.blocks(blocker_id,blocked_id) values($1,$2)', [bob, alice])
  check((await call(bob, bounds)).items.length === 0, 'blocking removes all other-author map pins')
  await db.query('delete from public.blocks where blocker_id=$1 and blocked_id=$2', [bob, alice])
  await db.query("update public.fishing_spots set audience='private' where id=$1", [ids.exact])
  check(
    !(await call(null, bounds)).items.some((p) => p.id === ids.exact),
    'privacy tightening immediately removes the previously public map pin'
  )
  for (const bad of [
    null,
    {},
    [],
    { ...bounds, west: '100' },
    { ...bounds, north: null },
    { ...bounds, south: 100 },
    { ...bounds, west: 181 },
    { ...bounds, east: 99 }
  ])
    await rejects(
      () => call(null, bad),
      /INVALID_INPUT/,
      'map rejects missing, malformed or inverted bounds'
    )
  check(
    (await call(null, { west: 70, east: 140, south: 0, north: 60 })).zoom_in,
    'nationwide viewport returns zoom guidance without scanning or counting pins'
  )
  const boundaryId = await insert('on-edge', 'public', 'exact', 'published', 100, 20)
  check(
    (await call(null, bounds)).items.some((p) => p.id === boundaryId),
    'map includes pins exactly on viewport edges'
  )
  for (let i = 0; i < 102; i++) await insert(`cap-${i}`)
  const capped = await call(null, bounds)
  check(
    capped.items.length === 100 && capped.truncated,
    'dense waterbody result is capped with an explicit truncation flag'
  )
  check(
    JSON.stringify(capped) === JSON.stringify(await call(null, bounds)),
    'unchanged results have deterministic ordering'
  )
  const indexCount = await db.query(
    "select count(*)::int n from pg_indexes where tablename='spot_locations' and indexname in ('spot_locations_exact_map_idx','spot_locations_area_map_idx')"
  )
  check(indexCount.rows[0].n === 2, 'exact and coarse coordinate filters each have a spatial index')
}
