-- Position -> water geometry -> place name -> city can use several map requests.
-- Keep the project budget and minute limits; preserve every existing quota event.
create or replace function fishing_private.reserve_map_request() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not exists(select 1 from public.profiles where id = uid) then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fishing:amap:quota', 0));
  if (select count(*) from fishing_private.rate_events where action = 'amap' and user_id = uid
      and created_at > now() - interval '1 minute') >= 20
    or (select count(*) from fishing_private.rate_events where action = 'amap' and user_id = uid
      and created_at > now() - interval '1 day') >= 500
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
comment on function public.fishing_map_ticket() is 'Authenticated quota reservation only; map credentials remain in Edge Function secrets. Limits: 20/min,500/day per user;60/min,1000/day project-wide.';
