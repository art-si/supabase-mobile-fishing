-- One current prohibition predicate for map selection, spot writes and imported leads.
-- Polygon holes are excluded; all boundary edges remain covered. Coordinates are GCJ-02.
create function fishing_private.zone_covers_point(boundary jsonb,lng float8,lat float8) returns boolean
language plpgsql immutable set search_path='' as $$
declare poly jsonb; ring jsonb; a jsonb; b jsonb; r integer:=0; i integer; n integer;
 ax float8; ay float8; bx float8; byy float8; inside boolean;
begin
 if boundary->>'type'='MultiPolygon' then
  for poly in select value from jsonb_array_elements(boundary->'coordinates') loop
   if fishing_private.zone_covers_point(jsonb_build_object('type','Polygon','coordinates',poly),lng,lat) then return true;end if;
  end loop;
  return false;
 end if;
 if boundary->>'type' is distinct from 'Polygon' then return false;end if;
 for ring in select value from jsonb_array_elements(boundary->'coordinates') loop
  n:=jsonb_array_length(ring)-1; inside:=false;
  if n<3 then return false;end if;
  for i in 0..n-1 loop
   a:=ring->i;b:=ring->(i+1);ax:=(a->>0)::float8;ay:=(a->>1)::float8;bx:=(b->>0)::float8;byy:=(b->>1)::float8;
   if abs((lng-ax)*(byy-ay)-(lat-ay)*(bx-ax))<=1e-12
    and lng between least(ax,bx)-1e-12 and greatest(ax,bx)+1e-12
    and lat between least(ay,byy)-1e-12 and greatest(ay,byy)+1e-12 then return true;end if;
   if (ay>lat)<>(byy>lat) then
    if lng<(bx-ax)*(lat-ay)/(byy-ay)+ax then inside:=not inside;end if;
   end if;
  end loop;
  if r=0 and not inside then return false;end if;
  if r>0 and inside then return false;end if;
  r:=r+1;
 end loop;
 return r>0;
end $$;

create function fishing_private.spot_prohibition(lng float8,lat float8) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare z record; matches jsonb:='[]'; today date:=(now() at time zone 'Asia/Shanghai')::date; version text;
begin
 if lng is null or lat is null or not(lng between 73 and 136 and lat between 3 and 54) then
  raise exception 'SPOT_LOCATION_REQUIRED' using errcode='22023';
 end if;
 for z in select o.id,o.title,o.source_url,o.boundary from public.fishing_official_zones o
  where o.published and o.valid_from<=today and (o.valid_until is null or o.valid_until>=today)
   and o.bounds @> point(lng,lat)
 loop
  if fishing_private.zone_covers_point(z.boundary,lng,lat) then
   matches:=matches||jsonb_build_array(jsonb_build_object('id',z.id,'title',z.title,'source','official','source_url',z.source_url,'boundary_known',true));
  end if;
  exit when jsonb_array_length(matches)>=8;
 end loop;
 for z in select c.id,c.title,c.source_url,c.boundary from public.fishing_zone_reports c
  where c.status='published' and c.boundary is not null and c.observed_on<=today and c.expires_on>=today
   and c.fence_bounds @> point(lng,lat)
 loop
  version:=fishing_private.zone_feedback_version('community',z.id::text);
  if not coalesce((fishing_private.zone_feedback_state('community',z.id::text,version)->>'released')::boolean,false)
   and fishing_private.zone_covers_point(z.boundary,lng,lat) then
   matches:=matches||jsonb_build_array(jsonb_build_object('id',z.id,'title',z.title,'source','community','source_url',z.source_url,'boundary_known',true));
  end if;
  exit when jsonb_array_length(matches)>=8;
 end loop;
 -- A public prohibited spot is a point reminder, not an invented lake-wide area.
 -- Only the same recorded point (coordinate rounding tolerance) is blocked by it.
 for z in select s.id,s.name from public.fishing_spots s join public.spot_locations l on l.spot_id=s.id
  where s.status='published' and s.audience='public' and s.precision='exact' and s.fishing_status='prohibited'
   and point(l.longitude,l.latitude)<@box(point(lng-0.0000001,lat-0.0000001),point(lng+0.0000001,lat+0.0000001))
  limit 8
 loop
  matches:=matches||jsonb_build_array(jsonb_build_object('id',z.id,'title',z.name,'source','spot','source_url','','boundary_known',false));
  exit when jsonb_array_length(matches)>=8;
 end loop;
 return jsonb_build_object('blocked',jsonb_array_length(matches)>0,'sources',matches,'checked_at',now());
end $$;

create function public.fishing_spot_creation_check(longitude float8,latitude float8) returns jsonb
language sql stable security invoker set search_path='' as $$select fishing_private.spot_prohibition($1,$2);$$;
revoke all on function fishing_private.zone_covers_point(jsonb,float8,float8),fishing_private.spot_prohibition(float8,float8),public.fishing_spot_creation_check(float8,float8) from public,anon,authenticated,service_role;
grant execute on function fishing_private.zone_covers_point(jsonb,float8,float8) to service_role;
grant execute on function fishing_private.spot_prohibition(float8,float8),public.fishing_spot_creation_check(float8,float8) to anon,authenticated,service_role;

