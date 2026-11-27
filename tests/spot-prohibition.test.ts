import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('current prohibitions cover boundaries and holes, block transactional writes, preserve corrections, and protect catalog reads', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      set timezone='Asia/Shanghai';
      create role anon;create role authenticated;create role service_role bypassrls;
      create schema fishing_private;grant usage on schema fishing_private to anon,authenticated,service_role;
      create table public.fishing_official_zones(id text primary key,title text,source_url text,boundary jsonb,bounds box,published boolean,valid_from date,valid_until date);
      create table public.fishing_zone_reports(id uuid primary key,title text,source_url text,boundary jsonb,fence_bounds box,status text,observed_on date,expires_on date);
      create table public.fishing_spots(id uuid primary key,name text,status text default 'published',audience text default 'public',precision text default 'exact',fishing_status text default 'allowed');
      create table public.spot_locations(spot_id uuid primary key references public.fishing_spots(id),longitude float8,latitude float8);
      create table public.fishing_spot_leads(id text primary key,card jsonb,catalog_status text,valid_until timestamptz);
      alter table public.fishing_spot_leads enable row level security;
      create policy fishing_spot_leads_verified on public.fishing_spot_leads for select to anon,authenticated using(catalog_status='published');
      grant select on public.fishing_spot_leads to anon,authenticated;
      create function fishing_private.zone_feedback_version(text,text) returns text language sql as $$select 'test-revision'::text$$;
      create function fishing_private.zone_feedback_state(text,text,text) returns jsonb language sql as $$select jsonb_build_object('released',coalesce(current_setting('test.community_released',true),'false')='true')$$;
      create function fishing_private.zones_read(text,jsonb) returns jsonb language sql as $$select '{"items":[],"released":[{"id":"official","source":"official","feedback":{"released":true}},{"id":"community","source":"community","feedback":{"released":true}}]}'::jsonb$$;
      create function public.fishing_zones_read(text,jsonb default '{}') returns jsonb language sql as $$select fishing_private.zones_read($1,$2)$$;
      insert into public.fishing_spots(id,name,fishing_status) values('11111111-1111-4111-8111-111111111111','existing public point','prohibited');
      insert into public.spot_locations values('11111111-1111-4111-8111-111111111111',117,31);
      insert into public.fishing_spots(id,name,fishing_status,audience) values('22222222-2222-4222-8222-222222222222','private point','prohibited','private');
      insert into public.spot_locations values('22222222-2222-4222-8222-222222222222',118,31);
    `)
    const files = await readdir(new URL('../supabase/migrations/', import.meta.url))
    const file = files.find(file => file.endsWith('_fishing_spot_prohibition_guard.sql'))!
    assert.ok(file)
    await db.exec(await readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'))
    const boundary = { type: 'Polygon', coordinates: [
      [[114,30],[114.1,30],[114.1,30.1],[114,30.1],[114,30]],
      [[114.04,30.04],[114.06,30.04],[114.06,30.06],[114.04,30.06],[114.04,30.04]]
    ] }
    await db.query(`insert into public.fishing_official_zones values('official','test official','https://test.gov.cn/notice/1',$1::jsonb,box(point(114,30),point(114.1,30.1)),true,current_date-1,null)`, [JSON.stringify(boundary)])
    const check = async (x: number, y: number) => (await db.query<{ value: { blocked: boolean; sources: { source: string; boundary_known: boolean }[] } }>('select public.fishing_spot_creation_check($1,$2) value', [x,y])).rows[0]!.value
    assert.equal((await check(114.02,30.02)).blocked, true)
    assert.equal((await check(114,30.05)).blocked, true)
    assert.equal((await check(114.05,30.05)).blocked, false)
    assert.equal((await check(114.04,30.05)).blocked, true)
    assert.equal((await check(114.2,30.2)).blocked, false)
    await db.exec('set role anon')
    assert.equal((await check(114.02,30.02)).blocked, true)
    await assert.rejects(db.query('select * from public.fishing_official_zones'), /permission denied/)
    await assert.rejects(check(0,0), /SPOT_LOCATION_REQUIRED/)
    assert.equal((await check(118,31)).blocked, false, 'private reminders are not disclosed through this public lookup')
    const point = await check(117,31)
    assert.equal(point.blocked, true)
    assert.equal(point.sources[0]!.boundary_known, false)
    assert.equal((await check(117.001,31)).blocked, false, 'a point reminder never invents a lake-wide restriction')
    await db.exec('reset role')
    await db.exec("update public.fishing_official_zones set valid_from=current_date+1")
    assert.equal((await check(114.02,30.02)).blocked, false)
    await db.exec("update public.fishing_official_zones set valid_from=current_date-2,valid_until=current_date-1")
    assert.equal((await check(114.02,30.02)).blocked, false)
    await db.exec("update public.fishing_official_zones set valid_until=null")
    await db.query(`insert into public.fishing_zone_reports values('33333333-3333-4333-8333-333333333333','community test','', $1::jsonb,box(point(119,32),point(119.1,32.1)),'published',current_date,current_date+1)`,[JSON.stringify({type:'Polygon',coordinates:[[[119,32],[119.1,32],[119.1,32.1],[119,32.1],[119,32]]]})])
    assert.equal((await check(119.02,32.02)).blocked,true)
    await db.exec("set test.community_released='true'")
    assert.equal((await check(119.02,32.02)).blocked,false)
    await db.exec("set test.community_released='false'; update public.fishing_zone_reports set expires_on=current_date-1")
    assert.equal((await check(119.02,32.02)).blocked,false)
    const createSpot = async (x: number,y: number,status='allowed') => {
      const id = crypto.randomUUID()
      try {
        await db.exec('begin')
        await db.query('insert into public.fishing_spots(id,name,fishing_status) values($1,$2,$3)',[id,'local test only',status])
        await db.query('insert into public.spot_locations values($1,$2,$3)',[id,x,y])
        await db.exec('commit')
        return id
      } catch (error) { await db.exec('rollback');throw error }
    }
    await assert.rejects(createSpot(114.02,30.02), /SPOT_LOCATION_PROHIBITED/)
    await assert.rejects(createSpot(114.02,30.02,'prohibited'), /SPOT_LOCATION_PROHIBITED/)
    assert.equal((await db.query('select count(*)::int n from public.fishing_spots')).rows[0]!.n, 2)
    const outside = await createSpot(114.2,30.2)
    try {
      await db.exec('begin')
      await db.query('update public.spot_locations set longitude=114.02,latitude=30.02 where spot_id=$1',[outside])
      await assert.rejects(db.exec('commit'), /SPOT_LOCATION_PROHIBITED/)
    } finally { await db.exec('rollback') }
    assert.equal((await db.query('select longitude from public.spot_locations where spot_id=$1',[outside])).rows[0]!.longitude,114.2)
    // Editing an existing record to prohibited stays available for map corrections.
    await db.query("update public.fishing_spots set fishing_status='prohibited' where id=$1",[outside])
    assert.equal((await check(114.2,30.2)).blocked,true)
    const card = (x: number,y: number) => JSON.stringify({ sourcePosition: { longitude:x,latitude:y,crs:'GCJ-02' } })
    await assert.rejects(db.query("insert into public.fishing_spot_leads values('blocked',$1,'published',now()+interval '1 day')",[card(114.02,30.02)]),/SPOT_LOCATION_PROHIBITED/)
    await db.query("insert into public.fishing_spot_leads values('visible',$1,'published',now()+interval '1 day')",[card(115,31)])
    await db.query("update public.fishing_official_zones set boundary=$1::jsonb,bounds=box(point(114.9,30.9),point(115.1,31.1))",[JSON.stringify({type:'Polygon',coordinates:[[[114.9,30.9],[115.1,30.9],[115.1,31.1],[114.9,31.1],[114.9,30.9]]]})])
    await db.exec('set role anon')
    assert.equal((await db.query('select * from public.fishing_spot_leads')).rows.length,0,'new bans also hide older catalog entries immediately')
    const map = (await db.query<{ value: { items: { source: string;feedback:{released:boolean;reported_release:boolean} }[];released: {source:string}[] } }>("select public.fishing_zones_read('nearby','{}') value")).rows[0]!.value
    assert.deepEqual(map.items.map(item=>item.source),['official'])
    assert.equal(map.items[0]!.feedback.released,false)
    assert.equal(map.items[0]!.feedback.reported_release,true)
    assert.deepEqual(map.released.map(item=>item.source),['community'])
  } finally { await db.close() }
})
