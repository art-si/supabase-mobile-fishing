-- Water-surface polygons. Old circle-only records remain in the owner's history.
create function fishing_private.valid_zone_ring(value jsonb,max_diagonal_m float8 default 10000) returns boolean
language plpgsql immutable set search_path='' as $$
declare ring jsonb; n integer; i integer; j integer; a jsonb; b jsonb; c jsonb; d jsonb;
 ax float8; ay float8; bx float8; byy float8; cx float8; cy float8; dx float8; dy float8;
 west float8:=180; east float8:=-180; south float8:=90; north float8:=-90; area float8:=0;
begin
 if value is null or value->>'type' is distinct from 'Polygon' or jsonb_typeof(value->'coordinates') is distinct from 'array' then return false; end if;
 if jsonb_array_length(value->'coordinates')<>1 then return false;end if;
 ring:=value->'coordinates'->0;
 if jsonb_typeof(ring) is distinct from 'array' then return false;end if;
 n:=jsonb_array_length(ring)-1;
 if n<3 or n>(case when max_diagonal_m>10000 then 4000 else 120 end) or ring->0<>ring->n then return false;end if;
 for i in 0..n-1 loop
  a:=ring->i; b:=ring->(i+1);
  if jsonb_typeof(a) is distinct from 'array' or jsonb_array_length(a)<>2 or jsonb_typeof(a->0)<>'number' or jsonb_typeof(a->1)<>'number' then return false;end if;
  ax:=(a->>0)::float8;ay:=(a->>1)::float8;bx:=(b->>0)::float8;byy:=(b->>1)::float8;
  if not(ax between 73 and 136 and ay between 3 and 54) or a=b then return false;end if;
  west:=least(west,ax);east:=greatest(east,ax);south:=least(south,ay);north:=greatest(north,ay);
  area:=area+(ax-(ring->0->>0)::float8)*(byy-(ring->0->>1)::float8)-(bx-(ring->0->>0)::float8)*(ay-(ring->0->>1)::float8);
  for j in i+2..n-1 loop
   if i=0 and j=n-1 then continue;end if;
   c:=ring->j;d:=ring->(j+1);cx:=(c->>0)::float8;cy:=(c->>1)::float8;dx:=(d->>0)::float8;dy:=(d->>1)::float8;
   if greatest(ax,bx)>=least(cx,dx) and greatest(cx,dx)>=least(ax,bx) and greatest(ay,byy)>=least(cy,dy) and greatest(cy,dy)>=least(ay,byy)
    and ((bx-ax)*(cy-ay)-(byy-ay)*(cx-ax))*((bx-ax)*(dy-ay)-(byy-ay)*(dx-ax))<=0
    and ((dx-cx)*(ay-cy)-(dy-cy)*(ax-cx))*((dx-cx)*(byy-cy)-(dy-cy)*(bx-cx))<=0 then return false;end if;
  end loop;
 end loop;
 return abs(area)*111320.0*111320.0/2>25 and sqrt(power((east-west)*111320*cos(radians(south)),2)+power((north-south)*111320,2))<=max_diagonal_m;
exception when others then return false;
end $$;
create function fishing_private.valid_zone_boundary(value jsonb,max_diagonal_m float8 default 10000) returns boolean
language plpgsql immutable set search_path='' as $$
declare rings jsonb; ring jsonb;
begin
 if value is null or value->>'type' is distinct from 'Polygon' or jsonb_typeof(value->'coordinates') is distinct from 'array' then return false;end if;
 rings:=value->'coordinates';
 if jsonb_array_length(rings)<1 or jsonb_array_length(rings)>64 or (max_diagonal_m<=10000 and jsonb_array_length(rings)<>1) then return false;end if;
 for ring in select p from jsonb_array_elements(rings) p loop
  if not fishing_private.valid_zone_ring(jsonb_build_object('type','Polygon','coordinates',jsonb_build_array(ring)),max_diagonal_m) then return false;end if;
 end loop;
 return true;
exception when others then return false;
end $$;
create function fishing_private.zone_boundary_box(value jsonb) returns box
language sql immutable set search_path='' as $$
 select box(point(min((p->>0)::float8),min((p->>1)::float8)),point(max((p->>0)::float8),max((p->>1)::float8)))
 from jsonb_array_elements(value->'coordinates') r cross join lateral jsonb_array_elements(r) p;