create function fishing_private.guard_spot_prohibition() returns trigger
language plpgsql security definer set search_path='' as $$
declare spot public.fishing_spots; location public.spot_locations; result jsonb; target uuid;
begin
 if TG_TABLE_NAME='spot_locations' then target:=NEW.spot_id;else target:=NEW.id;end if;
 select * into spot from public.fishing_spots where id=target;
 if not found or spot.status='deleted' then return null;end if;
 -- Existing records may still be corrected to prohibited and remain map reminders.
 if TG_ARGV[0]<>'new_spot' and spot.fishing_status='prohibited' then return null;end if;
 select * into location from public.spot_locations where spot_id=target;
 if not found then
  if TG_ARGV[0]='new_spot' then raise exception 'SPOT_LOCATION_REQUIRED' using errcode='22023';end if;
  return null;
 end if;
 result:=fishing_private.spot_prohibition(location.longitude,location.latitude);
 if (result->>'blocked')::boolean then raise exception 'SPOT_LOCATION_PROHIBITED' using errcode='P0001';end if;
 return null;
end $$;
revoke all on function fishing_private.guard_spot_prohibition() from public,anon,authenticated,service_role;
create constraint trigger fishing_spot_creation_prohibition after insert on public.fishing_spots
 deferrable initially deferred for each row execute function fishing_private.guard_spot_prohibition('new_spot');
create constraint trigger fishing_spot_edit_prohibition after update on public.fishing_spots
 deferrable initially deferred for each row execute function fishing_private.guard_spot_prohibition('existing_spot');
create constraint trigger fishing_spot_point_prohibition after insert or update on public.spot_locations
 deferrable initially deferred for each row execute function fishing_private.guard_spot_prohibition('existing_spot');

create function fishing_private.guard_imported_spot_prohibition() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if NEW.catalog_status='published' and NEW.valid_until>now() then
  if (fishing_private.spot_prohibition((NEW.card->'sourcePosition'->>'longitude')::float8,(NEW.card->'sourcePosition'->>'latitude')::float8)->>'blocked')::boolean then
   raise exception 'SPOT_LOCATION_PROHIBITED' using errcode='P0001';
  end if;
 end if;
 return NEW;
end $$;
revoke all on function fishing_private.guard_imported_spot_prohibition() from public,anon,authenticated,service_role;
create trigger fishing_spot_lead_prohibition before insert or update on public.fishing_spot_leads
 for each row execute function fishing_private.guard_imported_spot_prohibition();

drop policy fishing_spot_leads_verified on public.fishing_spot_leads;
create policy fishing_spot_leads_verified on public.fishing_spot_leads for select to anon,authenticated
 using(catalog_status='published' and valid_until>now() and case
  when jsonb_typeof(card->'sourcePosition'->'longitude')='number' and jsonb_typeof(card->'sourcePosition'->'latitude')='number'
   and (card->'sourcePosition'->>'longitude')::float8 between 73 and 136 and (card->'sourcePosition'->>'latitude')::float8 between 3 and 54
  then not (fishing_private.spot_prohibition((card->'sourcePosition'->>'longitude')::float8,(card->'sourcePosition'->>'latitude')::float8)->>'blocked')::boolean
  else false end);

-- Votes are useful feedback, but do not revoke an effective government prohibition.
alter function fishing_private.zones_read(text,jsonb) rename to zones_read_before_official_guard;
revoke execute on function fishing_private.zones_read_before_official_guard(text,jsonb) from public,anon,authenticated,service_role;
create function fishing_private.zones_read(action text,payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; restored jsonb; remaining jsonb;
begin
 result:=fishing_private.zones_read_before_official_guard(action,payload);
 if action='nearby' then
  select coalesce(jsonb_agg(item||jsonb_build_object('feedback',coalesce(item->'feedback','{}')||jsonb_build_object('reported_release',true,'released',false))),'[]')
   into restored from jsonb_array_elements(coalesce(result->'released','[]')) item where item->>'source'='official';
  select coalesce(jsonb_agg(item),'[]') into remaining from jsonb_array_elements(coalesce(result->'released','[]')) item where item->>'source'<>'official';
  result:=result||jsonb_build_object('items',coalesce(result->'items','[]')||restored,'released',remaining);
 end if;
 return result;
end $$;
revoke all on function fishing_private.zones_read(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function fishing_private.zones_read(text,jsonb) to anon,authenticated,service_role;
create or replace function public.fishing_zones_read(action text,payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$select fishing_private.zones_read(action,payload);$$;

create or replace function public.fishing_zone_feedback(action text,payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 result:=fishing_private.zone_feedback_api(action,payload);
 if payload->>'source'='official' then
  result:=result||jsonb_build_object('reported_release',coalesce((result->>'released')::boolean,false),'released',false);
 end if;
 return result;
end $$;
revoke all on function public.fishing_zone_feedback(text,jsonb) from public;
grant execute on function public.fishing_zone_feedback(text,jsonb) to anon,authenticated,service_role;
