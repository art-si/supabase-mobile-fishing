import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
const db = new PGlite()
try {
  await db.exec(
    'create role anon; create role authenticated; create role service_role bypassrls; create schema fishing_private;'
  )
  await db.exec(
    readFileSync('supabase/migrations/20261119083454_fishing_amap_js_proxy_quota.sql', 'utf8')
  )
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    await assert.rejects(
      () => db.query('select public.fishing_js_map_ticket()'),
      /permission denied/
    )
    await assert.rejects(
      () => db.query('select * from fishing_private.amap_js_quota'),
      /permission denied/
    )
    await db.exec('reset role')
  }
  await db.exec('set role service_role')
  for (let i = 0; i < 60; i++)
    assert.equal((await db.query('select public.fishing_js_map_ticket() as ok')).rows[0].ok, true)
  assert.equal((await db.query('select public.fishing_js_map_ticket() as ok')).rows[0].ok, false)
  await db.exec(
    "update fishing_private.amap_js_quota set minute_start = minute_start - interval '1 minute'"
  )
  assert.equal((await db.query('select public.fishing_js_map_ticket() as ok')).rows[0].ok, true)
  await db.exec('update fishing_private.amap_js_quota set day_count = 1000')
  assert.equal((await db.query('select public.fishing_js_map_ticket() as ok')).rows[0].ok, false)
  await db.exec('update fishing_private.amap_js_quota set day_start = day_start - 1')
  assert.equal((await db.query('select public.fishing_js_map_ticket() as ok')).rows[0].ok, true)
  assert.equal(
    (await db.query('select day_count from fishing_private.amap_js_quota')).rows[0].day_count,
    1
  )
  console.log('PASS JS proxy quota: client denial, server access, 60/min, 1000/day, window reset')
} finally {
  await db.close()
}
