-- Private water-incident notes. Saving is NOT government submission or acknowledgement.
create table public.water_reports (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check(category in ('electric','net','poison','other')),
  province text not null check(length(province) between 1 and 20),
  city text not null check(length(city) between 1 and 40),
  district text not null default '' check(length(district) <= 40),
  location_label text not null check(length(location_label) between 1 and 200),
  longitude double precision check(longitude between -180 and 180),
  latitude double precision check(latitude between -90 and 90),
  crs text not null default 'GCJ-02' check(crs = 'GCJ-02'),
  observed_at timestamptz not null,
  description text not null check(length(description) between 5 and 2000),
  status text not null default 'saved' check(status in ('saved','deleted')),
  consent_version text not null check(consent_version = '2026-11-19-water-v1'),
  signature text not null,
  created_at timestamptz not null default now(),
  check(num_nonnulls(longitude,latitude) in (0,2))
);
create index water_reports_owner_idx on public.water_reports(owner_id,created_at desc,id desc);
alter table public.water_reports enable row level security;
revoke all on public.water_reports from public, anon, authenticated;
grant select on public.water_reports to authenticated;
create policy water_reports_owner_read on public.water_reports for select to authenticated using(owner_id = (select auth.uid()) and status = 'saved');

alter table public.media_assets add column report_id uuid references public.water_reports(id) on delete cascade;
create index media_report_idx on public.media_assets(report_id);
-- Keep the earlier constraint too; every write, including older RPCs, must respect exclusivity.
alter table public.media_assets add constraint media_single_parent check(num_nonnulls(post_id,trip_id,report_id) <= 1);

create function fishing_private.water_report_json(target uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select (to_jsonb(r)-'owner_id'-'signature') || jsonb_build_object('media',coalesce((
    select jsonb_agg(jsonb_build_object('id',m.id,'path',m.path,'width',m.width,'height',m.height) order by m.created_at,m.id)
    from public.media_assets m where m.report_id = r.id), '[]'::jsonb))
  from public.water_reports r where r.id = target and r.owner_id = auth.uid() and r.status = 'saved';
$$;
create function fishing_private.water_report_read(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if nullif(payload->>'id','') is not null then
    result := fishing_private.water_report_json((payload->>'id')::uuid);
    if result is null then raise exception 'NOT_FOUND'; end if;
    return result;
  end if;
  return jsonb_build_object('items',coalesce((select jsonb_agg(fishing_private.water_report_json(id) order by created_at desc,id desc)
    from (select id,created_at from public.water_reports where owner_id = auth.uid() and status = 'saved' order by created_at desc,id desc limit 100) reports),'[]'::jsonb));
end $$;
create function fishing_private.water_report_write(command text,payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); target uuid := (payload->>'id')::uuid; fingerprint text;
  existing public.water_reports; item jsonb;
begin
  if uid is null or not exists(select 1 from public.profiles where id = uid) then raise exception 'AUTH_REQUIRED'; end if;
  if target is null then raise exception 'INVALID_INPUT'; end if;
  if command = 'delete_water_report' then
    update public.water_reports set status = 'deleted', category = 'other', province = '已删除', city = '已删除', district = '',
      location_label = '已删除', longitude = null, latitude = null, description = '此线索已删除', observed_at = now()
      where id = target and owner_id = uid;
    if not found then raise exception 'NOT_FOUND'; end if;
    delete from public.media_assets where report_id = target and owner_id = uid;
    return to_jsonb(true);
  end if;
  if command <> 'save_water_report' then raise exception 'INVALID_INPUT'; end if;
  if payload->>'consent_version' is distinct from '2026-11-19-water-v1' then raise exception 'REPORT_CONSENT_REQUIRED'; end if;
  fingerprint := encode(sha256(convert_to(payload::text,'UTF8')),'hex');
  select * into existing from public.water_reports where id = target;
  if found then
    if existing.owner_id <> uid then raise exception 'NOT_FOUND'; end if;
    if existing.status = 'deleted' then raise exception 'NOT_FOUND'; end if;
    if existing.signature <> fingerprint then raise exception 'EDIT_REQUEST_REUSED'; end if;
    return fishing_private.water_report_json(target);
  end if;
  if (payload->>'observed_at')::timestamptz > now() + interval '5 minutes' then raise exception 'INVALID_INPUT'; end if;
  insert into public.water_reports(id,owner_id,category,province,city,district,location_label,longitude,latitude,
    observed_at,description,consent_version,signature)
  values(target,uid,payload->>'category',trim(payload->>'province'),trim(payload->>'city'),trim(coalesce(payload->>'district','')),
    trim(payload->>'location_label'),(payload->>'longitude')::double precision,(payload->>'latitude')::double precision,
    (payload->>'observed_at')::timestamptz,trim(payload->>'description'),payload->>'consent_version',fingerprint);
  if jsonb_typeof(coalesce(payload->'media','[]')) <> 'array' or jsonb_array_length(coalesce(payload->'media','[]')) > 6 then raise exception 'INVALID_INPUT'; end if;
  for item in select * from jsonb_array_elements(coalesce(payload->'media','[]')) loop
    update public.media_assets set report_id = target where id = (item->>'id')::uuid and owner_id = uid
      and post_id is null and trip_id is null and report_id is null;
    if not found then raise exception 'FORBIDDEN'; end if;
  end loop;
  return fishing_private.water_report_json(target);
end $$;
revoke all on function fishing_private.water_report_json(uuid),fishing_private.water_report_read(jsonb),fishing_private.water_report_write(text,jsonb) from public,anon,authenticated;

do $$
declare source text;
begin
  source := pg_get_functiondef('fishing_private.read_api(text,jsonb)'::regprocedure);
  if position('  case action' in source) = 0 then raise exception 'read_api layout changed'; end if;
  execute replace(source, '  case action', E'  case action\n  when ''water_reports'' then return fishing_private.water_report_read(payload);');
  source := pg_get_functiondef('fishing_private.write_api(text,jsonb)'::regprocedure);
  if position('  case action' in source) = 0 then raise exception 'write_api layout changed'; end if;
  source := replace(source, '  case action', E'  case action\n  when ''save_water_report'', ''delete_water_report'' then return fishing_private.water_report_write(action,payload);');
  source := replace(source, 'and post_id is null and trip_id is null', 'and post_id is null and trip_id is null and report_id is null');
  execute source;
  source := pg_get_functiondef('fishing_private.author_write(text,jsonb)'::regprocedure);
  if position('m.post_id is null and m.trip_id is null' in source) = 0 then raise exception 'author_write layout changed'; end if;
  execute replace(source, 'm.post_id is null and m.trip_id is null', 'm.post_id is null and m.trip_id is null and m.report_id is null');
end $$;
