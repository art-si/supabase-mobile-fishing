-- Private report edits keep the same record. Saving or editing never submits to an outside authority.
alter table public.water_reports add column revision integer not null default 1 check(revision > 0);
alter table public.water_reports add column updated_at timestamptz not null default now();
update public.water_reports set updated_at=created_at;

create table fishing_private.water_report_edit_receipts (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  report_id uuid not null references public.water_reports(id) on delete cascade,
  signature text not null,
  primary key(owner_id,request_id)
);
alter table fishing_private.water_report_edit_receipts enable row level security;
revoke all on fishing_private.water_report_edit_receipts from public,anon,authenticated;
create index water_report_edit_receipts_report_idx on fishing_private.water_report_edit_receipts(report_id);

create function fishing_private.update_water_report(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid(); target uuid:=(payload->>'id')::uuid;
  request_uuid uuid:=(payload->>'request_id')::uuid;
  expected integer:=(payload->>'expected_revision')::integer;
  existing public.water_reports; prior fishing_private.water_report_edit_receipts;
  fingerprint text; asset_ids uuid[]; item jsonb; media_order integer:=0;
begin
  if uid is null or not exists(select 1 from public.profiles where id=uid) then raise exception 'AUTH_REQUIRED';end if;
  if target is null or request_uuid is null or expected is null or expected<1 then raise exception 'INVALID_INPUT';end if;
  if payload->>'consent_version' is distinct from '2026-11-19-water-v1' then raise exception 'REPORT_CONSENT_REQUIRED';end if;
  select * into existing from public.water_reports where id=target and owner_id=uid for update;
  if not found or existing.status<>'saved' then raise exception 'NOT_FOUND';end if;
  fingerprint:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
  -- A request can be retried, but cannot be reused for another record or changed input.
  perform pg_advisory_xact_lock(hashtextextended(uid::text||request_uuid::text,0));
  select * into prior from fishing_private.water_report_edit_receipts where owner_id=uid and request_id=request_uuid;
  if found then
    if prior.report_id<>target or prior.signature<>fingerprint then raise exception 'EDIT_REQUEST_REUSED';end if;
    return fishing_private.water_report_json(target);
  end if;
  if existing.revision<>expected then raise exception 'EDIT_CONFLICT';end if;
  if (payload->>'observed_at')::timestamptz>now()+interval '5 minutes' then raise exception 'INVALID_INPUT';end if;
  if jsonb_typeof(coalesce(payload->'media','[]'::jsonb))<>'array'
    or jsonb_array_length(coalesce(payload->'media','[]'::jsonb))>6 then raise exception 'INVALID_INPUT';end if;
  select coalesce(array_agg((value->>'id')::uuid),'{}'::uuid[]) into asset_ids
    from jsonb_array_elements(coalesce(payload->'media','[]'::jsonb));
  if array_position(asset_ids,null) is not null or cardinality(asset_ids)<>(select count(distinct x) from unnest(asset_ids) x)
    then raise exception 'INVALID_INPUT';end if;
  -- Lock deterministically before checking parent ownership, including reused attachments.
  perform id from public.media_assets where id=any(asset_ids) or report_id=target order by id for update;
  if (select count(*) from public.media_assets m where m.id=any(asset_ids) and m.owner_id=uid
      and (m.report_id is null or m.report_id=target) and m.post_id is null and m.trip_id is null
      and m.message_id is null and m.spot_id is null and m.avatar_profile_id is null and not m.is_staged)
      <>cardinality(asset_ids) then raise exception 'FORBIDDEN';end if;
  update public.water_reports set category=payload->>'category',province=trim(payload->>'province'),city=trim(payload->>'city'),
    district=trim(coalesce(payload->>'district','')),location_label=trim(payload->>'location_label'),
    longitude=(payload->>'longitude')::double precision,latitude=(payload->>'latitude')::double precision,
    observed_at=(payload->>'observed_at')::timestamptz,description=trim(payload->>'description'),
    revision=revision+1,updated_at=now() where id=target and owner_id=uid;
  -- Existing media-delete trigger queues physical cleanup; removed evidence is no longer signable.
  delete from public.media_assets where report_id=target and owner_id=uid and not(id=any(asset_ids));
  for item in select * from jsonb_array_elements(coalesce(payload->'media','[]'::jsonb)) loop
    update public.media_assets set report_id=target,sort_order=media_order where id=(item->>'id')::uuid;
    media_order:=media_order+1;
  end loop;
  insert into fishing_private.water_report_edit_receipts(owner_id,request_id,report_id,signature)
    values(uid,request_uuid,target,fingerprint);
  return fishing_private.water_report_json(target);
end $$;
revoke all on function fishing_private.update_water_report(jsonb) from public,anon,authenticated;

do $migration$
declare source text; needle text;
begin
  source:=pg_get_functiondef('fishing_private.write_api(text,jsonb)'::regprocedure);
  needle:='  case action';
  if position(needle in source)=0 then raise exception 'REPORT_EDIT_DISPATCH_MISMATCH';end if;
  execute replace(source,needle,E'  case action\n  when ''update_water_report'' then return fishing_private.update_water_report(payload);');
  source:=pg_get_functiondef('fishing_private.water_report_write(text,jsonb)'::regprocedure);
  needle:='    delete from public.media_assets where report_id = target and owner_id = uid;';
  if position(needle in source)=0 then raise exception 'REPORT_EDIT_DELETE_MISMATCH';end if;
  execute replace(source,needle,needle||E'\n    delete from fishing_private.water_report_edit_receipts where report_id=target and owner_id=uid;');
end $migration$;
