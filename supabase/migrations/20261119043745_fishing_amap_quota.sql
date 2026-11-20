-- A single transaction reserves an upstream AMap request. No coordinates or queries are stored.
create index rate_events_amap_idx on fishing_private.rate_events(created_at)
  where action = 'amap';

create function fishing_private.reserve_map_request() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not exists(select 1 from public.profiles where id = uid) then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  -- Shared across isolates: serialize quota checks so concurrent requests cannot overspend.
  perform pg_advisory_xact_lock(hashtextextended('fishing:amap:quota', 0));
  if (select count(*) from fishing_private.rate_events where action = 'amap' and user_id = uid
      and created_at > now() - interval '1 minute') >= 20
    or (select count(*) from fishing_private.rate_events where action = 'amap' and user_id = uid
      and created_at > now() - interval '1 day') >= 120
    or (select count(*) from fishing_private.rate_events where action = 'amap'
      and created_at > now() - interval '1 minute') >= 60
    or (select count(*) from fishing_private.rate_events where action = 'amap'
      and created_at > now() - interval '1 day') >= 1000 then
    raise exception 'RATE_LIMIT';
  end if;
  delete from fishing_private.rate_events where action = 'amap' and created_at <= now() - interval '1 day';
  insert into fishing_private.rate_events(user_id, action) values(uid, 'amap');
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function fishing_private.reserve_map_request() from public, anon, authenticated;
grant execute on function fishing_private.reserve_map_request() to authenticated;

create function public.fishing_map_ticket() returns jsonb
language sql security invoker set search_path = '' as $$
  select fishing_private.reserve_map_request();
$$;
revoke all on function public.fishing_map_ticket() from public, anon, authenticated;
grant execute on function public.fishing_map_ticket() to authenticated;
comment on function public.fishing_map_ticket() is 'Authenticated quota reservation only; AMap key remains in Edge Function secrets. Defaults: 20/min,120/day per user;60/min,1000/day project-wide.';
