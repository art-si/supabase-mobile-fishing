-- Anonymous login is resolved only inside the server. No phone or credential is stored here.
create table fishing_private.account_login_limits (
  bucket text not null,
  window_start timestamptz not null,
  attempts integer not null check (attempts > 0),
  primary key (bucket, window_start)
);
create index account_login_limits_expiry on fishing_private.account_login_limits(window_start);
alter table fishing_private.account_login_limits enable row level security;
alter table fishing_private.account_login_limits force row level security;
revoke all on fishing_private.account_login_limits from public, anon, authenticated;
grant select, insert, update, delete on fishing_private.account_login_limits to service_role;

create function public.fishing_account_login_ticket(login_handle text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  canonical text := upper(btrim(login_handle));
  moment timestamptz := clock_timestamp();
  minute_start timestamptz := date_trunc('minute', moment);
  hour_start timestamptz := date_trunc('hour', moment);
  account_key text;
  global_count integer;
  minute_count integer;
  hour_count integer;
  wait_seconds integer := 0;
  owner_id uuid;
begin
  if canonical is null or canonical !~ '^DY[0-9A-F]{12}$' then
    return jsonb_build_object('allowed', false, 'retry_after', 60);
  end if;
  account_key := md5(canonical);
  -- One short transaction serializes the small project's global and account budgets.
  perform pg_advisory_xact_lock(713905420121::bigint);
  delete from fishing_private.account_login_limits where window_start < moment - interval '2 hours';
  insert into fishing_private.account_login_limits as limits values ('global:m', minute_start, 1)
    on conflict (bucket, window_start) do update set attempts = least(limits.attempts + 1, 100000)
    returning attempts into global_count;
  insert into fishing_private.account_login_limits as limits values (account_key || ':m', minute_start, 1)
    on conflict (bucket, window_start) do update set attempts = least(limits.attempts + 1, 100000)
    returning attempts into minute_count;
  insert into fishing_private.account_login_limits as limits values (account_key || ':h', hour_start, 1)
    on conflict (bucket, window_start) do update set attempts = least(limits.attempts + 1, 100000)
    returning attempts into hour_count;
  if global_count > 60 or minute_count > 5 then
    wait_seconds := greatest(1, ceil(extract(epoch from minute_start + interval '1 minute' - moment))::integer);
  end if;
  if hour_count > 20 then
    wait_seconds := greatest(wait_seconds, ceil(extract(epoch from hour_start + interval '1 hour' - moment))::integer);
  end if;
  if wait_seconds > 0 then
    return jsonb_build_object('allowed', false, 'retry_after', wait_seconds);
  end if;
  select id into owner_id from public.profiles where handle = canonical;
  return jsonb_build_object('allowed', true, 'user_id', owner_id);
end;
$$;
revoke all on function public.fishing_account_login_ticket(text) from public, anon, authenticated;
grant execute on function public.fishing_account_login_ticket(text) to service_role;
