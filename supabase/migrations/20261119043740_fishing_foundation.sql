-- 钓友集 foundation. Apply only after inspecting the target project.
-- All writes go through an authenticated, explicitly authorized command boundary.
-- The private schema MUST NOT be added to the Data API exposed schemas.
create schema if not exists fishing_private;
revoke all on schema fishing_private from public;
grant usage on schema fishing_private to anon, authenticated, service_role;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text not null unique default ('DY' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
  nickname text not null default '水边的钓友' check (length(nickname) between 1 and 30),
  city text not null default '' check (length(city)<=40),
  bio text not null default '' check (length(bio)<=200),
  method text not null default '' check (length(method)<=40),
  created_at timestamptz not null default now()
);
create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(follower_id,followed_id), check(follower_id<>followed_id)
);
create index follows_target_idx on public.follows(followed_id);
create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(blocker_id,blocked_id), check(blocker_id<>blocked_id)
);
create index blocks_target_idx on public.blocks(blocked_id);
create table public.friendships (
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(user_a,user_b), check(user_a<user_b)
);
create index friendships_b_idx on public.friendships(user_b);
create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  note text not null default '' check(length(note)<=200),
  status text not null default 'pending' check(status in ('pending','accepted','rejected','cancelled','expired')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(sender_id<>recipient_id)
);
create unique index friend_requests_pending_pair_idx on public.friend_requests(least(sender_id,recipient_id),greatest(sender_id,recipient_id)) where status='pending';
create index friend_requests_recipient_idx on public.friend_requests(recipient_id,created_at desc);
create index friend_requests_sender_idx on public.friend_requests(sender_id,created_at desc);
create table public.posts (
  id uuid primary key, author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check(length(title) between 1 and 60), body text not null check(length(body) between 1 and 2000),
  kind text not null check(kind in ('catch','experience')), species text not null default '' check(length(species)<=60),
  method text not null default '' check(length(method)<=40), bait text not null default '' check(length(bait)<=60),
  weight_kg numeric(10,3) check(weight_kg between 0 and 10000), occurred_on date not null,
  location_label text not null default '' check(length(location_label)<=80),
  audience text not null default 'private' check(audience in ('public','friends','private')),
  status text not null default 'pending' check(status in ('pending','published','rejected','hidden','deleted')),
  created_at timestamptz not null default now()
);
create index posts_feed_idx on public.posts(created_at desc,id desc) where status='published';
create index posts_author_idx on public.posts(author_id,created_at desc);
create table public.comments (
  id uuid primary key, post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check(length(body) between 1 and 500), created_at timestamptz not null default now()
);
create index comments_post_idx on public.comments(post_id,created_at,id);
create index comments_author_idx on public.comments(author_id);
create table public.post_likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade, primary key(user_id,post_id)
);
create index post_likes_post_idx on public.post_likes(post_id);
create table public.post_bookmarks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade, created_at timestamptz not null default now(), primary key(user_id,post_id)
);
create index post_bookmarks_post_idx on public.post_bookmarks(post_id);
create table public.fishing_spots (
  id uuid primary key, author_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check(length(name) between 1 and 60), city text not null check(length(city) between 1 and 40),
  water_type text not null check(water_type in ('自然水域','水库','钓场','其他')),
  species text not null default '' check(length(species)<=60), description text not null default '' check(length(description)<=1000),
  fee_note text not null default '未核实' check(length(fee_note)<=200), observed_on date not null,
  audience text not null default 'private' check(audience in ('public','friends','private')),
  precision text not null default 'hidden' check(precision in ('exact','area','hidden')),
  status text not null default 'pending' check(status in ('pending','published','rejected','hidden','deleted')),
  created_at timestamptz not null default now()
);
create index spots_city_idx on public.fishing_spots(city,created_at desc,id desc) where status='published';
create index spots_author_idx on public.fishing_spots(author_id);
create table public.spot_locations (
  spot_id uuid primary key references public.fishing_spots(id) on delete cascade,
  longitude double precision not null check(longitude between -180 and 180),
  latitude double precision not null check(latitude between -90 and 90),
  crs text not null default 'GCJ-02' check(crs='GCJ-02'),
  access_note text not null default '' check(length(access_note)<=500)
);
create table public.spot_bookmarks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  spot_id uuid not null references public.fishing_spots(id) on delete cascade, primary key(user_id,spot_id)
);
create index spot_bookmarks_spot_idx on public.spot_bookmarks(spot_id);
create table public.trips (
  id uuid primary key, owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check(length(title) between 1 and 60), body text not null check(length(body) between 1 and 2000),
  occurred_on date not null, species text not null default '' check(length(species)<=60),
  method text not null default '' check(length(method)<=40), bait text not null default '' check(length(bait)<=60),
  weight_kg numeric(10,3) check(weight_kg between 0 and 10000), count integer check(count between 0 and 10000),
  created_at timestamptz not null default now()
);
create index trips_owner_idx on public.trips(owner_id,occurred_on desc,id desc);
create table public.media_assets (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  path text not null unique, width integer not null check(width>0), height integer not null check(height>0),
  post_id uuid references public.posts(id) on delete cascade, trip_id uuid references public.trips(id) on delete cascade,
  created_at timestamptz not null default now(), check(num_nonnulls(post_id,trip_id)<=1)
);
create index media_owner_idx on public.media_assets(owner_id);
create index media_post_idx on public.media_assets(post_id);
create index media_trip_idx on public.media_assets(trip_id);
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  next_sequence bigint not null default 0, created_at timestamptz not null default now(), unique(user_a,user_b), check(user_a<user_b)
);
create index conversations_b_idx on public.conversations(user_b);
create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_sequence bigint not null default 0 check(last_read_sequence>=0), primary key(conversation_id,user_id)
);
create index conversation_members_user_idx on public.conversation_members(user_id);
create table public.messages (
  id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade, client_id uuid not null,
  sequence bigint not null, body text not null check(length(body) between 1 and 2000), created_at timestamptz not null default now(),
  unique(sender_id,client_id), unique(conversation_id,sequence)
);
create table public.content_reports (
  id uuid primary key default gen_random_uuid(), reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check(target_type in ('post','spot','profile')), target_id uuid not null,
  reason text not null check(length(reason) between 1 and 500), status text not null default 'pending',
  created_at timestamptz not null default now(), unique(reporter_id,target_type,target_id)
);
create index content_reports_queue_idx on public.content_reports(status,created_at);
create table fishing_private.moderators (user_id uuid primary key references auth.users(id) on delete cascade);
create table fishing_private.moderation_actions (
  id bigint generated always as identity primary key, moderator_id uuid not null,
  target_type text not null, target_id uuid not null, decision text not null, reason text not null, created_at timestamptz not null default now()
);
create table fishing_private.rate_events (user_id uuid not null, action text not null, created_at timestamptz not null default now());
create index rate_events_user_idx on fishing_private.rate_events(user_id,created_at);
alter table fishing_private.moderators enable row level security;
alter table fishing_private.moderation_actions enable row level security;
alter table fishing_private.rate_events enable row level security;

