create index fishing_spots_discovery_idx on public.fishing_spots
  ((rtrim(btrim(city), '市')), observed_on desc nulls last, created_at desc, id desc)
  where audience = 'public' and status = 'published' and fishing_status = 'allowed'
    and precision <> 'hidden';

create function public.fishing_discovery_candidates(city_name text)
returns table(id uuid, name text, species text, description text, observed_on date)
language sql stable security invoker set search_path = '' as $$
  select s.id, left(s.name, 100), left(s.species, 100), left(s.description, 700), s.observed_on
  from public.fishing_spots s
  where rtrim(btrim(s.city), '市') = rtrim(btrim(city_name), '市')
    and s.audience = 'public' and s.status = 'published' and s.fishing_status = 'allowed'
    and s.precision <> 'hidden'
  order by s.observed_on desc nulls last, s.created_at desc, s.id desc
  limit 24;
$$;
revoke all on function public.fishing_discovery_candidates(text) from public, anon, authenticated;
grant execute on function public.fishing_discovery_candidates(text) to authenticated;

create table fishing_private.external_accounts (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('douyin', 'toutiao', 'bilibili')),
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  bound_at timestamptz not null default now(),
  primary key (user_id, provider),
  unique (provider, subject_hash)
);
create table fishing_private.external_account_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('douyin', 'toutiao', 'bilibili')),
  state_hash text not null check (state_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  primary key (user_id, provider)
);
alter table fishing_private.external_accounts enable row level security;
alter table fishing_private.external_account_attempts enable row level security;
revoke all on fishing_private.external_accounts, fishing_private.external_account_attempts
  from public, anon, authenticated;
grant select, insert, update, delete on fishing_private.external_accounts,
  fishing_private.external_account_attempts, fishing_private.rate_events to service_role;
grant usage on schema fishing_private to service_role;

create function public.fishing_external_account(
  uid uuid, operation text, platform text default null, state_digest text default null,
  subject_digest text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if operation = 'list' then
    return coalesce((select jsonb_object_agg(a.provider, a.bound_at)
      from fishing_private.external_accounts a where a.user_id = uid), '{}'::jsonb);
  end if;
  if platform is null or platform not in ('douyin', 'toutiao', 'bilibili') then
    raise exception 'INVALID_INPUT';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fishing:external:' || uid::text || ':' || platform, 0));
  case operation
    when 'start' then
      if exists(select from fishing_private.external_accounts a
        where a.user_id = uid and a.provider = platform) then
        return '"SOCIAL_ALREADY_BOUND"'::jsonb;
      end if;
      insert into fishing_private.external_account_attempts(user_id, provider, state_hash, expires_at)
        values(uid, platform, state_digest, now() + interval '10 minutes')
        on conflict (user_id, provider) do update
        set state_hash = excluded.state_hash, expires_at = excluded.expires_at;
    when 'check', 'finish' then
      if not exists(select from fishing_private.external_account_attempts a
        where a.user_id = uid and a.provider = platform and a.state_hash = state_digest
          and a.expires_at > now()) then
        return '"SOCIAL_EXPIRED"'::jsonb;
      end if;
      if operation = 'finish' then
        delete from fishing_private.external_account_attempts a
          where a.user_id = uid and a.provider = platform;
        insert into fishing_private.external_accounts(user_id, provider, subject_hash)
          values(uid, platform, subject_digest) on conflict do nothing;
        if not found then return '"SOCIAL_CONFLICT"'::jsonb; end if;
      end if;
    when 'unlink' then
      delete from fishing_private.external_account_attempts a
        where a.user_id = uid and a.provider = platform;
      delete from fishing_private.external_accounts a
        where a.user_id = uid and a.provider = platform;
    else raise exception 'INVALID_INPUT';
  end case;
  return '"ok"'::jsonb;
end $$;
revoke all on function public.fishing_external_account(uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.fishing_external_account(uuid,text,text,text,text) to service_role;

create index rate_events_spot_ai_idx on fishing_private.rate_events(created_at)
  where action = 'spot_ai';

create function public.fishing_discovery_ticket(uid uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('fishing:spot-ai:quota', 0));
  delete from fishing_private.rate_events where action = 'spot_ai'
    and created_at <= now() - interval '1 day';
  if (select count(*) from fishing_private.rate_events where action = 'spot_ai') >= 300
    or (select count(*) from fishing_private.rate_events where action = 'spot_ai' and user_id = uid) >= 12
    or (select count(*) from fishing_private.rate_events where action = 'spot_ai' and user_id = uid
      and created_at > now() - interval '1 minute') >= 2 then
    return false;
  end if;
  insert into fishing_private.rate_events(user_id, action) values(uid, 'spot_ai');
  return true;
end $$;
revoke all on function public.fishing_discovery_ticket(uuid) from public, anon, authenticated;
grant execute on function public.fishing_discovery_ticket(uuid) to service_role;
