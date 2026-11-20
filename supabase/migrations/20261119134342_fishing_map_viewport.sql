-- Map searches use the same coordinate projection as spot_json. In particular,
-- filtering an area-only spot by its hidden exact point would be a location oracle.
create index spot_locations_exact_map_idx on public.spot_locations using gist (point(longitude, latitude));
create index spot_locations_area_map_idx on public.spot_locations using gist (
  point((round(longitude::numeric / .02) * .02)::double precision,
        (round(latitude::numeric / .02) * .02)::double precision)
);

create function fishing_private.map_spots(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  west double precision; south double precision; east double precision; north double precision;
  viewport box; items jsonb; more boolean;
begin
  if payload is null or jsonb_typeof(payload) <> 'object'
    or jsonb_typeof(payload->'west') is distinct from 'number'
    or jsonb_typeof(payload->'south') is distinct from 'number'
    or jsonb_typeof(payload->'east') is distinct from 'number'
    or jsonb_typeof(payload->'north') is distinct from 'number' then
    raise exception 'INVALID_INPUT';
  end if;
  west := (payload->>'west')::double precision; south := (payload->>'south')::double precision;
  east := (payload->>'east')::double precision; north := (payload->>'north')::double precision;
  if not (west >= -180 and east <= 180 and south >= -85 and north <= 85
    and west < east and south < north) then raise exception 'INVALID_INPUT'; end if;
  if east - west > 10 or north - south > 10 then
    return jsonb_build_object('items','[]'::jsonb,'truncated',false,'zoom_in',true);
  end if;
  viewport := box(point(west, south), point(east, north));
  with candidates as (
    -- Owners can recover their own coordinates, including private/pending spots.
    select s.id,s.name,s.city,s.water_type,s.created_at,l.longitude,l.latitude,
      'exact'::text as precision,true as own
    from public.spot_locations l join public.fishing_spots s on s.id=l.spot_id
    where uid is not null and s.author_id=uid and fishing_private.can_view_spot(s.id)
      and point(l.longitude,l.latitude) <@ viewport
    union all
    select s.id,s.name,s.city,s.water_type,s.created_at,l.longitude,l.latitude,
      'exact'::text as precision,false as own
    from public.spot_locations l join public.fishing_spots s on s.id=l.spot_id
    where s.author_id is distinct from uid and s.precision='exact' and s.status='published'
      and fishing_private.can_view_spot(s.id) and point(l.longitude,l.latitude) <@ viewport
    union all
    select s.id,s.name,s.city,s.water_type,s.created_at,
      (round(l.longitude::numeric/.02)*.02)::double precision,
      (round(l.latitude::numeric/.02)*.02)::double precision,
      'area'::text as precision,false as own
    from public.spot_locations l join public.fishing_spots s on s.id=l.spot_id
    where s.author_id is distinct from uid and s.precision='area' and s.status='published'
      and fishing_private.can_view_spot(s.id)
      and point((round(l.longitude::numeric/.02)*.02)::double precision,
                (round(l.latitude::numeric/.02)*.02)::double precision) <@ viewport
  ), limited as (
    select * from candidates order by created_at desc,id desc limit 101
  ), numbered as (
    select *,row_number() over(order by created_at desc,id desc) as n from limited
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'city',city,
      'water_type',water_type,'longitude',longitude,'latitude',latitude,
      'precision',precision,'own',own,'crs','GCJ-02') order by created_at desc,id desc)
      filter(where n<=100),'[]'::jsonb),count(*)>100
    into items,more from numbered;
  return jsonb_build_object('items',items,'truncated',more,'zoom_in',false);
exception when numeric_value_out_of_range or invalid_text_representation then
  raise exception 'INVALID_INPUT';
end;
$$;

create function public.fishing_map_spots(payload jsonb default '{}'::jsonb) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select fishing_private.map_spots(payload);
$$;
revoke all on function fishing_private.map_spots(jsonb),public.fishing_map_spots(jsonb) from public,anon,authenticated;
grant execute on function fishing_private.map_spots(jsonb),public.fishing_map_spots(jsonb) to anon,authenticated;
comment on function public.fishing_map_spots(jsonb) is
  'GCJ-02 viewport pins; visibility and spatial filtering both respect authorized location precision. No GPS history is stored.';