create function fishing_private.bootstrap_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.profiles(id) values(new.id) on conflict(id) do nothing; return new; end $$;
create trigger fishing_new_user after insert on auth.users for each row execute function fishing_private.bootstrap_profile();
insert into public.profiles(id) select id from auth.users on conflict(id) do nothing;

create function fishing_private.is_blocked(a uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.blocks where (blocker_id=a and blocked_id=b) or (blocker_id=b and blocked_id=a));
$$;
create function fishing_private.are_friends(a uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
  select a is not null and b is not null and not fishing_private.is_blocked(a,b)
    and exists(select 1 from public.friendships where user_a=least(a,b) and user_b=greatest(a,b));
$$;
create function fishing_private.can_view(author uuid,audience text) returns boolean language sql stable security definer set search_path='' as $$
  select author=(select auth.uid()) or (not fishing_private.is_blocked(author,(select auth.uid()))
    and (audience='public' or (audience='friends' and fishing_private.are_friends(author,(select auth.uid())))));
$$;
create function fishing_private.can_view_post(target uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.posts p where p.id=target and p.status<>'deleted' and
    (p.author_id=(select auth.uid()) or (p.status='published' and fishing_private.can_view(p.author_id,p.audience))));
$$;
create function fishing_private.can_view_spot(target uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.fishing_spots s where s.id=target and s.status<>'deleted' and
    (s.author_id=(select auth.uid()) or (s.status='published' and fishing_private.can_view(s.author_id,s.audience))));
$$;
create function fishing_private.is_member(target uuid) returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and exists(select 1 from public.conversation_members where conversation_id=target and user_id=(select auth.uid()));
$$;
create function fishing_private.can_view_media(target uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.media_assets m where m.id=target and
    (m.owner_id=(select auth.uid()) or (m.post_id is not null and fishing_private.can_view_post(m.post_id))));
$$;

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_bookmarks enable row level security;
alter table public.follows enable row level security;
alter table public.blocks enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.fishing_spots enable row level security;
alter table public.spot_locations enable row level security;
alter table public.spot_bookmarks enable row level security;
alter table public.trips enable row level security;
alter table public.media_assets enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.content_reports enable row level security;
create policy profiles_read on public.profiles for select to anon,authenticated using(not fishing_private.is_blocked(id,(select auth.uid())));
create policy posts_read on public.posts for select to anon,authenticated using(fishing_private.can_view_post(id));
create policy comments_read on public.comments for select to anon,authenticated using(fishing_private.can_view_post(post_id) and not fishing_private.is_blocked(author_id,(select auth.uid())));
create policy likes_read on public.post_likes for select to authenticated using(user_id=(select auth.uid()) and fishing_private.can_view_post(post_id));
create policy post_bookmarks_read on public.post_bookmarks for select to authenticated using(user_id=(select auth.uid()) and fishing_private.can_view_post(post_id));
create policy follows_read on public.follows for select to authenticated using(follower_id=(select auth.uid()));
create policy blocks_read on public.blocks for select to authenticated using(blocker_id=(select auth.uid()));
create policy requests_read on public.friend_requests for select to authenticated using((select auth.uid()) in (sender_id,recipient_id));
create policy friendships_read on public.friendships for select to authenticated using((select auth.uid()) in (user_a,user_b));
create policy spots_read on public.fishing_spots for select to anon,authenticated using(fishing_private.can_view_spot(id));
-- Never expose raw exact coordinates to non-owners, even for public spots. Use the safe RPC projection.
create policy spot_locations_owner on public.spot_locations for select to authenticated using(exists(select 1 from public.fishing_spots s where s.id=spot_id and s.author_id=(select auth.uid())));
create policy spot_bookmarks_read on public.spot_bookmarks for select to authenticated using(user_id=(select auth.uid()) and fishing_private.can_view_spot(spot_id));
create policy trips_owner on public.trips for select to authenticated using(owner_id=(select auth.uid()));
create policy media_read on public.media_assets for select to anon,authenticated using(fishing_private.can_view_media(id));
create policy conversations_read on public.conversations for select to authenticated using(fishing_private.is_member(id));
create policy members_read on public.conversation_members for select to authenticated using(fishing_private.is_member(conversation_id));
create policy messages_read on public.messages for select to authenticated using(fishing_private.is_member(conversation_id));
create policy reports_read on public.content_reports for select to authenticated using(reporter_id=(select auth.uid()));

revoke all on public.profiles,public.posts,public.comments,public.post_likes,public.post_bookmarks,public.follows,public.blocks,public.friend_requests,public.friendships,public.fishing_spots,public.spot_locations,public.spot_bookmarks,public.trips,public.media_assets,public.conversations,public.conversation_members,public.messages,public.content_reports from anon,authenticated;
grant select on public.profiles,public.posts,public.comments,public.fishing_spots,public.media_assets to anon,authenticated;
grant select on public.post_likes,public.post_bookmarks,public.follows,public.blocks,public.friend_requests,public.friendships,public.spot_locations,public.spot_bookmarks,public.trips,public.conversations,public.conversation_members,public.messages,public.content_reports to authenticated;
grant all on public.profiles,public.posts,public.comments,public.post_likes,public.post_bookmarks,public.follows,public.blocks,public.friend_requests,public.friendships,public.fishing_spots,public.spot_locations,public.spot_bookmarks,public.trips,public.media_assets,public.conversations,public.conversation_members,public.messages,public.content_reports to service_role;

create function fishing_private.profile_json(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',p.id,'nickname',p.nickname,'handle',p.handle,'city',p.city,'bio',p.bio,'method',p.method) from public.profiles p where p.id=target;
$$;
create function fishing_private.post_json(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select (to_jsonb(p)-'author_id') || jsonb_build_object('author',fishing_private.profile_json(p.author_id),
    'like_count',(select count(*) from public.post_likes l where l.post_id=p.id),
    'comment_count',(select count(*) from public.comments c where c.post_id=p.id and not fishing_private.is_blocked(c.author_id,(select auth.uid()))),
    'liked',exists(select 1 from public.post_likes l where l.post_id=p.id and l.user_id=(select auth.uid())),
    'saved',exists(select 1 from public.post_bookmarks b where b.post_id=p.id and b.user_id=(select auth.uid())),
    'media',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'path',m.path,'width',m.width,'height',m.height) order by m.created_at,m.id) from public.media_assets m where m.post_id=p.id),'[]'::jsonb))
  from public.posts p where p.id=target and fishing_private.can_view_post(p.id);
