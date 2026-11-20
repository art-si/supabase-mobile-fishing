import { randomUUID } from 'node:crypto'
export async function spotDistanceChecks({ db, read, check, rejects }) {
  const owner = randomUUID(),
    outsider = randomUUID()
  for (const id of [owner, outsider]) await db.query('insert into auth.users(id) values($1)', [id])
  const prefix = `distance-${randomUUID()}`,
    ids = []
  const origin = { longitude: 114.18, latitude: 30.48, crs: 'GCJ-02' }
  async function insert(
    name,
    x,
    y,
    precision = 'exact',
    audience = 'public',
    status = 'published'
  ) {
    const id = randomUUID()
    ids.push(id)
    await db.query(
      "insert into public.fishing_spots(id,author_id,name,city,water_type,observed_on,audience,precision,status) values($1,$2,$3,'武汉市','自然水域',current_date,$4,$5,$6)",
      [id, owner, `${prefix}-${name}`, audience, precision, status]
    )
    await db.query(
      'insert into public.spot_locations(spot_id,longitude,latitude) values($1,$2,$3)',
      [id, x, y]
    )
    return id
  }
  const list = (user = outsider, fields = {}) =>
    read(user, 'spots', { query: prefix, origin, ...fields })
  try {
    const near = await insert('near', 114.181, 30.48)
    const far = await insert('far', 115.18, 30.48)
    const hidden = await insert('hidden', 114.18, 30.48, 'hidden')
    const area = await insert('area', 114.193, 30.493, 'area')
    const privateId = await insert('private', 114.18, 30.48, 'exact', 'private')
    const hiddenContent = await insert('moderated', 114.18, 30.48, 'exact', 'public', 'hidden')
    const result = (await list()).items
    check(
      result[0].id === near &&
        result.find((s) => s.id === near).distance_m > 90 &&
        result.find((s) => s.id === near).distance_m < 110,
      'distance order starts with the nearest visible point and returns metres'
    )
    check(
      !('distance_m' in result.find((s) => s.id === hidden)) && result.at(-1).id === hidden,
      'hidden positions have no public distance and sort after measurable places'
    )
    check(
      result.find((s) => s.id === area).distance_approximate === true,
      'area positions report an approximate distance'
    )
    const oldDistance = result.find((s) => s.id === area).distance_m
    await db.query(
      'update public.spot_locations set longitude=114.196,latitude=30.496 where spot_id=$1',
      [area]
    )
    check(
      (await list()).items.find((s) => s.id === area).distance_m === oldDistance,
      'moving an area point inside its public grid does not leak hidden precision through distance'
    )
    check(
      !result.some((s) => s.id === privateId || s.id === hiddenContent),
      'distance sorting excludes private and moderated content'
    )
    check(
      (await list(owner)).items.find((s) => s.id === hidden).distance_m === 0,
      'owner can measure their own retained private coordinates'
    )
    for (const value of [
      { longitude: 114, latitude: 90, crs: 'GCJ-02' },
      { longitude: 181, latitude: 30, crs: 'GCJ-02' },
      { longitude: '114', latitude: 30, crs: 'GCJ-02' },
      { longitude: 114, latitude: 30, crs: 'WGS-84' },
      {},
      true
    ])
      await rejects(
        () => list(outsider, { origin: value }),
        /INVALID_INPUT/,
        'invalid origin or coordinate system is rejected'
      )
    check(
      (await list(outsider, { origin: null })).items.every((s) => !('distance_m' in s)),
      'without an origin the API does not invent a distance'
    )
    check(
      (await list(outsider, { type: '水库' })).items.length === 0,
      'water type filtering is preserved in distance reads'
    )
    await db.query("update public.fishing_spots set created_at='2020-01-01' where id=$1", [near])
    for (let index = 0; index < 102; index++)
      await insert(`recent-${index}`, 116 + index * 0.001, 30.48)
    const dense = (await list()).items
    check(
      dense.length === 100 && dense[0].id === near,
      'nearest selection happens before the 100-row limit, even for old nearby spots'
    )
    await db.query('insert into public.blocks(blocker_id,blocked_id) values($1,$2)', [
      outsider,
      owner
    ])
    check((await list()).items.length === 0, 'blocking also removes distance-sorted results')
    check(
      !(
        await db.query(
          "select has_function_privilege('anon','fishing_private.spots_by_distance(jsonb)','EXECUTE') allowed"
        )
      ).rows[0].allowed,
      'distance helper is not a separate public authorization bypass'
    )
  } finally {
    await db.query('delete from auth.users where id=any($1::uuid[])', [[owner, outsider]])
  }
}
