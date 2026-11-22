-- Read exact points only when the author has published both the spot and its precise position.
-- The existing nearby reader validates the viewport before this helper is called.
create function fishing_private.nearby_prohibited_spot_points(payload jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$
  with viewport as (
    select box(
      point((payload->>'west')::float8 - .018, (payload->>'south')::float8 - .012),
      point((payload->>'east')::float8 + .018, (payload->>'north')::float8 + .012)
    ) as bounds
  ), points as (
    select s.id, s.name, s.city, s.observed_on, s.created_at, s.review_revision,
      l.longitude, l.latitude
    from viewport v
    join public.spot_locations l on point(l.longitude,l.latitude) <@ v.bounds
    join public.fishing_spots s on s.id=l.spot_id
    where s.audience='public' and s.precision='exact' and s.fishing_status='prohibited'
      and s.status='published' and fishing_private.can_view_spot(s.id)
    order by s.observed_on desc nulls last,s.created_at desc,s.id
    limit 100
  )
  select coalesce(jsonb_agg(to_jsonb(p) order by p.observed_on desc nulls last,p.created_at desc,p.id),'[]'::jsonb)
  from points p;
$$;
revoke all on function fishing_private.nearby_prohibited_spot_points(jsonb) from public,anon,authenticated,service_role;

alter function fishing_private.zones_read(text,jsonb) rename to zones_read_before_spot_fences;
revoke execute on function fishing_private.zones_read_before_spot_fences(text,jsonb) from anon,authenticated;
create function fishing_private.zones_read(action text,payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  result := fishing_private.zones_read_before_spot_fences(action,payload);
  if action = 'nearby' and (result->>'zoom_in')::boolean is false then
    result := result || jsonb_build_object('spot_points', fishing_private.nearby_prohibited_spot_points(payload));
  end if;
  return result;
end $$;
revoke all on function fishing_private.zones_read(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function fishing_private.zones_read(text,jsonb) to anon,authenticated,service_role;
create or replace function public.fishing_zones_read(action text,payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select fishing_private.zones_read(action,payload);
$$;