$$;
create function fishing_private.spot_json(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select (to_jsonb(s)-'author_id') || jsonb_build_object('author',fishing_private.profile_json(s.author_id),
    'longitude',case when s.author_id=(select auth.uid()) or s.precision='exact' then l.longitude when s.precision='area' then round(l.longitude::numeric/.02)*.02 else null end,
    'latitude',case when s.author_id=(select auth.uid()) or s.precision='exact' then l.latitude when s.precision='area' then round(l.latitude::numeric/.02)*.02 else null end,
    'access_note',case when s.author_id=(select auth.uid()) or s.precision='exact' then coalesce(l.access_note,'') else '' end,
    'saved',exists(select 1 from public.spot_bookmarks b where b.spot_id=s.id and b.user_id=(select auth.uid())))
  from public.fishing_spots s left join public.spot_locations l on l.spot_id=s.id where s.id=target and fishing_private.can_view_spot(s.id);
$$;
create function fishing_private.trip_json(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select (to_jsonb(t)-'owner_id') || jsonb_build_object('media',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'path',m.path,'width',m.width,'height',m.height) order by m.created_at,m.id) from public.media_assets m where m.trip_id=t.id),'[]'::jsonb))
  from public.trips t where t.id=target and t.owner_id=(select auth.uid());
$$;

