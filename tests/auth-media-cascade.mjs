import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'
const db = new PGlite()
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;
    create schema auth; create schema fishing_private;
    create table auth.users(id uuid primary key);
    create table public.media_assets(id uuid primary key,owner_id uuid not null references auth.users(id) on delete cascade,path text not null unique);
    grant usage on schema auth to supabase_auth_admin; grant delete,select on auth.users to supabase_auth_admin;`)
  const root = new URL('../supabase/migrations/', import.meta.url), files = await readdir(root)
  for (const suffix of ['_fishing_media_cleanup_queue.sql', '_fishing_media_cascade_compatibility.sql'])
    await db.exec(await readFile(new URL(files.find(x => x.endsWith(suffix)),root),'utf8'))
  const owner = '11111111-1111-4111-8111-111111111111', asset = '22222222-2222-4222-8222-222222222222'
  await db.query('insert into auth.users values($1)',[owner])
  await db.query('insert into public.media_assets values($1,$2,$3)',[asset,owner,`${owner}/${asset}.mp4`])
  await db.exec('begin;set local role supabase_auth_admin')
  await db.query('delete from auth.users where id=$1',[owner])
  await db.exec('commit')
  assert.equal((await db.query('select count(*)::int n from public.media_assets')).rows[0].n,0)
  assert.equal((await db.query('select state from fishing_private.media_deletions where id=$1',[asset])).rows[0].state,'pending')
  assert.equal((await db.query("select has_schema_privilege('supabase_auth_admin','fishing_private','usage') allowed")).rows[0].allowed,false)
  console.log('3 auth cascade checks passed: Auth can delete owned media without private-schema access; committed deletion is queued.')
} finally { await db.close() }
