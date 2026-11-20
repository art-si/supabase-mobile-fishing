-- Anonymous SDK requests need a public proxy, not a leaked security code.
-- Only the server can reserve this separate quota. Stores no IP, query or coordinates.
create table fishing_private.amap_js_quota (
  singleton boolean primary key default true check (singleton),
  minute_start timestamptz not null,
  minute_count integer not null check (minute_count between 1 and 60),
  day_start date not null,
  day_count integer not null check (day_count between 1 and 1000)
);
alter table fishing_private.amap_js_quota enable row level security;
revoke all on fishing_private.amap_js_quota from public, anon, authenticated;
grant usage on schema fishing_private to service_role;
grant select, insert, update on fishing_private.amap_js_quota to service_role;

create function public.fishing_js_map_ticket() returns boolean
language sql security invoker set search_path = '' as $$
  with reservation as (
    insert into fishing_private.amap_js_quota as quota
      (singleton, minute_start, minute_count, day_start, day_count)
    values (true, date_trunc('minute', now()), 1, (now() at time zone 'UTC')::date, 1)
    on conflict (singleton) do update set
      minute_start = excluded.minute_start,
      minute_count = case when quota.minute_start = excluded.minute_start
        then quota.minute_count + 1 else 1 end,
      day_start = excluded.day_start,
      day_count = case when quota.day_start = excluded.day_start
        then quota.day_count + 1 else 1 end
    where (quota.minute_start <> excluded.minute_start or quota.minute_count < 60)
      and (quota.day_start <> excluded.day_start or quota.day_count < 1000)
    returning singleton
  ) select exists(select 1 from reservation);
$$;
revoke all on function public.fishing_js_map_ticket() from public, anon, authenticated;
grant execute on function public.fishing_js_map_ticket() to service_role;
comment on function public.fishing_js_map_ticket() is
  'Server-only atomic quota for public JS map proxy: 60/minute,1000/UTC day; no user or location data.';