create function fishing_private.read_api(action text,payload jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); target uuid:=nullif(payload->>'id','')::uuid; result jsonb; items jsonb; next_cursor text; cursor_time timestamptz; cursor_id uuid;
begin
  if action in ('social','messages','library') and uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  case action
  when 'feed' then
    if coalesce(payload->>'cursor','')<>'' then cursor_time:=split_part(payload->>'cursor','|',1)::timestamptz;cursor_id:=split_part(payload->>'cursor','|',2)::uuid;end if;
    with candidates as (
      select p.id,p.created_at from public.posts p join public.profiles author on author.id=p.author_id
      where p.status='published' and fishing_private.can_view_post(p.id)
        and (cursor_time is null or (p.created_at,p.id)<(cursor_time,cursor_id))
        and (p.title||p.body||p.species) ilike '%'||left(coalesce(payload->>'query',''),100)||'%'
        and (coalesce(payload->>'filter','')<>'following' or exists(select 1 from public.follows f where f.follower_id=uid and f.followed_id=p.author_id))
        and (coalesce(payload->>'filter','')<>'city' or author.city=coalesce(payload->>'city',''))
      order by p.created_at desc,p.id desc limit 13
    ), numbered as(select *,row_number() over(order by created_at desc,id desc) n from candidates)
    select coalesce(jsonb_agg(fishing_private.post_json(id) order by created_at desc,id desc) filter(where n<=12),'[]'::jsonb),
      case when count(*)>12 then max(created_at::text||'|'||id::text) filter(where n=12) else null end into items,next_cursor from numbered;
    return jsonb_build_object('items',items,'next',next_cursor);
  when 'post' then
    result:=fishing_private.post_json(target);if result is null then raise exception 'NOT_FOUND';end if;
    select coalesce(jsonb_agg((to_jsonb(c)-'author_id')||jsonb_build_object('author',fishing_private.profile_json(c.author_id)) order by c.created_at,c.id),'[]'::jsonb) into items from (select * from public.comments where post_id=target and not fishing_private.is_blocked(author_id,uid) order by created_at desc,id desc limit 100)c;
    return jsonb_build_object('post',result,'comments',items);
  when 'spots' then
    select coalesce(jsonb_agg(fishing_private.spot_json(s.id) order by s.created_at desc,s.id desc),'[]'::jsonb) into items from
      (select * from public.fishing_spots s where fishing_private.can_view_spot(s.id)
      and (s.name||s.city||s.species) ilike '%'||left(coalesce(payload->>'query',''),100)||'%'
      and (coalesce(payload->>'type','')='' or s.water_type=payload->>'type') order by s.created_at desc,s.id desc limit 100)s;
    return jsonb_build_object('items',items,'next',null);
  when 'spot' then result:=fishing_private.spot_json(target);if result is null then raise exception 'NOT_FOUND';end if;return result;
  when 'people' then
    select coalesce(jsonb_agg(fishing_private.profile_json(p.id) order by p.created_at desc),'[]'::jsonb) into result from
      (select * from public.profiles where id is distinct from uid and not fishing_private.is_blocked(id,uid)
      and (nickname||handle||city) ilike '%'||left(coalesce(payload->>'query',''),100)||'%' order by created_at desc limit 50)p;return result;
  when 'profile' then
    target:=coalesce(target,uid);result:=fishing_private.profile_json(target);if result is null then raise exception 'NOT_FOUND';end if;
    select coalesce(jsonb_agg(fishing_private.post_json(p.id) order by p.created_at desc),'[]'::jsonb) into items from (select * from public.posts where author_id=target and fishing_private.can_view_post(id) order by created_at desc limit 30)p;
    return jsonb_build_object('profile',result,'following',exists(select 1 from public.follows where follower_id=uid and followed_id=target),'friend',fishing_private.are_friends(uid,target),'blocked',exists(select 1 from public.blocks where blocker_id=uid and blocked_id=target),'posts',items);
  when 'social' then
    return jsonb_build_object(
      'friends',coalesce((select jsonb_agg(fishing_private.profile_json(case when user_a=uid then user_b else user_a end)) from public.friendships where uid in(user_a,user_b)),'[]'::jsonb),
      'requests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'sender',fishing_private.profile_json(r.sender_id),'recipient',fishing_private.profile_json(r.recipient_id),'note',r.note,'status',r.status,'created_at',r.created_at) order by r.created_at desc) from public.friend_requests r where uid in(r.sender_id,r.recipient_id) and r.status='pending'),'[]'::jsonb),
      'conversations',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'peer',fishing_private.profile_json(case when c.user_a=uid then c.user_b else c.user_a end),
        'last_message',coalesce((select body from public.messages where conversation_id=c.id order by sequence desc limit 1),''),
        'last_at',coalesce((select created_at from public.messages where conversation_id=c.id order by sequence desc limit 1),c.created_at),
        'unread',(select count(*) from public.messages where conversation_id=c.id and sender_id<>uid and sequence>cm.last_read_sequence),
        'can_send',fishing_private.are_friends(c.user_a,c.user_b)) order by c.created_at desc) from public.conversations c join public.conversation_members cm on cm.conversation_id=c.id and cm.user_id=uid),'[]'::jsonb));
  when 'messages' then
    if not fishing_private.is_member(target) then raise exception 'FORBIDDEN';end if;
    if payload ? 'after' then
      select coalesce(jsonb_agg(to_jsonb(m) order by sequence),'[]'::jsonb) into result from (select * from public.messages where conversation_id=target and sequence>greatest(0,(payload->>'after')::bigint) order by sequence limit 100)m;
    else
      select coalesce(jsonb_agg(to_jsonb(m) order by sequence),'[]'::jsonb) into result from (select * from public.messages where conversation_id=target and sequence<coalesce((payload->>'before')::bigint,9223372036854775807) order by sequence desc limit 100)m;
    end if;return result;
  when 'library' then
    return jsonb_build_object(
      'posts',coalesce((select jsonb_agg(fishing_private.post_json(p.id) order by p.created_at desc) from (select * from public.posts p where fishing_private.can_view_post(p.id) and
        (case when payload->>'type'='saved' then exists(select 1 from public.post_bookmarks b where b.post_id=p.id and b.user_id=uid) else p.author_id=uid end) order by created_at desc limit 100)p),'[]'::jsonb),
      'trips',coalesce((select jsonb_agg(fishing_private.trip_json(t.id) order by t.occurred_on desc) from (select * from public.trips where owner_id=uid order by occurred_on desc limit 100)t),'[]'::jsonb),
      'spots',coalesce((select jsonb_agg(fishing_private.spot_json(s.id) order by s.created_at desc) from (select * from public.fishing_spots s where fishing_private.can_view_spot(s.id) and
        (case when payload->>'type'='saved' then exists(select 1 from public.spot_bookmarks b where b.spot_id=s.id and b.user_id=uid) else s.author_id=uid end) order by created_at desc limit 100)s),'[]'::jsonb));
  else raise exception 'INVALID_INPUT';
  end case;
