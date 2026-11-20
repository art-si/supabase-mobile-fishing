// Queue/state/permissions tests with a minimal real PostgreSQL schema. No remote objects.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
const db = new PGlite()
let checks = 0
const check = (value, label) => {
  assert.ok(value, label)
  checks++
  console.log(`PASS ${label}`)
}
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema fishing_private;
  create table public.profiles(id uuid primary key);
  create table public.media_assets(id uuid primary key, owner_id uuid not null references public.profiles(id) on delete cascade, path text not null unique);
  grant all on public.media_assets to service_role;
`)
const migrations = new URL('../supabase/migrations/', import.meta.url)
const migration = (await readdir(migrations)).filter((name) => name.endsWith('_fishing_media_cleanup_queue.sql'))
assert.equal(migration.length, 1)
await db.exec(await readFile(new URL(migration[0], migrations), 'utf8'))
const owner = randomUUID()
await db.query('insert into public.profiles values($1)', [owner])
async function add(ext = 'jpg') {
  const id = randomUUID(),
    path = `${owner}/${id}.${ext}`
  await db.query('insert into public.media_assets values($1,$2,$3)', [id, owner, path])
  return { id, path }
}
const one = async (query, params = []) => (await db.query(query, params)).rows[0]
const state = async (id) => one('select * from fishing_private.media_deletions where id=$1', [id])
async function service(task) {
  await db.exec('set role service_role')
  try {
    return await task()
  } finally {
    await db.exec('reset role')
  }
}
const claim = (limit = 8) =>
  service(
    async () =>
      (await db.query('select * from public.fishing_media_cleanup_claim($1)', [limit])).rows
  )
const finish = (job, ok, lease = job.lease_token) =>
  service(
    async () =>
      (
        await one('select public.fishing_media_cleanup_finish($1,$2,$3) as result', [
          job.job_id,
          lease,
          ok
        ])
      ).result !== 'stale'
  )
try {
  const draft = await add(),
    removed = await add(),
    video = await add('mp4')
  check((await claim()).length === 0, 'unattached uploads and current assets are never selected')
  await db.exec('begin')
  await db.query('delete from public.media_assets where id=$1', [removed.id])
  await db.exec('rollback')
  check(!(await state(removed.id)), 'rolled-back content deletion also rolls back its cleanup job')
  await db.query('delete from public.media_assets where id=any($1::uuid[])', [
    [removed.id, video.id]
  ])
  check(
    (await state(removed.id)).state === 'pending',
    'committed index deletion creates a private job'
  )
  const jobs = await claim()
  check(
    jobs.length === 2 && jobs.some((j) => j.path.endsWith('.mp4')),
    'images and videos use the same bounded queue'
  )
  check((await claim()).length === 0, 'a live lease prevents duplicate claims')
  check(
    !(await finish(jobs[0], true, randomUUID())),
    'a wrong lease cannot complete or scrub a job'
  )
  check(await finish(jobs[0], false), 'storage failure is acknowledged as retryable')
  const failed = await state(jobs[0].job_id)
  check(
    failed.state === 'pending' && failed.path && new Date(failed.next_attempt_at) > new Date(),
    'failure preserves the path and backs off'
  )
  check((await claim()).length === 0, 'backoff is enforced before the next attempt')
  await db.query(
    "update fishing_private.media_deletions set next_attempt_at=now()-interval '1 second' where id=$1",
    [jobs[0].job_id]
  )
  const retried = (await claim())[0]
  check(
    retried.attempt === 2 && retried.lease_token !== jobs[0].lease_token,
    'retry rotates the lease and counts attempts'
  )
  check(!(await finish(jobs[0], true)), 'a late previous worker cannot acknowledge the retry')
  check(await finish(retried, true), 'successful deletion completes the current lease')
  const done = await state(retried.job_id)
  check(
    done.state === 'done' && done.path === null && done.owner_id === null && done.completed_at,
    'completed jobs scrub owner and object path'
  )
  await assert.rejects(
    db.query('insert into public.media_assets values($1,$2,$3)', [
      retried.job_id,
      owner,
      retried.path
    ]),
    /MEDIA_PATH_RETIRED/
  )
  check(true, 'a deleted upload path cannot be resurrected after completion')
  await db.query(
    "update fishing_private.media_deletions set lease_until=now()-interval '1 second' where id=$1",
    [jobs[1].job_id]
  )
  const recovered = (await claim())[0]
  check(
    recovered.attempt === 2 && recovered.lease_token !== jobs[1].lease_token,
    'expired worker leases recover without losing the job'
  )
  await db.query('update fishing_private.media_deletions set attempts=12 where id=$1', [
    recovered.job_id
  ])
  await finish(recovered, false)
  check(
    (await state(recovered.job_id)).state === 'failed',
    'persistent failure stops after twelve attempts for operator review'
  )
  check(
    !!(await one('select id from public.media_assets where id=$1', [draft.id])),
    'cleanup leaves the unsubmitted draft intact'
  )
  const invalid = await add('png')
  await db.query('delete from public.media_assets where id=$1', [invalid.id])
  check(
    (await state(invalid.id)).failure_code === 'PATH_INVALID',
    'unexpected legacy paths are quarantined, never guessed or deleted'
  )
  await assert.rejects(claim(21), /INVALID_BATCH/)
  check(true, 'batch size is bounded on the server')
  for (const role of ['anon', 'authenticated']) {
    const privileges = await one(
      `select has_function_privilege($1,'public.fishing_media_cleanup_claim(integer)','EXECUTE') as claim,
      has_function_privilege($1,'public.fishing_media_cleanup_finish(uuid,uuid,boolean,text)','EXECUTE') as finish,
      has_table_privilege($1,'fishing_private.media_deletions','SELECT') as readable`,
      [role]
    )
    check(
      !privileges.claim && !privileges.finish && !privileges.readable,
      `${role} cannot invoke worker RPCs or read cleanup paths`
    )
  }
  await db.query('delete from public.profiles where id=$1', [owner])
  check(
    (await state(draft.id)).state === 'pending',
    'account cascade retains its cleanup job after the profile disappears'
  )
  console.log(`${checks} cleanup database checks passed (PGlite; not remote Storage).`)
} finally {
  await db.close()
}
