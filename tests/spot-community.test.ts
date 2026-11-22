import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { commentAnalysis } from '../supabase/functions/spot-discovery/spot-community'

test('analysis rejects unknown comments and invented excerpts', () => {
  const comments = [{ id: 'a', body: '桥边已经恢复开放了' }, { id: 'b', body: '昨天没口' }]
  assert.deepEqual(commentAnalysis({ items: [
    { id: 'a', verdict: 'open', evidence: '恢复开放了' },
    { id: 'b', verdict: 'prohibited', evidence: '全面禁止垂钓' },
    { id: 'b', verdict: 'other' },
    { id: 'z', verdict: 'unavailable', evidence: '填了' }
  ] }, comments), [{ id: 'a', verdict: 'open' }, { id: 'b', verdict: 'other' }])
})

test('one opinion per account and 60 percent consensus drive pin changes', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema fishing_private;
      grant usage on schema auth,fishing_private to anon,authenticated,service_role;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.fishing_spots(id uuid primary key, author_id uuid, name text, city text, audience text, precision text,
        status text, fishing_status text, observed_on date, created_at timestamptz default now(), review_revision int default 1);
      create table public.spot_locations(spot_id uuid primary key,longitude double precision,latitude double precision);
      create table public.spot_bookmarks(user_id uuid,spot_id uuid,primary key(user_id,spot_id));
      create function fishing_private.can_view_spot(target uuid) returns boolean language sql stable as
        $$select exists(select 1 from public.fishing_spots where id=target and audience='public')$$;
      create function fishing_private.is_blocked(uuid,uuid) returns boolean language sql stable as $$select false$$;
      create function fishing_private.profile_json(target uuid) returns jsonb language sql stable as
        $$select jsonb_build_object('id',target,'nickname','测试钓友')$$;
    `)
    for (const name of ['20261121051141_fishing_public_spot_leads.sql', '20261121053351_fishing_spot_community.sql', '20261121062525_fishing_spot_discussions.sql'])
      await db.exec(await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8'))
    const id = randomUUID(), privateId = randomUUID()
    const users = Array.from({ length: 10 }, () => randomUUID())
    for (const user of users) await db.query('insert into auth.users values($1)', [user])
    await db.query(`insert into public.fishing_spots(id,name,city,audience,precision,status,fishing_status)
      values($1,'钓位','武汉市','public','exact','published','allowed'),
        ($2,'私密钓位','武汉市','private','exact','published','prohibited')`, [id, privateId])
    await db.query('insert into public.spot_locations values($1,114,30),($2,114,30)', [id, privateId])
    await db.query('update public.fishing_spots set author_id=$1 where id=$2', [users[0], id])
    const target = 'spot:' + id, lead = 'lead:武汉市|杉野灵溪休闲垂钓区'
    async function withRole<T>(role: string,user: string, run: () => Promise<T>) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user])
      await db.exec('set role ' + role)
      try { return await run() } finally { await db.exec('reset role') }
    }
    async function rpc<T>(user: string, action: string, payload: unknown) {
      return withRole(user ? 'authenticated' : 'anon', user, async () =>
        (await db.query<{ result: T }>('select public.fishing_spot_community($1,$2) as result',
          [action, JSON.stringify(payload)])).rows[0]!.result)
    }
    async function pins() {
      return (await db.query<{ result: { id: string }[] }>('select fishing_private.nearby_prohibited_spot_points($1) as result',
        ['{"west":113.9,"east":114.1,"south":29.9,"north":30.1}'])).rows[0]!.result.map(pin => pin.id)
    }
    const subjects = await rpc<{ target: string }[]>('', 'summary',
      { targets: [target, lead, 'spot:' + privateId, 'lead:武汉市|假钓场'] })
    assert.deepEqual(subjects.map(row => row.target).sort(), [lead, target].sort())
    await assert.rejects(rpc('', 'react', { target, kind: 'like', enabled: true }), /NOT_AUTHENTICATED/)
    for (let n = 0; n < 2; n++) {
      const row = await rpc<{ likes: number; rank_likes: number }>(users[0]!, 'react', { target, kind: 'like', enabled: true })
      assert.equal(row.likes, 1)
      assert.equal(row.rank_likes, 0)
    }
    await rpc(users[0]!, 'react', { target, kind: 'bookmark', enabled: true })
    assert.equal((await db.query('select * from public.spot_bookmarks')).rows.length, 1)
    await rpc(users[0]!, 'react', { target: lead, kind: 'bookmark', enabled: true })
    assert.equal((await rpc<unknown[]>(users[0]!, 'saved_leads', {})).length, 1)
    assert.equal((await rpc<unknown[]>(users[1]!, 'saved_leads', {})).length, 0)
    await assert.rejects(withRole('authenticated', users[0]!, () =>
      db.query('select * from public.fishing_claim_spot_comments($1)', [target])), /permission denied/)
    const first = randomUUID()
    const note = { target, id: first, body: '这里已经明确禁钓' }
    await rpc(users[0]!, 'comment', note)
    await rpc(users[0]!, 'comment', note)
    assert.equal((await rpc<{ items: unknown[] }>('', 'comments', { target })).items.length, 1)
    await assert.rejects(rpc(users[1]!, 'delete_comment', { target, id: first }), /NOT_FOUND/)
    const lease = () => withRole('service_role', '', () =>
      db.query('select * from public.fishing_claim_spot_comments($1)', [target]))
    assert.equal((await lease()).rows.length, 1)
    assert.equal((await lease()).rows.length, 0)
    const classify = (cid: string, verdict: string, key = target) => withRole('service_role', '', async () =>
      (await db.query<{ result: string }>('select public.fishing_apply_spot_comment_analysis($1,$2) as result',
        [key, JSON.stringify([{ id: cid, verdict }])])).rows[0]!.result)
    const post = async (user: string, verdict: string, key = target) => {
      const cid = randomUUID()
      await rpc(user, 'comment', { target: key, id: cid, body: '这处的当前情况' })
      return classify(cid, verdict, key)
    }
    await classify(first, 'prohibited')
    for (let n = 1; n < 9; n++) await post(users[n]!, n < 6 ? 'prohibited' : 'open')
    assert.equal(await post(users[0]!, 'prohibited'), '')
    assert.deepEqual(await pins(), [])
    assert.equal(await post(users[9]!, 'open'), 'prohibited')
    assert.deepEqual(await pins(), [id])
    for (const state of ['open', 'unavailable']) {
      for (const user of users.slice(0, 6)) await post(user, state)
      const rows = await rpc<{ status: string }[]>('', 'summary', { targets: [target] })
      assert.equal(rows[0]?.status, state)
      assert.deepEqual(await pins(), [])
    }
    for (const user of users) await post(user, 'prohibited', lead)
    assert.deepEqual(await pins(), [])
    await assert.rejects(withRole('authenticated', users[0]!, () =>
      db.query("select public.fishing_store_spot_lead_point('武汉市','杉野灵溪休闲垂钓区',114,30)")), /permission denied/)
    await withRole('service_role', '', () =>
      db.query("select public.fishing_store_spot_lead_point('武汉市','杉野灵溪休闲垂钓区',114,30)"))
    assert.deepEqual(await pins(), [lead])
  } finally { await db.close() }
})
