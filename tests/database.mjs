import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { moderationChecks } from './moderation.mjs'
import { authorChecks } from './author-content.mjs'
import { waterReportChecks } from './water-report.mjs'
import { zoneChecks } from './zones.mjs'
import { zoneFeedbackChecks } from './zone-feedback.mjs'
import { mapSpotChecks } from './map-spots.mjs'
import { contentReportChecks } from './content-reports.mjs'
import { chatAttachmentChecks } from './chat-attachments.mjs'
import { accountLoginLimitChecks } from './account-login-limits.mjs'
import { realtimeChecks } from './realtime.mjs'
import { tripCatchChecks } from './trip-catches.mjs'
import { commentChecks } from './comments.mjs'
import { commentModerationChecks } from './comment-moderation.mjs'
import { commentMediaChecks } from './comment-media.mjs'
import { notificationChecks } from './notifications.mjs'
import { compositionChecks } from './composition.mjs'
import { contentUpdateChecks } from './content-updates.mjs'
import { catchMeasurementChecks } from './catch-measurements.mjs'
import { publishingChecks } from './publishing.mjs'
import { spotPhotoChecks } from './spot-photos.mjs'
import { postPublicationChecks } from './post-publication.mjs'
import { profileAvatarChecks } from './profile-avatar.mjs'
import { spotPublicationChecks } from './spot-publication.mjs'
import { spotFishingChecks } from './spot-fishing.mjs'
import { spotDistanceChecks } from './spot-distance.mjs'
let publicationMigration, spotPublicationMigration, spotFishingMigration, communityPublicationMigration
const db = new PGlite()
const alice = '11111111-1111-4111-8111-111111111111',
  bob = '22222222-2222-4222-8222-222222222222',
  eve = '33333333-3333-4333-8333-333333333333'
const post = 'a1111111-1111-4111-8111-111111111111',
  spot = 'b1111111-1111-4111-8111-111111111111',
  trip = 'c1111111-1111-4111-8111-111111111111'
let assertions = 0
function check(value, message) {
  assert.ok(value, message)
  assertions++
  console.log(`PASS ${message}`)
}
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to anon,authenticated,service_role;
  grant execute on function auth.uid() to anon,authenticated,service_role;
  create schema storage;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon,authenticated,service_role;
  grant select on storage.objects to anon,authenticated;
  -- Test-only stand-in for the managed Realtime table/function. Does NOT simulate WAL delivery.
  create schema realtime;
  create table realtime.messages(id uuid primary key default gen_random_uuid(), payload jsonb,
    event text, topic text, private boolean default false, extension text);
  alter table realtime.messages enable row level security;
  grant usage on schema realtime to anon,authenticated,service_role;
  grant select,insert,update on realtime.messages to anon,authenticated,service_role;
  create function realtime.topic() returns text language sql stable as
    $$select current_setting('realtime.topic',true)$$;
  create function realtime.send(payload jsonb,event text,topic text,private boolean default true)
    returns void language sql as $$
      insert into realtime.messages(payload,event,topic,private,extension)
      values(payload,event,topic,private,'broadcast');
    $$;
