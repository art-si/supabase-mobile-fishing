-- A bounded, ordered aggregate owned by its private trip; no independent child lifecycle.
-- Keep legacy summary columns for old readers, but derive them exclusively on the server.
create function fishing_private.normalize_trip_catches(records jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare item jsonb; normalized jsonb := '[]'; fish text; tails numeric; kg numeric;
  total_tails numeric := 0; total_kg numeric := 0;
begin
  if records is null or jsonb_typeof(records) <> 'array' or octet_length(records::text) > 16384 then
    raise exception 'INVALID_INPUT';
  end if;
  if jsonb_array_length(records) > 20 then raise exception 'INVALID_INPUT'; end if;
  for item in select value from jsonb_array_elements(records) loop
    if jsonb_typeof(item) <> 'object' then raise exception 'INVALID_INPUT'; end if;
    if exists(select 1 from jsonb_object_keys(item) k where k not in ('species','count','weight_kg'))
      or jsonb_typeof(item->'species') is distinct from 'string'
      or coalesce(jsonb_typeof(item->'count'),'null') not in ('number','null')
      or coalesce(jsonb_typeof(item->'weight_kg'),'null') not in ('number','null') then
      raise exception 'INVALID_INPUT';
    end if;
    fish := trim(item->>'species');
    tails := (item->>'count')::numeric; kg := (item->>'weight_kg')::numeric;
    if length(fish) > 60 or tails < 0 or tails > 10000 or trunc(tails) <> tails
      or kg < 0 or kg > 10000 then raise exception 'INVALID_INPUT'; end if;
    total_tails := total_tails + coalesce(tails,0); total_kg := total_kg + coalesce(kg,0);
    if total_tails > 10000 or total_kg > 10000 then raise exception 'INVALID_INPUT'; end if;
    if fish <> '' or tails is not null or kg is not null then
      normalized := normalized || jsonb_build_array(jsonb_build_object('species',fish,'count',tails::integer,'weight_kg',kg));
    end if;
  end loop;
  return normalized;
end $$;

create function fishing_private.trip_catches_input(payload jsonb, previous_records jsonb default null)
returns jsonb language plpgsql immutable set search_path = '' as $$
begin
  if payload ? 'catch_records' then
    return fishing_private.normalize_trip_catches(payload->'catch_records');
  end if;
  -- Old clients may edit old single-catch logs, but cannot flatten a multi-catch log.
  if previous_records is not null and jsonb_array_length(previous_records) > 1 then
    raise exception 'CATCH_DETAILS_REQUIRED';
  end if;
  return fishing_private.normalize_trip_catches(jsonb_build_array(jsonb_build_object(
    'species',coalesce(payload->>'species',''),
    'count',nullif(payload->>'count','')::numeric,
    'weight_kg',nullif(payload->>'weight','')::numeric)));
end $$;

alter table public.trips add column catch_records jsonb;
update public.trips set catch_records = fishing_private.trip_catches_input(
  jsonb_build_object('species',species,'count',count,'weight',weight_kg));
alter table public.trips alter column catch_records set not null;
alter table public.trips alter column catch_records set default '[]'::jsonb;
alter table public.trips add constraint trips_catch_records_check
  check (catch_records = fishing_private.normalize_trip_catches(catch_records));

-- Only IDs survive log deletion, so a delayed create retry cannot resurrect private text/catches.
-- Account deletion cascades this receipt; it stores no title, photo, location or catch payload.
create table fishing_private.trip_create_receipts (
  trip_id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade
);
create index trip_create_receipts_owner_idx on fishing_private.trip_create_receipts(owner_id);
alter table fishing_private.trip_create_receipts enable row level security;
revoke all on fishing_private.trip_create_receipts from public, anon, authenticated;
insert into fishing_private.trip_create_receipts(trip_id,owner_id) select id,owner_id from public.trips;

create function fishing_private.summarize_trip_catches()
returns trigger language plpgsql set search_path = '' as $$
declare size integer;
begin
  if tg_op = 'INSERT' then
    insert into fishing_private.trip_create_receipts(trip_id,owner_id) values(new.id,new.owner_id)
      on conflict do nothing;
    if not found then raise exception 'NOT_FOUND'; end if;
  end if;
  new.catch_records := fishing_private.normalize_trip_catches(new.catch_records);
  size := jsonb_array_length(new.catch_records);
  new.species := case when size = 0 then '' when size = 1 then new.catch_records->0->>'species' else '多条渔获' end;
  select case when count(item->>'count') = size and size > 0 then sum((item->>'count')::integer) end,
    case when count(item->>'weight_kg') = size and size > 0 then sum((item->>'weight_kg')::numeric) end
    into new.count, new.weight_kg from jsonb_array_elements(new.catch_records) item;
  return new;
end $$;
create trigger trips_summarize_catches before insert or update of catch_records, species, count, weight_kg
  on public.trips for each row execute function fishing_private.summarize_trip_catches();
revoke all on function fishing_private.normalize_trip_catches(jsonb),
  fishing_private.trip_catches_input(jsonb,jsonb), fishing_private.summarize_trip_catches()
  from public, anon, authenticated;

-- Surgical changes preserve current rate limits, receipts, revisions and media ownership checks.
-- In particular, never update catches after an idempotent create/edit has returned its receipt.
do $$
declare source text; old_sql text; new_sql text;
begin
  source := pg_get_functiondef('fishing_private.write_api(text,jsonb)'::regprocedure);
  old_sql := $old$insert into public.trips(id,owner_id,title,body,occurred_on,species,method,bait,weight_kg,count) values(target,uid,trim(payload->>'title'),trim(payload->>'body'),(payload->>'occurred_on')::date,coalesce(payload->>'species',''),coalesce(payload->>'method',''),coalesce(payload->>'bait',''),nullif(payload->>'weight','')::numeric,nullif(payload->>'count','')::integer);$old$;
  new_sql := $new$insert into public.trips(id,owner_id,title,body,occurred_on,method,bait,catch_records) values(target,uid,trim(payload->>'title'),trim(payload->>'body'),(payload->>'occurred_on')::date,coalesce(payload->>'method',''),coalesce(payload->>'bait',''),fishing_private.trip_catches_input(payload));$new$;
  if (length(source)-length(replace(source,old_sql,''))) <> length(old_sql) then
    raise exception 'save_trip layout changed; review before migrating'; end if;
  execute replace(source,old_sql,new_sql);

  source := pg_get_functiondef('fishing_private.author_write(text,jsonb)'::regprocedure);
  old_sql := $old$      elsif content_type = 'trip' then
        update public.trips set title = trim(payload->>'title'), body = trim(payload->>'body'),
          species = coalesce(payload->>'species',''), method = coalesce(payload->>'method',''),
          bait = coalesce(payload->>'bait',''), weight_kg = nullif(payload->>'weight','')::numeric,
          count = nullif(payload->>'count','')::integer, occurred_on = (payload->>'occurred_on')::date,
          revision = revision + 1 where id = target;$old$;
  new_sql := $new$      elsif content_type = 'trip' then
        update public.trips set title = trim(payload->>'title'), body = trim(payload->>'body'),
          method = coalesce(payload->>'method',''), bait = coalesce(payload->>'bait',''),
          catch_records = fishing_private.trip_catches_input(payload, catch_records),
          occurred_on = (payload->>'occurred_on')::date, revision = revision + 1 where id = target;$new$;
  if (length(source)-length(replace(source,old_sql,''))) <> length(old_sql) then
    raise exception 'trip edit layout changed; review before migrating'; end if;
  execute replace(source,old_sql,new_sql);
end $$;
