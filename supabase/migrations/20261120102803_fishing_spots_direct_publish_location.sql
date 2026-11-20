-- Spot names and addresses are independent. Detailed addresses live beside the
-- private coordinates and obey the same exact/area/hidden projection rules.
alter table public.spot_locations add column location_label text not null default ''
  check (length(location_label) <= 240);

create function fishing_private.spot_location_label(payload jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $$
begin
  if payload ? 'location_label' and
    (jsonb_typeof(payload->'location_label') is distinct from 'string'
     or length(payload->>'location_label') > 240) then raise exception 'INVALID_INPUT';end if;
  return trim(coalesce(payload->>'location_label',''));
end $$;
revoke all on function fishing_private.spot_location_label(jsonb) from public,anon,authenticated,service_role;

do $migration$
declare source text; needle text;
begin
  source:=pg_get_functiondef('fishing_private.author_write(text,jsonb)'::regprocedure);
  needle:='case when scope = ''private'' then ''published'' else ''pending'' end';
  if (length(source)-length(replace(source,needle,'')))/length(needle)<>2 then raise exception 'spot status anchors changed';end if;
  source:=replace(source,needle,'''published''');
  needle:='  if content_type = ''spot'' and command <> ''withdraw_content'' then';
  if position(needle in source)=0 then raise exception 'spot write anchor changed';end if;
  source:=replace(source,needle,needle||E'\n    perform fishing_private.spot_location_label(payload);');
  needle:='insert into public.spot_locations(spot_id, longitude, latitude, access_note)';
  if position(needle in source)=0 then raise exception 'spot location insert changed';end if;
  source:=replace(source,needle,'insert into public.spot_locations(spot_id, longitude, latitude, access_note, location_label)');
  source:=replace(source,$old$coalesce(payload->>'access_note',''))
      on conflict$old$,$new$coalesce(payload->>'access_note',''), fishing_private.spot_location_label(payload))
      on conflict$new$);
  source:=replace(source,'access_note = excluded.access_note;',
    'access_note = excluded.access_note, location_label = case when payload ? ''location_label'' then excluded.location_label else spot_locations.location_label end;');
  execute source;

  source:=pg_get_functiondef('fishing_private.content_update_fields(text,jsonb)'::regprocedure);
  needle:='  return fields;';
  if position(needle in source)=0 then raise exception 'spot fields anchor changed';end if;
  execute replace(source,needle,$new$  if kind='spot' and payload ? 'location_label' then
    fields:=fields||jsonb_build_object('location_label',fishing_private.spot_location_label(payload));
  end if;
  return fields;$new$);

  source:=pg_get_functiondef('fishing_private.install_content_update(text,uuid,jsonb)'::regprocedure);
  needle:='insert into public.spot_locations(spot_id,longitude,latitude,access_note)';
  if position(needle in source)=0 then raise exception 'spot install anchor changed';end if;
  source:=replace(source,needle,'insert into public.spot_locations(spot_id,longitude,latitude,access_note,location_label)');
  source:=replace(source,$old$(fields->>'latitude')::double precision,fields->>'access_note')$old$,
    $new$(fields->>'latitude')::double precision,fields->>'access_note',fishing_private.spot_location_label(fields))$new$);
  source:=replace(source,'access_note=excluded.access_note;',
    'access_note=excluded.access_note,location_label=case when fields ? ''location_label'' then excluded.location_label else spot_locations.location_label end;');
  execute source;

  source:=pg_get_functiondef('fishing_private.handle_content_update(text,jsonb)'::regprocedure);
  needle:='if kind=''post'' and command=''update_content'' then';
  if position(needle in source)=0 then raise exception 'direct publication anchor changed';end if;
  source:=replace(source,needle,'if kind in (''post'',''spot'') and command=''update_content'' then');
  needle:=$old$    fields:=fishing_private.content_update_fields(kind,payload);
    perform fishing_private.install_content_update(kind,target,fields);$old$;
  if position(needle in source)=0 then raise exception 'direct spot media anchor changed';end if;
  execute replace(source,needle,$new$    fields:=fishing_private.content_update_fields(kind,payload);
    if kind='spot' and payload ? 'media' then fields:=fields||jsonb_build_object('media',payload->'media');end if;
    perform fishing_private.install_content_update(kind,target,fields);$new$);

  source:=pg_get_functiondef('fishing_private.spot_json(uuid)'::regprocedure);
  needle:=$old$'access_note',case$old$;
  if position(needle in source)=0 then raise exception 'spot projection anchor changed';end if;
  execute replace(source,needle,$new$'location_label',case when s.author_id=(select auth.uid()) or s.precision='exact' then coalesce(l.location_label,'') else '' end,
    'access_note',case$new$);
end $migration$;

alter table public.fishing_spots alter column status set default 'published';

-- Install already submitted edits only while their base publication is live.
-- Retain rejected/hidden/deleted records and all existing audience restrictions.
do $migration$
declare proposal record; previous_uid text:=current_setting('request.jwt.claim.sub',true);
begin
  for proposal in
    select u.target_id,u.owner_id,u.fields from fishing_private.content_updates u
    join public.fishing_spots s on s.id=u.target_id and s.author_id=u.owner_id
    where u.target_type='spot' and u.status='pending' and s.status='published'
    order by u.target_id
  loop
    perform set_config('request.jwt.claim.sub',proposal.owner_id::text,true);
    perform fishing_private.install_content_update('spot',proposal.target_id,proposal.fields);
  end loop;
  perform set_config('request.jwt.claim.sub',coalesce(previous_uid,''),true);
end $migration$;
update public.fishing_spots set status='published' where status='pending';