`)
for (const file of (await readdir(new URL('../supabase/migrations/', import.meta.url)))
  .filter((f) => f.endsWith('.sql'))
  .sort()) {
  // Preserve migration-era review regressions, then exercise the current direct
  // publication policy and upgrade of real pre-policy records at the end.
  if (file.endsWith('_fishing_posts_direct_publish.sql')) {
    publicationMigration = await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')
    continue
  }
  if (file.endsWith('_fishing_spots_direct_publish_location.sql')) {
    spotPublicationMigration = await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')
    continue
  }
  if (file.endsWith('_fishing_spot_fishing_status.sql')) {
    spotFishingMigration = await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')
    continue
  }
  if (file.endsWith('_fishing_community_zones_direct_publish.sql')) {
    communityPublicationMigration = await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')
    continue
  }
  if (file.endsWith('_fishing_trip_catches.sql')) {
    await db.query('insert into auth.users(id) values($1)', [alice])
    await db.query(
      "insert into public.trips(id,owner_id,title,body,occurred_on,species,count,weight_kg) values($1,$2,'旧日志','升级前已保存','2026-11-19','鲫鱼',0,null)",
      [trip, alice]
    )
  }
  await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'))
  if (file.endsWith('_fishing_trip_catches.sql')) {
    const legacy = (
      await db.query(
        'select catch_records,count,weight_kg,revision from public.trips where id=$1',
        [trip]
      )
    ).rows[0]
    check(
      legacy.catch_records[0].count === 0 &&
        legacy.catch_records[0].weight_kg === null &&
        legacy.revision === 1,
      'migration upgrades an existing private log without changing zero, unknown or revision'
    )
    await db.query('delete from auth.users where id=$1', [alice])
    check(
      (
        await db.query(
          'select trip_id from fishing_private.trip_create_receipts where owner_id=$1',
          [alice]
        )
      ).rows.length === 0,
      'account deletion also removes private trip create receipts'
    )
  }
}
await db.query('insert into auth.users(id) values($1),($2),($3)', [alice, bob, eve])
async function as(user, task) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || ''])
  await db.exec(`set role ${user ? 'authenticated' : 'anon'}`)
  try {
    return await task()
  } finally {
    await db.exec('reset role')
  }
}
const rpc = (kind, action, payload = {}) =>
  db
    .query(`select public.fishing_${kind}($1,$2::jsonb) result`, [action, JSON.stringify(payload)])
    .then((r) => r.rows[0].result)
const read = (user, action, payload) => as(user, () => rpc('read', action, payload))
const write = (user, action, payload) => as(user, () => rpc('write', action, payload))
async function rejects(task, pattern, message) {
  await assert.rejects(task, pattern)
  assertions++
  console.log(`PASS ${message}`)
}
const base = {
  id: post,
  title: '芦苇边的鲫鱼',
  body: '测试鱼情',
  kind: 'catch',
  species: '鲫鱼',
  method: '台钓',
  bait: '蚯蚓',
  weight: '0',
  count: '0',
  occurred_on: '2026-11-19',
  location_label: '测试水域',
  location_longitude: 120.62,
  location_latitude: 31.32,
  audience: 'private',
  media: []
}
try {
  check(
    (await db.query('select count(*)::int n from public.profiles')).rows[0].n === 3,
    'auth user creates exactly one profile'
  )
  await accountLoginLimitChecks({ db, check, rejects, alice })
  const firstTicket = await write(alice, 'upload_ticket', {})
  const secondTicket = await write(alice, 'upload_ticket', {})
  check(
    /^[0-9a-f-]{36}$/.test(firstTicket) && firstTicket !== secondTicket,
    'new user can reserve upload tickets without ambiguous SQL columns'
  )
  await db.query(
    "insert into fishing_private.rate_events(user_id,action,created_at) select $1,'upload_ticket',now()-interval '2 minutes' from generate_series(1,98)",
    [alice]
  )
  await rejects(
    () => write(alice, 'upload_ticket', {}),
    /RATE_LIMIT/,
    'daily upload limit still denies the 101st ticket'
  )
  check(
    !!(await write(bob, 'upload_ticket', {})),
    'upload quota belongs to each user, not the whole community'
  )
  await db.query('delete from fishing_private.rate_events where user_id in ($1,$2)', [alice, bob])
  await rejects(
    () => write(null, 'save_post', base),
    /permission denied/,
    'anonymous cannot call write endpoint'
  )
  await write(alice, 'save_post', base)
  check(
    (await read(alice, 'post', { id: post })).post.weight_kg === 0,
    'zero catch weight remains zero, not null'
  )
  await rejects(
    () => read(bob, 'post', { id: post }),
    /NOT_FOUND/,
    'private post hidden from other users'
  )
  check(
    (await as(bob, () => db.query('select * from public.posts'))).rows.length === 0,
    'direct table read also enforces private post RLS'
  )
  await rejects(
    () => as(alice, () => db.query("update public.posts set status='published'")),
    /permission denied/,
    'client cannot self-approve through direct table update'
  )
  const shared = { ...base, id: 'a2222222-2222-4222-8222-222222222222', audience: 'public' }
  await write(alice, 'save_post', shared)
  check(
    (await read(null, 'feed', {})).items.length === 0,
    'pending public post is not visible to visitors'
  )
  await rejects(
    () =>
      write(alice, 'moderate', {
        id: shared.id,
        type: 'post',
        decision: 'published',
        reason: 'review'
      }),
    /FORBIDDEN/,
    'author cannot grant themselves moderation authority'
  )
  await db.query('insert into fishing_private.moderators values($1)', [eve])
  await write(eve, 'moderate', {
    id: shared.id,
    type: 'post',
    decision: 'published',
    reason: 'test approval',
    revision: 1,
    request_id: crypto.randomUUID()
  })
  check((await read(null, 'feed', {})).items.length === 1, 'approved public post visible to guests')
  await write(bob, 'reaction', { id: shared.id, kind: 'like', enabled: true })
  await write(bob, 'reaction', { id: shared.id, kind: 'like', enabled: true })
  check(
    (await read(null, 'post', { id: shared.id })).post.like_count === 1,
    'repeated desired-state like is idempotent'
  )
  await rejects(
    () => write(bob, 'save_post', base),
    /FORBIDDEN/,
    'idempotency key cannot overwrite another author'
  )
  await write(alice, 'save_trip', { ...base, id: trip })
  check((await read(bob, 'library', {})).trips.length === 0, 'trip is owner-only')
  await rejects(
    () => write(alice, 'conversation', { id: bob }),
    /NOT_FRIENDS/,
    'non-friends cannot create a conversation'
  )
  await write(alice, 'friend_request', { id: bob, note: '交流鱼情' })
  await write(bob, 'friend_request', { id: alice, note: '你好' })
  const requests = (await read(bob, 'social', {})).requests
  check(requests.length === 1, 'crossed friend requests share a single pending pair')
  await rejects(
    () => write(eve, 'friend_respond', { id: requests[0].id, accept: true }),
    /FORBIDDEN/,
    'third party cannot accept a friend request'
  )
  await write(bob, 'friend_respond', { id: requests[0].id, accept: true })
  const conversation = await write(alice, 'conversation', { id: bob })
  check(
    conversation === (await write(bob, 'conversation', { id: alice })),
    'two users get the same canonical conversation'
  )
  const msg = {
    conversation_id: conversation,
    client_id: 'd1111111-1111-4111-8111-111111111111',
    body: '明天去水边吗？'
  }
  const first = await write(alice, 'send_message', msg),
    duplicate = await write(alice, 'send_message', msg)
  check(
    first.id === duplicate.id && first.sequence === 1,
    'retry keeps the same message and sequence'
  )
  await rejects(
    () => read(eve, 'messages', { id: conversation }),
    /FORBIDDEN/,
    'nonmember cannot read message RPC'
  )
  check(
    (await as(eve, () => db.query('select * from public.messages'))).rows.length === 0,
    'nonmember cannot bypass message RLS'
  )
  await write(bob, 'read_conversation', { id: conversation, sequence: 9999 })
  await write(bob, 'read_conversation', { id: conversation, sequence: 0 })
  check(
    (await read(bob, 'social', {})).conversations[0].unread === 0,
    'read cursor is monotone and clamped to persisted sequence'
  )
  await write(alice, 'save_spot', {
    id: spot,
    name: '私人草窝',
    city: '苏州',
    water_type: '自然水域',
    species: '鲫鱼',
    description: '记录',
    fee_note: '未核实',
    observed_on: '2026-11-19',
    audience: 'public',
    precision: 'area',
    longitude: 120.523456,
    latitude: 31.287654,
    access_note: '私人入口精确说明'
  })
  await write(eve, 'moderate', {
    id: spot,
    type: 'spot',
    decision: 'published',
    reason: 'test',
    revision: 1,
    request_id: crypto.randomUUID()
  })
  const publicSpot = await read(bob, 'spot', { id: spot })
  check(
    publicSpot.longitude === 120.52 &&
      publicSpot.latitude === 31.28 &&
      publicSpot.access_note === '',
    'area projection rounds coordinates and strips arrival instructions'
  )
  check(
    (await as(bob, () => db.query('select * from public.spot_locations'))).rows.length === 0,
    'public viewers cannot read raw exact coordinates'
  )
  check(
    (await read(alice, 'spot', { id: spot })).longitude === 120.523456,
    'owner can recover their exact coordinates'
  )
  const media = 'f1111111-1111-4111-8111-111111111111'
  await db.query(
    'insert into public.media_assets(id,owner_id,path,width,height,post_id) values($1,$2,$3,800,600,$4)',
    [media, alice, `${alice}/${media}.jpg`, shared.id]
  )
  await db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [
    'fishing-media',
    `${alice}/${media}.jpg`
  ])
  check(
    (await as(bob, () => db.query('select * from storage.objects'))).rows.length === 1,
    'public parent authorizes private-bucket media read'
  )
  await write(alice, 'block', { id: bob, enabled: true })
  await rejects(
    () => write(bob, 'send_message', { ...msg, client_id: 'd2222222-2222-4222-8222-222222222222' }),
    /NOT_FRIENDS/,
    'blocking immediately stops new messages'
  )
  check(
    (await read(bob, 'messages', { id: conversation })).length === 1,
    'existing members retain authorized history after block'
  )
  check(
    (await as(bob, () => db.query('select * from storage.objects'))).rows.length === 0,
    'block also revokes new media access'
  )
  check((await read(bob, 'feed', {})).items.length === 0, 'block removes author content from feed')
  await write(alice, 'block', { id: bob, enabled: false })
  check(
    (await read(alice, 'social', {})).friends.length === 0,
    'unblocking does not silently restore friendship'
  )
  await write(alice, 'delete_content', { id: shared.id, type: 'post' })
  check(
    (await read(null, 'feed', {})).items.length === 0,
    'deleted post disappears from public reads'
  )
  check(
    (await as(null, () => db.query('select * from storage.objects'))).rows.length === 0,
    'deleted parent revokes new storage access'
  )
  const exposed = await db.query(
    "select tablename from pg_tables where schemaname='public' and not rowsecurity"
  )
  check(exposed.rows.length === 0, 'all public business tables enable RLS')
  await db.query(
    "insert into public.messages(conversation_id,sender_id,client_id,sequence,body) select $1::uuid,$2::uuid,gen_random_uuid(),n,'history' from generate_series(2,106)n",
    [conversation, alice]
  )
  await db.query('update public.conversations set next_sequence=106 where id=$1', [conversation])
  const recent = await read(bob, 'messages', { id: conversation })
  check(
    recent.length === 100 && recent[0].sequence === 7 && recent.at(-1).sequence === 106,
    'initial conversation loads the latest page, not the oldest page'
  )
  const older = await read(bob, 'messages', { id: conversation, before: 7 })
  check(
    older.length === 6 && older[0].sequence === 1 && older.at(-1).sequence === 6,
    'older message pages preserve stable sequence order'
  )
  const incremental = await read(bob, 'messages', { id: conversation, after: 104 })
  check(
    incremental.length === 2 && incremental[0].sequence === 105,
    'foreground catch-up returns only newer messages'
  )
  await db.query(
    'insert into public.media_assets(owner_id,path,width,height,trip_id) values($1,$2,100,100,$3)',
    [alice, `${alice}/trip.jpg`, trip]
  )
  await db.query("insert into storage.objects(bucket_id,name) values('fishing-media',$1)", [
    `${alice}/trip.jpg`
  ])
  check(
    (await read(alice, 'library', { type: 'trips' })).trips[0].media.length === 1,
    'private trip recovers its uploaded photo metadata'
  )
  check(
    (
      await as(bob, () =>
        db.query('select * from storage.objects where name=$1', [`${alice}/trip.jpg`])
      )
    ).rows.length === 0,
    'private trip photos are not readable by another member'
  )
  const mapTicket = (user) => as(user, () => db.query('select public.fishing_map_ticket() result'))
  await rejects(() => mapTicket(null), /permission denied/, 'anonymous cannot spend AMap quota')
  await rejects(
    () => mapTicket('44444444-4444-4444-8444-444444444444'),
    /NOT_AUTHENTICATED/,
    'deleted or absent user cannot reserve map quota'
  )
  for (let i = 0; i < 20; i++) await mapTicket(alice)
  await rejects(
    () => mapTicket(alice),
    /RATE_LIMIT/,
    'per-user map minute quota cannot be exceeded'
  )
  check((await mapTicket(bob)).rows[0].result.ok, 'another user has an independent minute quota')
  await db.exec("delete from fishing_private.rate_events where action='amap'")
  await db.query(
    "insert into fishing_private.rate_events(user_id,action,created_at) select $1::uuid,'amap',now()-interval '2 hours' from generate_series(1,120)",
    [alice]
  )
  await rejects(() => mapTicket(alice), /RATE_LIMIT/, 'per-user map rolling day quota is enforced')
  await db.exec("delete from fishing_private.rate_events where action='amap'")
  await db.query(
    "insert into fishing_private.rate_events(user_id,action,created_at) select $1::uuid,'amap',now()-interval '2 hours' from generate_series(1,1000)",
    [eve]
  )
  await rejects(() => mapTicket(bob), /RATE_LIMIT/, 'project-wide map rolling day cap is enforced')
  await db.exec(
    "update fishing_private.rate_events set created_at=now()-interval '2 days' where action='amap'"
  )
  await mapTicket(alice)
  check(
    (await db.query("select count(*)::int n from fishing_private.rate_events where action='amap'"))
      .rows[0].n === 1,
    'expired map quota is cleaned and recovers'
  )
  await moderationChecks({ db, as, rpc, read, write, check, rejects, alice, bob, eve, base })
  await contentReportChecks({ db, as, rpc, read, write, check, rejects, alice, bob, eve, base })
  await authorChecks({ db, as, read, write, check, rejects, alice, bob, eve, base })
  await compositionChecks({ db, as, read, write, check, rejects, alice, bob, eve, base })
  await tripCatchChecks({ db, as, read, write, check, rejects, alice, bob, eve, base })
  await commentChecks({ db, as, read, write, check, rejects, alice, bob, eve, base })
  await commentModerationChecks({ db, as, rpc, read, write, check, rejects, base })
  await commentMediaChecks({ db, as, rpc, read, write, check, rejects, base })
  await waterReportChecks({ db, as, read, write, check, rejects, alice, bob, eve, base })
  await zoneChecks({ db, as, check, rejects, alice, bob, eve })
  await zoneFeedbackChecks({ db, as, check, rejects, alice })
  await mapSpotChecks({ db, as, check, rejects, alice, bob })
  await chatAttachmentChecks({ db, as, read, write, check, rejects, alice, bob, eve, base })
  await realtimeChecks({ db, as, read, write, check, rejects, alice, bob, eve })
  await notificationChecks({ db, as, rpc, read, write, check, rejects, base })
  await contentUpdateChecks({ db, as, rpc, read, write, check, rejects, base })
  await catchMeasurementChecks({ db, as, rpc, read, write, check, rejects, base })
  await publishingChecks({ db, as, rpc, read, write, check, rejects, base })
  await spotPhotoChecks({ db, as, rpc, read, write, check, rejects, base })
  check(Boolean(publicationMigration), 'direct publication migration is present')
  await postPublicationChecks({ db, as, rpc, read, write, check, rejects, base, migration: publicationMigration })
  check(Boolean(spotPublicationMigration), 'spot direct publication migration is present')
  await spotPublicationChecks({ db, as, rpc, read, write, check, rejects, migration: spotPublicationMigration })
  await spotFishingChecks({ db, as, read, write, check, rejects, migration: spotFishingMigration, communityMigration: communityPublicationMigration })
  await spotDistanceChecks({ db, read, check, rejects })
  await profileAvatarChecks({ db, as, read, write, check, rejects, base })
  console.log(
    `\n${assertions} database checks passed (PGlite PostgreSQL; not a hosted Supabase integration test).`
  )
} finally {
  await db.close()
}