$$;
alter table public.fishing_zone_reports add column boundary jsonb;
alter table public.fishing_zone_reports add constraint zone_boundary_valid check(boundary is null or fishing_private.valid_zone_boundary(boundary));
alter table public.fishing_zone_reports add column fence_bounds box generated always as (fishing_private.zone_boundary_box(boundary)) stored;
create index zone_fence_bounds_idx on public.fishing_zone_reports using gist(fence_bounds) where status='published' and boundary is not null;
create table public.fishing_official_zones (
 id text primary key check(length(id) between 1 and 160),
 title text not null check(length(title) between 2 and 160),
 description text not null check(length(description) between 10 and 3000),
 location_label text not null check(length(location_label) between 2 and 200),
 region_adcode text not null check(region_adcode ~ '^[0-9]{6}$'),
 longitude float8 not null check(longitude between 73 and 136), latitude float8 not null check(latitude between 3 and 54),
 boundary jsonb not null check(fishing_private.valid_zone_boundary(boundary,1000000)),
 issuer text not null check(length(issuer) between 2 and 160),
 source_url text not null check(source_url ~ '^https://[A-Za-z0-9.-]+[.]gov[.]cn/[^[:space:]]*$'),
 boundary_source_url text not null check(boundary_source_url ~ '^https://[A-Za-z0-9.-]+[.]gov[.]cn/[^[:space:]]*$'),
 boundary_note text not null check(length(boundary_note) between 2 and 500),
 issued_on date not null, checked_on date not null, valid_from date not null, valid_until date,
 water_attribution text not null default '' check(length(water_attribution)<=160),
 water_source_url text not null default '' check(water_source_url='' or water_source_url ~ '^https://[A-Za-z0-9.-]+/[^[:space:]]*$'),
 published boolean not null default false, created_at timestamptz not null default now(),
 bounds box generated always as (fishing_private.zone_boundary_box(boundary)) stored,
 check(valid_until is null or valid_until>=valid_from)
);
create index official_zone_bounds_idx on public.fishing_official_zones using gist(bounds) where published;
alter table public.fishing_official_zones enable row level security;
revoke all on public.fishing_official_zones from public,anon,authenticated;
grant select,insert,update,delete on public.fishing_official_zones to service_role;
create or replace function fishing_private.zone_json(z public.fishing_zone_reports) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',z.id,'title',z.title,'description',z.description,'location_label',z.location_label,
 'longitude',z.longitude,'latitude',z.latitude,'radius_m',z.radius_m,'boundary',z.boundary,'crs','GCJ-02','source','community',
 'reporter',coalesce((select p.nickname from public.profiles p where p.id=z.author_id),'钓友'),
 'observed_on',z.observed_on,'expires_on',z.expires_on,'source_url',z.source_url,'status',z.status,'revision',z.revision,'created_at',z.created_at,
 'boundary_note',case when z.boundary is null then '旧记录未提供水域边界，暂不绘制围栏。' else '钓友沿水域标记的禁钓范围，已审核；以当地最新公告和现场标识为准。' end);
$$;
create or replace function fishing_private.zones_read(action text,payload jsonb) returns jsonb
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
    with all_zones as (
      select fishing_private.zone_json(z) doc,z.created_at from public.fishing_zone_reports z
      where z.status='published' and z.boundary is not null and z.expires_on>=(now() at time zone 'Asia/Shanghai')::date
       and z.fence_bounds && box(point(west,south),point(east,north)) and not fishing_private.is_blocked(uid,z.author_id)
      union all
      select jsonb_build_object('id',o.id,'title',o.title,'description',o.description,'location_label',o.location_label,
       'longitude',o.longitude,'latitude',o.latitude,'radius_m',0,'boundary',o.boundary,'crs','GCJ-02','source','official',
       'issuer',o.issuer,'observed_on',o.issued_on,'expires_on',coalesce(o.valid_until::text,''),'source_url',o.source_url,
       'boundary_source_url',o.boundary_source_url,'boundary_note',o.boundary_note,'checked_on',o.checked_on,
       'water_attribution',o.water_attribution,'water_source_url',o.water_source_url,
       'status','published','revision',1,'created_at',o.created_at),o.created_at
      from public.fishing_official_zones o where o.published and o.valid_from<=(now() at time zone 'Asia/Shanghai')::date
       and (o.valid_until is null or o.valid_until>=(now() at time zone 'Asia/Shanghai')::date)
       and o.bounds && box(point(west,south),point(east,north))
    ), page as (select doc,created_at from all_zones order by created_at desc,doc->>'id' limit 101),
    numbered as(select *,row_number() over(order by created_at desc,doc->>'id') n from page)
    select coalesce(jsonb_agg(doc order by n) filter(where n<=100),'[]'::jsonb),to_jsonb(count(*)>100) into items,next_cursor from numbered;
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

create or replace function fishing_private.zones_write(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); target uuid:=nullif(payload->>'id','')::uuid;
  receipt_id uuid:=nullif(payload->>'request_id','')::uuid;
  expected integer:=(payload->>'revision')::integer; decision text:=payload->>'decision';
  reason text:=btrim(coalesce(payload->>'reason','')); row public.fishing_zone_reports;
  receipt fishing_private.zone_actions; result jsonb; today date:=(now() at time zone 'Asia/Shanghai')::date;
begin
  if payload is null or jsonb_typeof(payload)<>'object' or length(payload::text)>24000 then raise exception 'INVALID_INPUT';end if;
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
    if payload ? 'boundary' and not fishing_private.valid_zone_boundary(payload->'boundary') then raise exception 'INVALID_INPUT';end if;
    if payload->>'crs' is distinct from 'GCJ-02' or payload->'consent' is distinct from 'true'::jsonb
      or payload ?| array['status','source','author_id','official','bounds']
      or nullif(payload->>'observed_on','')::date>today
      or nullif(payload->>'observed_on','')::date<today-90
      or nullif(payload->>'expires_on','')::date<today then raise exception 'INVALID_INPUT';end if;
    insert into public.fishing_zone_reports(id,author_id,title,description,location_label,longitude,latitude,radius_m,observed_on,expires_on,source_url,boundary)
      values(target,uid,btrim(payload->>'title'),btrim(payload->>'description'),btrim(payload->>'location_label'),
      (payload->>'longitude')::float8,(payload->>'latitude')::float8,(payload->>'radius_m')::integer,
      (payload->>'observed_on')::date,(payload->>'expires_on')::date,btrim(coalesce(payload->>'source_url','')),payload->'boundary')
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

revoke all on function fishing_private.valid_zone_ring(jsonb,float8),fishing_private.valid_zone_boundary(jsonb,float8),fishing_private.zone_boundary_box(jsonb) from public,anon,authenticated;
grant execute on function fishing_private.valid_zone_ring(jsonb,float8),fishing_private.valid_zone_boundary(jsonb,float8),fishing_private.zone_boundary_box(jsonb) to service_role;
