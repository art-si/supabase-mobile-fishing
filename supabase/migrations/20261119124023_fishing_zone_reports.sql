-- Community safety reminders are approximate circles, never official legal boundaries.
-- GCJ-02 stays explicitly labelled: no fake EPSG:4326/geography conversion.
create table public.fishing_zone_reports (
  id uuid primary key,
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check(length(title) between 2 and 80),
  description text not null check(length(description) between 10 and 1000),
  location_label text not null check(length(location_label) between 1 and 160),
  longitude double precision not null check(longitude between -179 and 179),
  latitude double precision not null check(latitude between -85 and 85),
  radius_m integer not null check(radius_m between 50 and 5000),
  observed_on date not null,
  expires_on date not null check(expires_on>=observed_on and expires_on<=observed_on+180),
  source_url text not null default '' check(length(source_url)<=1000 and (source_url='' or source_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^[:space:]]*)?$')),
  status text not null default 'pending' check(status in ('pending','published','rejected','hidden','withdrawn')),
  revision integer not null default 1 check(revision>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Conservative bounding box; the UI draws an approximate metric circle.
  bounds box generated always as (box(
    point(longitude-radius_m/(110000.0*cos(radians(latitude))),latitude-radius_m/110000.0),
    point(longitude+radius_m/(110000.0*cos(radians(latitude))),latitude+radius_m/110000.0)
  )) stored
);
create index zone_bounds_idx on public.fishing_zone_reports using gist(bounds) where status='published';
create index zone_owner_idx on public.fishing_zone_reports(author_id,created_at desc,id);
create index zone_queue_idx on public.fishing_zone_reports(status,created_at,id);
alter table public.fishing_zone_reports enable row level security;
-- No direct writes or raw author IDs exposed. Explicit, bounded RPC projections below.
revoke all on public.fishing_zone_reports from public,anon,authenticated;
create table fishing_private.zone_actions (
  actor_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  zone_id uuid not null references public.fishing_zone_reports(id) on delete cascade,
  action text not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,request_id)
);
create index zone_actions_target_idx on fishing_private.zone_actions(zone_id,created_at desc);
alter table fishing_private.zone_actions enable row level security;
revoke all on fishing_private.zone_actions from public,anon,authenticated;

create function fishing_private.zone_json(z public.fishing_zone_reports) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object('id',z.id,'title',z.title,'description',z.description,'location_label',z.location_label,
    'longitude',z.longitude,'latitude',z.latitude,'radius_m',z.radius_m,'crs','GCJ-02','source','community',
    'observed_on',z.observed_on,'expires_on',z.expires_on,'source_url',z.source_url,'status',z.status,
    'revision',z.revision,'created_at',z.created_at);
$$;
create function fishing_private.zones_read(action text,payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); items jsonb; next_cursor jsonb; west float8; east float8; south float8; north float8;
  cursor_time timestamptz; cursor_id uuid; moderator boolean:=fishing_private.is_moderator();
  review_status text:=coalesce(payload->>'status','pending');
begin
  if action='nearby' then
    west:=(payload->>'west')::float8; east:=(payload->>'east')::float8;
    south:=(payload->>'south')::float8; north:=(payload->>'north')::float8;
    if west is null or east is null or south is null or north is null or
      not(west>=-180 and east<=180 and south>=-85 and north<=85 and west<east and south<north) then raise exception 'INVALID_INPUT';end if;
    if east-west>10 or north-south>10 then return jsonb_build_object('items','[]'::jsonb,'zoom_in',true,'truncated',false);end if;
    with page as (
      select z.* from public.fishing_zone_reports z where z.status='published'
        and z.expires_on>=(now() at time zone 'Asia/Shanghai')::date
        and z.bounds && box(point(west,south),point(east,north))
        and not fishing_private.is_blocked(uid,z.author_id)
        order by z.created_at desc,z.id limit 101
    ), numbered as(select p.*,row_number() over(order by p.created_at desc,p.id) n from page p)
    select coalesce(jsonb_agg(fishing_private.zone_json(z) order by p.n) filter(where p.n<=100),'[]'::jsonb),
      to_jsonb(count(*)>100) into items,next_cursor from numbered p join public.fishing_zone_reports z on z.id=p.id;
    return jsonb_build_object('items',items,'truncated',next_cursor,'zoom_in',false);
  end if;
  if uid is null or not exists(select 1 from public.profiles where id=uid) then raise exception 'NOT_AUTHENTICATED';end if;
  if action='access' then return jsonb_build_object('allowed',moderator);end if;
  if action not in ('mine','review') then raise exception 'INVALID_INPUT';end if;
  if action='review' and not moderator then raise exception 'FORBIDDEN';end if;
  if review_status not in ('pending','published') then raise exception 'INVALID_INPUT';end if;
  if payload->>'cursor' is not null then
    cursor_time:=(payload->'cursor'->>'created_at')::timestamptz;
    cursor_id:=(payload->'cursor'->>'id')::uuid;
    if cursor_time is null or cursor_id is null then raise exception 'INVALID_INPUT';end if;
  end if;
  with page as (
    select z.* from public.fishing_zone_reports z where
      ((action='mine' and z.author_id=uid) or (action='review' and z.status=review_status))
      and (cursor_time is null or (z.created_at,z.id)<(cursor_time,cursor_id))
      order by z.created_at desc,z.id desc limit 21
  ), numbered as(select p.*,row_number() over(order by p.created_at desc,p.id desc) n from page p)
  select coalesce(jsonb_agg(fishing_private.zone_json(z)||jsonb_build_object('own',z.author_id=uid,'review_note',coalesce(
    (select a.payload->>'reason' from fishing_private.zone_actions a where a.zone_id=z.id and a.action='decide' order by a.created_at desc limit 1),'')) order by p.n) filter(where p.n<=20),'[]'::jsonb),
    case when count(*)>20 then (jsonb_agg(jsonb_build_object('id',z.id,'created_at',z.created_at)) filter(where p.n=20))->0 else null end
    into items,next_cursor from numbered p join public.fishing_zone_reports z on z.id=p.id;
  return jsonb_build_object('items',items,'next',next_cursor);
