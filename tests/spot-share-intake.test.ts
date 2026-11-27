import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('public share intake excludes private content, enforces leases and withdrawal, and queues URLs without trusting user quotes', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema fishing_private;grant usage on schema fishing_private to service_role;
      create table public.fishing_spots(id uuid primary key,city text,description text,status text,audience text);
      grant select,update on public.fishing_spots to service_role;
      create table fishing_private.queued(city text,url text,primary key(city,url));
      grant select,insert on fishing_private.queued to service_role;
      create function public.fishing_enqueue_spot_sources(sources jsonb) returns integer language plpgsql as $$
      declare n integer;begin insert into fishing_private.queued select e->>'city',e->>'url' from jsonb_array_elements(sources) e on conflict do nothing;
      get diagnostics n=row_count;return n;end $$;
      revoke all on function public.fishing_enqueue_spot_sources(jsonb) from public;grant execute on function public.fishing_enqueue_spot_sources(jsonb) to service_role;
    `)
    const files = await readdir(new URL('../supabase/migrations/', import.meta.url))
    const file = files.find(file => file.endsWith('_fishing_public_share_intake.sql'))!
    await db.exec(await readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'))
    const ids = ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444']
    const raw = '实钓分享 https://www.douyin.com/video/123456789?tracking=public 测试说明不能冒充原文证据。'
    for (const [i,audience,status] of [[0,'private','published'],[1,'friends','published'],[2,'public','pending'],[3,'public','published']] as const)
      await db.query('insert into public.fishing_spots values($1,$2,$3,$4,$5)',[ids[i],'武汉市',raw,status,audience])
    assert.equal((await db.query('select * from fishing_private.spot_share_inbox')).rows.length,1)
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`)
      await assert.rejects(db.query('select public.fishing_claim_spot_shares()'), /permission denied/)
      await assert.rejects(db.query('select * from fishing_private.spot_share_inbox'), /permission denied/)
      await db.exec('reset role')
    }
    type Claim = { id: string; lease: string; fingerprint: string; city: string; description: string }
    const claim = async () => {
      await db.exec('set role service_role')
      try { return (await db.query<{ result: Claim[] }>('select public.fishing_claim_spot_shares() result')).rows[0]!.result }
      finally { await db.exec('reset role') }
    }
    const finish = async (row: Claim, urls: string[]) => {
      await db.exec('set role service_role')
      try { return (await db.query<{ result: { applied: boolean; enqueued: number } }>('select public.fishing_finish_spot_shares($1,$2,$3,$4::jsonb) result',
        [row.id,row.lease,row.fingerprint,JSON.stringify(urls)])).rows[0]!.result }
      finally { await db.exec('reset role') }
    }
    let [row] = await claim()
    assert.deepEqual(Object.keys(row!).sort(),['id','lease','fingerprint','city','description'].sort())
    assert.equal((await claim()).length,0)
    await db.query("update public.fishing_spots set audience='private' where id=$1",[ids[3]])
    assert.equal((await finish(row!,['https://www.douyin.com/video/123456789'])).applied,false)
    assert.equal((await db.query('select * from fishing_private.queued')).rows.length,0)
    await db.query("update public.fishing_spots set audience='public' where id=$1",[ids[3]])
    ;[row] = await claim()
    await db.query('update public.fishing_spots set description=description||$2 where id=$1',[ids[3],' 已更新'])
    assert.equal((await finish(row!,[])).applied,false,'an older claimed description cannot be applied')
    ;[row] = await claim()
    await assert.rejects(finish(row!,['https://www.douyin.com.evil.test/video/123']), /INVALID_INPUT/)
    assert.equal((await finish(row!,['https://www.douyin.com/video/123456789'])).enqueued,1)
    assert.deepEqual((await db.query('select * from fishing_private.queued')).rows,[{ city:'武汉市',url:'https://www.douyin.com/video/123456789' }])
    assert.equal((await finish(row!,[])).applied,false,'completed claims cannot replay')
    assert.equal((await claim()).length,0)
    await db.query('delete from public.fishing_spots where id=$1',[ids[3]])
    assert.equal((await db.query('select * from fishing_private.spot_share_inbox')).rows.length,0)
  } finally { await db.close() }
})