end $$;

create function fishing_private.write_api(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();target uuid:=nullif(payload->>'id','')::uuid;other uuid;request_row public.friend_requests;conversation public.conversations;message public.messages;item jsonb;result jsonb;desired boolean:=coalesce((payload->>'enabled')::boolean,false);seq bigint;scope text;
begin
  if uid is null or not exists(select 1 from public.profiles where id=uid) then raise exception 'NOT_AUTHENTICATED';end if;
  -- Serialize this user's rate counter. Pair locks below also synchronize blocks and sends.
  perform pg_advisory_xact_lock(hashtextextended('fishing-user:'||uid::text,0));
  if (select count(*) from fishing_private.rate_events where user_id=uid and created_at>now()-interval '1 minute')>=90 then raise exception 'RATE_LIMIT';end if;
  insert into fishing_private.rate_events(user_id,action) values(uid,action);
  delete from fishing_private.rate_events where user_id=uid and created_at<now()-interval '1 day';
  case action
  when 'upload_ticket' then
    if (select count(*) from fishing_private.rate_events where user_id=uid and action='upload_ticket' and created_at>now()-interval '1 day')>100 then raise exception 'RATE_LIMIT';end if;
    return to_jsonb(gen_random_uuid());
  when 'update_profile' then
    update public.profiles set nickname=trim(coalesce(payload->>'nickname',nickname)),city=trim(coalesce(payload->>'city',city)),bio=trim(coalesce(payload->>'bio',bio)),method=trim(coalesce(payload->>'method',method)) where id=uid;
    return fishing_private.profile_json(uid);
  when 'save_post' then
    if exists(select 1 from public.posts where id=target) then
      if not exists(select 1 from public.posts where id=target and author_id=uid) then raise exception 'FORBIDDEN';end if;
      return fishing_private.post_json(target);
    end if;
    scope:=coalesce(payload->>'audience','private');
    insert into public.posts(id,author_id,title,body,kind,species,method,bait,weight_kg,occurred_on,location_label,audience,status)
      values(target,uid,trim(payload->>'title'),trim(payload->>'body'),payload->>'kind',coalesce(payload->>'species',''),coalesce(payload->>'method',''),coalesce(payload->>'bait',''),nullif(payload->>'weight','')::numeric,(payload->>'occurred_on')::date,coalesce(payload->>'location_label',''),scope,case when scope='private' then 'published' else 'pending' end);
    if jsonb_array_length(coalesce(payload->'media','[]'))>9 then raise exception 'INVALID_INPUT';end if;
    for item in select * from jsonb_array_elements(coalesce(payload->'media','[]')) loop
      update public.media_assets set post_id=target where id=(item->>'id')::uuid and owner_id=uid and post_id is null and trip_id is null;
      if not found then raise exception 'FORBIDDEN';end if;
    end loop;
    return fishing_private.post_json(target);
  when 'save_trip' then
    if exists(select 1 from public.trips where id=target) then
      select to_jsonb(t)-'owner_id' into result from public.trips t where id=target and owner_id=uid;if result is null then raise exception 'FORBIDDEN';end if;return result;
    end if;
    insert into public.trips(id,owner_id,title,body,occurred_on,species,method,bait,weight_kg,count) values(target,uid,trim(payload->>'title'),trim(payload->>'body'),(payload->>'occurred_on')::date,coalesce(payload->>'species',''),coalesce(payload->>'method',''),coalesce(payload->>'bait',''),nullif(payload->>'weight','')::numeric,nullif(payload->>'count','')::integer);
    if jsonb_array_length(coalesce(payload->'media','[]'))>9 then raise exception 'INVALID_INPUT';end if;
    for item in select * from jsonb_array_elements(coalesce(payload->'media','[]')) loop
      update public.media_assets set trip_id=target where id=(item->>'id')::uuid and owner_id=uid and post_id is null and trip_id is null;if not found then raise exception 'FORBIDDEN';end if;
    end loop;
    select to_jsonb(t)-'owner_id' into result from public.trips t where id=target;return result;
  when 'reaction' then
    if not fishing_private.can_view_post(target) then raise exception 'NOT_FOUND';end if;
    if payload->>'kind'='like' then
      if desired then insert into public.post_likes values(uid,target) on conflict do nothing;else delete from public.post_likes where user_id=uid and post_id=target;end if;
    elsif payload->>'kind'='bookmark' then
      if desired then insert into public.post_bookmarks(user_id,post_id) values(uid,target) on conflict do nothing;else delete from public.post_bookmarks where user_id=uid and post_id=target;end if;
    else raise exception 'INVALID_INPUT';end if;return fishing_private.post_json(target);
  when 'comment' then
    if not fishing_private.can_view_post((payload->>'post_id')::uuid) then raise exception 'NOT_FOUND';end if;
    insert into public.comments(id,post_id,author_id,body) values(target,(payload->>'post_id')::uuid,uid,trim(payload->>'body')) on conflict(id) do nothing;
    if not exists(select 1 from public.comments where id=target and author_id=uid and post_id=(payload->>'post_id')::uuid) then raise exception 'FORBIDDEN';end if;return to_jsonb(true);
  when 'save_spot' then
    if exists(select 1 from public.fishing_spots where id=target and author_id<>uid) then raise exception 'FORBIDDEN';end if;
    scope:=coalesce(payload->>'audience','private');
    insert into public.fishing_spots(id,author_id,name,city,water_type,species,description,fee_note,observed_on,audience,precision,status)
      values(target,uid,trim(payload->>'name'),trim(payload->>'city'),payload->>'water_type',coalesce(payload->>'species',''),coalesce(payload->>'description',''),coalesce(payload->>'fee_note','未核实'),(payload->>'observed_on')::date,scope,coalesce(payload->>'precision','hidden'),case when scope='private' then 'published' else 'pending' end)
      on conflict(id) do update set name=excluded.name,city=excluded.city,water_type=excluded.water_type,species=excluded.species,description=excluded.description,fee_note=excluded.fee_note,observed_on=excluded.observed_on,audience=excluded.audience,precision=excluded.precision,status=excluded.status;
    if nullif(payload->>'latitude','') is not null and nullif(payload->>'longitude','') is not null then
      insert into public.spot_locations(spot_id,longitude,latitude,access_note) values(target,(payload->>'longitude')::double precision,(payload->>'latitude')::double precision,coalesce(payload->>'access_note',''))
        on conflict(spot_id) do update set longitude=excluded.longitude,latitude=excluded.latitude,access_note=excluded.access_note;
    else
      if payload->>'precision' in ('exact','area') then raise exception 'INVALID_INPUT';end if;
      delete from public.spot_locations where spot_id=target;
    end if;return fishing_private.spot_json(target);
  when 'spot_bookmark' then
    if not fishing_private.can_view_spot(target) then raise exception 'NOT_FOUND';end if;
    if desired then insert into public.spot_bookmarks values(uid,target) on conflict do nothing;else delete from public.spot_bookmarks where user_id=uid and spot_id=target;end if;return to_jsonb(true);
  when 'follow','friend_request','unfriend','block','conversation' then
    if target=uid or not exists(select 1 from public.profiles where id=target) then raise exception 'INVALID_INPUT';end if;
    perform pg_advisory_xact_lock(hashtextextended(least(uid,target)::text||'/'||greatest(uid,target)::text,0));
    if action<>'block' and fishing_private.is_blocked(uid,target) then raise exception 'BLOCKED';end if;
    if action='follow' then
      if desired then insert into public.follows(follower_id,followed_id) values(uid,target) on conflict do nothing;else delete from public.follows where follower_id=uid and followed_id=target;end if;
    elsif action='friend_request' then
      if fishing_private.are_friends(uid,target) then return to_jsonb(true);end if;
      update public.friend_requests set status='expired',updated_at=now() where status='pending' and created_at<now()-interval '30 days' and least(sender_id,recipient_id)=least(uid,target) and greatest(sender_id,recipient_id)=greatest(uid,target);
      select * into request_row from public.friend_requests where status='pending' and least(sender_id,recipient_id)=least(uid,target) and greatest(sender_id,recipient_id)=greatest(uid,target) for update;
      if found then return to_jsonb(request_row.id);end if;
      if exists(select 1 from public.friend_requests where sender_id=uid and recipient_id=target and updated_at>now()-interval '1 hour') then raise exception 'RATE_LIMIT';end if;
      insert into public.friend_requests(sender_id,recipient_id,note) values(uid,target,coalesce(payload->>'note',''));
    elsif action='unfriend' then delete from public.friendships where user_a=least(uid,target) and user_b=greatest(uid,target);
    elsif action='block' then
      if desired then
        insert into public.blocks(blocker_id,blocked_id) values(uid,target) on conflict do nothing;
        delete from public.friendships where user_a=least(uid,target) and user_b=greatest(uid,target);
        delete from public.follows where (follower_id=uid and followed_id=target) or (follower_id=target and followed_id=uid);
        update public.friend_requests set status='cancelled',updated_at=now() where status='pending' and least(sender_id,recipient_id)=least(uid,target) and greatest(sender_id,recipient_id)=greatest(uid,target);
      else delete from public.blocks where blocker_id=uid and blocked_id=target;end if;
    elsif action='conversation' then
      if not fishing_private.are_friends(uid,target) then raise exception 'NOT_FRIENDS';end if;
      insert into public.conversations(user_a,user_b) values(least(uid,target),greatest(uid,target)) on conflict(user_a,user_b) do nothing;
      select * into conversation from public.conversations where user_a=least(uid,target) and user_b=greatest(uid,target);
      insert into public.conversation_members(conversation_id,user_id) values(conversation.id,uid),(conversation.id,target) on conflict do nothing;
      return to_jsonb(conversation.id);
    end if;return to_jsonb(true);
  when 'friend_respond' then
    select * into request_row from public.friend_requests where id=target;
    if not found or request_row.recipient_id<>uid then raise exception 'FORBIDDEN';end if;
    other:=request_row.sender_id;
    perform pg_advisory_xact_lock(hashtextextended(least(uid,other)::text||'/'||greatest(uid,other)::text,0));
    select * into request_row from public.friend_requests where id=target for update;
    if request_row.status<>'pending' or request_row.created_at<now()-interval '30 days' then raise exception 'INVALID_TRANSITION';end if;
    if fishing_private.is_blocked(uid,other) then raise exception 'BLOCKED';end if;
    update public.friend_requests set status=case when (payload->>'accept')::boolean then 'accepted' else 'rejected' end,updated_at=now() where id=target;
    if (payload->>'accept')::boolean then insert into public.friendships(user_a,user_b) values(least(uid,other),greatest(uid,other)) on conflict do nothing;end if;return to_jsonb(true);
  when 'send_message' then
    select * into conversation from public.conversations where id=(payload->>'conversation_id')::uuid;
    if not found or not fishing_private.is_member(conversation.id) then raise exception 'FORBIDDEN';end if;
    perform pg_advisory_xact_lock(hashtextextended(conversation.user_a::text||'/'||conversation.user_b::text,0));
    if not fishing_private.are_friends(conversation.user_a,conversation.user_b) then raise exception 'NOT_FRIENDS';end if;
    select * into message from public.messages where sender_id=uid and client_id=(payload->>'client_id')::uuid;
    if found then if message.conversation_id<>conversation.id then raise exception 'INVALID_INPUT';end if;return to_jsonb(message);end if;
    update public.conversations set next_sequence=next_sequence+1 where id=conversation.id returning next_sequence into seq;
    insert into public.messages(conversation_id,sender_id,client_id,sequence,body) values(conversation.id,uid,(payload->>'client_id')::uuid,seq,trim(payload->>'body')) returning * into message;
    return to_jsonb(message);
  when 'read_conversation' then
    if not fishing_private.is_member(target) then raise exception 'FORBIDDEN';end if;
    update public.conversation_members set last_read_sequence=greatest(last_read_sequence,least((select next_sequence from public.conversations where id=target),greatest(0,(payload->>'sequence')::bigint))) where conversation_id=target and user_id=uid;return to_jsonb(true);
  when 'report' then
    if not ((payload->>'type'='post' and fishing_private.can_view_post(target)) or (payload->>'type'='spot' and fishing_private.can_view_spot(target)) or (payload->>'type'='profile' and exists(select 1 from public.profiles where id=target))) then raise exception 'NOT_FOUND';end if;
    insert into public.content_reports(reporter_id,target_type,target_id,reason) values(uid,payload->>'type',target,trim(payload->>'reason')) on conflict(reporter_id,target_type,target_id) do nothing;return to_jsonb(true);
  when 'delete_content' then
    if payload->>'type'='post' then update public.posts set status='deleted' where id=target and author_id=uid;
    elsif payload->>'type'='spot' then update public.fishing_spots set status='deleted' where id=target and author_id=uid;
    elsif payload->>'type'='trip' then delete from public.trips where id=target and owner_id=uid;
    else raise exception 'INVALID_INPUT';end if;if not found then raise exception 'NOT_FOUND';end if;return to_jsonb(true);
  when 'moderate' then
    if not exists(select 1 from fishing_private.moderators where user_id=uid) then raise exception 'FORBIDDEN';end if;
    if payload->>'decision' not in ('published','rejected','hidden') or length(trim(coalesce(payload->>'reason','')))=0 then raise exception 'INVALID_INPUT';end if;
    if payload->>'type'='post' then update public.posts set status=payload->>'decision' where id=target and status<>'deleted';
    elsif payload->>'type'='spot' then update public.fishing_spots set status=payload->>'decision' where id=target and status<>'deleted';else raise exception 'INVALID_INPUT';end if;
    if not found then raise exception 'NOT_FOUND';end if;
    insert into fishing_private.moderation_actions(moderator_id,target_type,target_id,decision,reason) values(uid,payload->>'type',target,payload->>'decision',payload->>'reason');return to_jsonb(true);
  else raise exception 'INVALID_INPUT';
  end case;
end $$;

-- SECURITY INVOKER public endpoints; privileged implementations stay unexposed and check caller identity.
create function public.fishing_read(action text,payload jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$select fishing_private.read_api(action,payload);$$;
create function public.fishing_write(action text,payload jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$select fishing_private.write_api(action,payload);$$;
revoke execute on all functions in schema fishing_private from public,anon,authenticated;
grant execute on function fishing_private.is_blocked(uuid,uuid),fishing_private.are_friends(uuid,uuid),fishing_private.can_view(uuid,text),fishing_private.can_view_post(uuid),fishing_private.can_view_spot(uuid),fishing_private.is_member(uuid),fishing_private.can_view_media(uuid),fishing_private.read_api(text,jsonb) to anon,authenticated;
grant execute on function fishing_private.write_api(text,jsonb) to authenticated;
revoke all on function public.fishing_read(text,jsonb),public.fishing_write(text,jsonb) from public,anon,authenticated;
grant execute on function public.fishing_read(text,jsonb) to anon,authenticated;
grant execute on function public.fishing_write(text,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('fishing-media','fishing-media',false,8388608,array['image/jpeg']) on conflict(id) do nothing;
create policy fishing_media_read on storage.objects for select to anon,authenticated using(bucket_id='fishing-media' and exists(select 1 from public.media_assets m where m.path=name and fishing_private.can_view_media(m.id)));
-- Upload/transform and deletion only from server functions using service_role; no client upsert policies.
