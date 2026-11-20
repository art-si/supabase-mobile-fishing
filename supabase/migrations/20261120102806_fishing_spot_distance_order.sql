-- Distance uses exactly the coordinates the caller may view. Hidden positions
-- never affect public sorting; area positions use the same public grid point.
create function fishing_private.spots_by_distance(payload jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare origin jsonb:=payload->'origin'; lng float8; lat float8; items jsonb;
begin
  if origin is not null and origin <> 'null'::jsonb then
    if jsonb_typeof(origin)<>'object' or origin->>'crs' is distinct from 'GCJ-02'
      or jsonb_typeof(origin->'longitude') is distinct from 'number'
      or jsonb_typeof(origin->'latitude') is distinct from 'number' then raise exception 'INVALID_INPUT';end if;
    lng:=(origin->>'longitude')::float8;lat:=(origin->>'latitude')::float8;
    if not(lng between -180 and 180 and lat between -85 and 85) then raise exception 'INVALID_INPUT';end if;
  end if;
  with visible as (
    select s.id,s.created_at,
      s.precision='area' and s.author_id is distinct from (select auth.uid()) as approximate,
      case when s.author_id=(select auth.uid()) or s.precision='exact' then l.longitude
        when s.precision='area' then round(l.longitude::numeric/.02)*.02 else null end as x,
      case when s.author_id=(select auth.uid()) or s.precision='exact' then l.latitude
        when s.precision='area' then round(l.latitude::numeric/.02)*.02 else null end as y
    from public.fishing_spots s left join public.spot_locations l on l.spot_id=s.id
    where fishing_private.can_view_spot(s.id)
      and (s.name||s.city||s.species) ilike '%'||left(coalesce(payload->>'query',''),100)||'%'
      and (coalesce(payload->>'type','')='' or s.water_type=payload->>'type')
  ), measured as (
    select *,case when lng is not null and x is not null and y is not null then
      12742000 * asin(sqrt(least(1::float8,greatest(0::float8,
        power(sin(radians((y-lat)::float8)/2),2)+cos(radians(lat))*cos(radians(y::float8))*power(sin(radians((x-lng)::float8)/2),2)
      )))) end as distance from visible
  ), nearest as (
    select * from measured order by distance asc nulls last,created_at desc,id desc limit 100
  )
  select coalesce(jsonb_agg(fishing_private.spot_json(id) || case when distance is not null then
    jsonb_build_object('distance_m',round(distance::numeric),'distance_approximate',approximate)
    else '{}'::jsonb end order by distance asc nulls last,created_at desc,id desc),'[]'::jsonb) into items from nearest;
  return jsonb_build_object('items',items,'next',null);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'INVALID_INPUT';
end $$;
revoke all on function fishing_private.spots_by_distance(jsonb) from public,anon,authenticated,service_role;

do $migration$
declare source text; needle text;
begin
  source:=pg_get_functiondef('fishing_private.read_api(text,jsonb)'::regprocedure);
  needle:=substring(source from $pattern$  when 'spots' then[\s\S]*?(?=  when 'spot' then)$pattern$);
  if needle is null then raise exception 'spot reader anchor changed';end if;
  execute replace(source,needle,E'  when ''spots'' then return fishing_private.spots_by_distance(payload);\n');
end $migration$;