end $$;

create function fishing_private.zones_write(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); target uuid:=nullif(payload->>'id','')::uuid;
  receipt_id uuid:=nullif(payload->>'request_id','')::uuid;
  expected integer:=(payload->>'revision')::integer; decision text:=payload->>'decision';
  reason text:=btrim(coalesce(payload->>'reason','')); row public.fishing_zone_reports;
  receipt fishing_private.zone_actions; result jsonb; today date:=(now() at time zone 'Asia/Shanghai')::date;
begin
  if payload is null or jsonb_typeof(payload)<>'object' or length(payload::text)>8000 then raise exception 'INVALID_INPUT';end if;
  if uid is null or not exists(select 1 from public.profiles where id=uid) then raise exception 'NOT_AUTHENTICATED';end if;
  if target is null or receipt_id is null or action not in ('submit','withdraw','decide') then raise exception 'INVALID_INPUT';end if;
  -- Permission checked BEFORE idempotency receipts; revoked moderators cannot replay privileged calls.
  if action='decide' and not fishing_private.is_moderator() then raise exception 'FORBIDDEN';end if;
  perform pg_advisory_xact_lock(hashtextextended('fishing-zone:'||uid::text,0));
  select a.* into receipt from fishing_private.zone_actions a where a.actor_id=uid and a.request_id=receipt_id;
  if found then
    if receipt.action<>action or receipt.payload<>payload then raise exception 'EDIT_REQUEST_REUSED';end if;
    return receipt.result;
  end if;
  if (select count(*) from fishing_private.rate_events e where e.user_id=uid and e.action like 'zone_%' and e.created_at>now()-interval '1 minute')>=20 then raise exception 'RATE_LIMIT';end if;
  if action='submit' then
    if (select count(*) from fishing_private.rate_events e where e.user_id=uid and e.action='zone_submit' and e.created_at>now()-interval '1 day')>=10 then raise exception 'RATE_LIMIT';end if;
    if payload->>'crs' is distinct from 'GCJ-02' or payload->'consent' is distinct from 'true'::jsonb
      or payload ?| array['status','source','author_id','official','bounds']
      or nullif(payload->>'observed_on','')::date>today
      or nullif(payload->>'observed_on','')::date<today-90
      or nullif(payload->>'expires_on','')::date<today then raise exception 'INVALID_INPUT';end if;
    insert into public.fishing_zone_reports(id,author_id,title,description,location_label,longitude,latitude,radius_m,observed_on,expires_on,source_url)
      values(target,uid,btrim(payload->>'title'),btrim(payload->>'description'),btrim(payload->>'location_label'),
      (payload->>'longitude')::float8,(payload->>'latitude')::float8,(payload->>'radius_m')::integer,
      (payload->>'observed_on')::date,(payload->>'expires_on')::date,btrim(coalesce(payload->>'source_url','')))
      returning * into row;
  else
    select z.* into row from public.fishing_zone_reports z where z.id=target for update;
    if not found then raise exception 'NOT_FOUND';end if;
    if action='withdraw' and row.author_id<>uid then raise exception 'FORBIDDEN';end if;
    if action='decide' and row.author_id=uid then raise exception 'SELF_REVIEW';end if;
    if expected is null or row.revision<>expected then raise exception 'REVIEW_CONFLICT';end if;
    if action='withdraw' then
      if row.status='withdrawn' then raise exception 'INVALID_TRANSITION';end if;
      decision:='withdrawn';
    else
      if length(reason) not between 1 and 500 or decision is null or not(
        (row.status='pending' and decision in ('published','rejected')) or
        (row.status='published' and decision='hidden')) then raise exception 'INVALID_TRANSITION';end if;
      if decision='published' and row.expires_on<today then raise exception 'ZONE_EXPIRED';end if;
    end if;
    update public.fishing_zone_reports z set status=decision,revision=z.revision+1,updated_at=now() where z.id=target returning * into row;
  end if;
  result:=jsonb_build_object('id',row.id,'status',row.status,'revision',row.revision);
  insert into fishing_private.zone_actions(actor_id,request_id,zone_id,action,payload,result)
    values(uid,receipt_id,target,action,payload,result);
  insert into fishing_private.rate_events(user_id,action) values(uid,'zone_'||action);
  delete from fishing_private.rate_events e where e.user_id=uid and e.created_at<now()-interval '1 day';
  return result;
exception when check_violation or not_null_violation or invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range or unique_violation then
  raise exception 'INVALID_INPUT';
end $$;
create function public.fishing_zones_read(action text,payload jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$ select fishing_private.zones_read(action,payload); $$;
create function public.fishing_zones_write(action text,payload jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$ select fishing_private.zones_write(action,payload); $$;
revoke all on function fishing_private.zone_json(public.fishing_zone_reports),fishing_private.zones_read(text,jsonb),fishing_private.zones_write(text,jsonb),public.fishing_zones_read(text,jsonb),public.fishing_zones_write(text,jsonb) from public,anon,authenticated;
grant execute on function fishing_private.zones_read(text,jsonb),public.fishing_zones_read(text,jsonb) to anon,authenticated;
grant execute on function fishing_private.zones_write(text,jsonb),public.fishing_zones_write(text,jsonb) to authenticated;
