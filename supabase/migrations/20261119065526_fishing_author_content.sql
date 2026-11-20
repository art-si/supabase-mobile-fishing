-- Owner edits share the moderation revision, so neither side can overwrite a stale view.
alter table public.trips add column revision integer not null default 1 check (revision > 0);

create table fishing_private.author_write_receipts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  signature text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table fishing_private.author_write_receipts enable row level security;
revoke all on fishing_private.author_write_receipts from public, anon, authenticated;

create function fishing_private.author_read(content_type text, target uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); item jsonb; version integer;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if content_type = 'post' then
    select fishing_private.post_json(p.id), p.review_revision into item, version
      from public.posts p where p.id = target and p.author_id = uid and p.status <> 'deleted';
  elsif content_type = 'spot' then
    select fishing_private.spot_json(s.id), s.review_revision into item, version
      from public.fishing_spots s where s.id = target and s.author_id = uid and s.status <> 'deleted';
  elsif content_type = 'trip' then
    select fishing_private.trip_json(t.id), t.revision into item, version
      from public.trips t where t.id = target and t.owner_id = uid;
  else raise exception 'INVALID_INPUT'; end if;
  if item is null then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object('item', item, 'revision', version);
end $$;

create function fishing_private.author_write(command text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); target uuid := (payload->>'id')::uuid;
  content_type text := payload->>'type'; request_uuid uuid;
  signature text; receipt fishing_private.author_write_receipts;
  version integer; scope text; next_status text; result jsonb;
  photo_ids uuid[]; photo_count integer;
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid) then
    raise exception 'AUTH_REQUIRED';
  end if;
  if command not in ('save_spot', 'update_content', 'withdraw_content') or target is null then
    raise exception 'INVALID_INPUT';
  end if;
  -- Same lock order as write_api; no network work while holding this transaction.
  perform pg_advisory_xact_lock(hashtextextended('fishing-user:' || uid::text, 0));
  if command = 'save_spot' then
    request_uuid := target; content_type := 'spot';
  else request_uuid := (payload->>'request_id')::uuid; end if;
  if request_uuid is null or content_type not in ('post','spot','trip') or content_type is null then
    raise exception 'INVALID_INPUT';
  end if;
  signature := encode(sha256(convert_to(jsonb_build_array(command, payload)::text, 'UTF8')), 'hex');
  select * into receipt from fishing_private.author_write_receipts r
    where r.user_id = uid and r.request_id = request_uuid;
  if found then
    if receipt.signature <> signature then raise exception 'EDIT_REQUEST_REUSED'; end if;
    -- Return only the durable receipt, never old private content or an old signed photo URL.
    if command = 'save_spot' then
      return fishing_private.author_read('spot', target)->'item';
    end if;
    return receipt.result;
  end if;

  if command = 'save_spot' then
    -- Legacy clients may create/retry, but cannot bypass revision checks via upsert.
    if exists(select 1 from public.fishing_spots where id = target) then
      raise exception 'EDIT_CONFLICT';
    end if;
    scope := coalesce(payload->>'audience', 'private');
    insert into public.fishing_spots(id, author_id, name, city, water_type, species, description,
      fee_note, observed_on, audience, precision, status)
    values(target, uid, trim(payload->>'name'), trim(payload->>'city'), payload->>'water_type',
      coalesce(payload->>'species',''), coalesce(payload->>'description',''), coalesce(payload->>'fee_note','未核实'),
      (payload->>'observed_on')::date, scope, coalesce(payload->>'precision','hidden'),
      case when scope = 'private' then 'published' else 'pending' end);
  else
    if content_type = 'post' then
      select review_revision into version from public.posts
        where id = target and author_id = uid and status <> 'deleted' for update;
    elsif content_type = 'spot' then
      select review_revision into version from public.fishing_spots
        where id = target and author_id = uid and status <> 'deleted' for update;
    else
      select revision into version from public.trips where id = target and owner_id = uid for update;
    end if;
    if not found then raise exception 'NOT_FOUND'; end if;
    if (payload->>'revision')::integer is distinct from version then raise exception 'EDIT_CONFLICT'; end if;

    if command = 'withdraw_content' then
      if content_type = 'trip' then raise exception 'INVALID_INPUT'; end if;
      if content_type = 'post' then
        update public.posts set audience = 'private', status = 'published' where id = target;
      else
        update public.fishing_spots set audience = 'private', status = 'published' where id = target;
      end if;
    else
      scope := coalesce(payload->>'audience', 'private');
      next_status := case when scope = 'private' then 'published' else 'pending' end;
      if content_type = 'post' then
        update public.posts set title = trim(payload->>'title'), body = trim(payload->>'body'),
          kind = payload->>'kind', species = coalesce(payload->>'species',''), method = coalesce(payload->>'method',''),
          bait = coalesce(payload->>'bait',''), weight_kg = nullif(payload->>'weight','')::numeric,
          occurred_on = (payload->>'occurred_on')::date, location_label = coalesce(payload->>'location_label',''),
          audience = scope, status = next_status where id = target;
      elsif content_type = 'trip' then
        update public.trips set title = trim(payload->>'title'), body = trim(payload->>'body'),
          species = coalesce(payload->>'species',''), method = coalesce(payload->>'method',''),
          bait = coalesce(payload->>'bait',''), weight_kg = nullif(payload->>'weight','')::numeric,
          count = nullif(payload->>'count','')::integer, occurred_on = (payload->>'occurred_on')::date,
          revision = revision + 1 where id = target;
      else
        update public.fishing_spots set name = trim(payload->>'name'), city = trim(payload->>'city'),
          water_type = payload->>'water_type', species = coalesce(payload->>'species',''),
          description = coalesce(payload->>'description',''), fee_note = coalesce(payload->>'fee_note','未核实'),
          observed_on = (payload->>'observed_on')::date, audience = scope,
          precision = coalesce(payload->>'precision','hidden'), status = next_status where id = target;
      end if;
    end if;
  end if;

  if content_type = 'spot' and command <> 'withdraw_content' then
    if nullif(payload->>'latitude','') is not null and nullif(payload->>'longitude','') is not null then
      insert into public.spot_locations(spot_id, longitude, latitude, access_note)
        values(target, (payload->>'longitude')::double precision, (payload->>'latitude')::double precision,
          coalesce(payload->>'access_note',''))
      on conflict(spot_id) do update set longitude = excluded.longitude, latitude = excluded.latitude,
        access_note = excluded.access_note;
    else
      if payload->>'precision' in ('exact','area') then raise exception 'INVALID_INPUT'; end if;
      delete from public.spot_locations where spot_id = target;
    end if;
  elsif content_type in ('post','trip') and command = 'update_content' then
    if jsonb_typeof(coalesce(payload->'media','[]')) <> 'array' then raise exception 'INVALID_INPUT'; end if;
    select array_agg((m->>'id')::uuid), count(*) into photo_ids, photo_count
      from jsonb_array_elements(coalesce(payload->'media','[]')) m;
    photo_ids := coalesce(photo_ids, array[]::uuid[]);
    if photo_count > 9 or photo_count <> (select count(distinct p) from unnest(photo_ids) p) then
      raise exception 'INVALID_INPUT';
    end if;
    -- Never steal media from another author or another record. Invalid input rolls back the edit.
    if photo_count <> (select count(*) from public.media_assets m where m.id = any(photo_ids) and m.owner_id = uid
      and ((m.post_id is null and m.trip_id is null)
        or (content_type = 'post' and m.post_id = target)
        or (content_type = 'trip' and m.trip_id = target))) then raise exception 'FORBIDDEN'; end if;
    update public.media_assets set post_id = null, trip_id = null
      where owner_id = uid and ((content_type = 'post' and post_id = target) or (content_type = 'trip' and trip_id = target))
        and not (id = any(photo_ids));
    update public.media_assets set post_id = case when content_type = 'post' then target end,
      trip_id = case when content_type = 'trip' then target end where owner_id = uid and id = any(photo_ids);
  end if;
  version := (fishing_private.author_read(content_type, target)->>'revision')::integer;
  result := jsonb_build_object('id', target, 'type', content_type, 'revision', version, 'request_id', request_uuid);
  insert into fishing_private.author_write_receipts(user_id, request_id, signature, result)
    values(uid, request_uuid, signature, result);
  if command = 'save_spot' then return fishing_private.spot_json(target); end if;
  return result;
end $$;
revoke all on function fishing_private.author_read(text, uuid), fishing_private.author_write(text, jsonb)
  from public, anon, authenticated;

-- Preserve existing RPC grants, abuse limits, and all unrelated commands.
do $$
declare source text; old_block text;
begin
  source := pg_get_functiondef('fishing_private.read_api(text,jsonb)'::regprocedure);
  if position('  case action' in source) = 0 then raise exception 'read_api layout changed'; end if;
  source := replace(source, '  case action', E'  case action\n  when ''edit_content'' then\n    return fishing_private.author_read(payload->>''type'', (payload->>''id'')::uuid);');
  execute source;
  source := pg_get_functiondef('fishing_private.write_api(text,jsonb)'::regprocedure);
  old_block := substring(source from '  when ''save_spot'' then[\s\S]*?(?=  when ''spot_bookmark'' then)');
  if old_block is null then raise exception 'save_spot layout changed'; end if;
  source := replace(source, old_block, E'  when ''save_spot'', ''update_content'', ''withdraw_content'' then\n    return fishing_private.author_write(action, payload);\n');
  execute source;
end $$;
