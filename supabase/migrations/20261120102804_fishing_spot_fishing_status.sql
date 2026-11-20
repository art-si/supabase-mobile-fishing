-- Two author-managed states. An allowed point is not an official legal finding.
alter table public.fishing_spots add column fishing_status text not null default 'allowed'
  check (fishing_status in ('allowed','prohibited'));

create function fishing_private.spot_fishing_status(payload jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $$
begin
  if payload ? 'fishing_status' and
    (jsonb_typeof(payload->'fishing_status') is distinct from 'string'
     or payload->>'fishing_status' not in ('allowed','prohibited')) then raise exception 'INVALID_INPUT';end if;
  return coalesce(payload->>'fishing_status','allowed');
end $$;
revoke all on function fishing_private.spot_fishing_status(jsonb) from public,anon,authenticated,service_role;

do $migration$
declare source text; needle text;
begin
  source:=pg_get_functiondef('fishing_private.author_write(text,jsonb)'::regprocedure);
  needle:='fee_note, observed_on, audience, precision, status)';
  if position(needle in source)=0 then raise exception 'spot create columns changed';end if;
  source:=replace(source,needle,'fee_note, observed_on, audience, precision, fishing_status, status)');
  needle:=$old$scope, coalesce(payload->>'precision','hidden'),$old$;
  if position(needle in source)=0 then raise exception 'spot create values changed';end if;
  source:=replace(source,needle,needle||' fishing_private.spot_fishing_status(payload),');
  execute source;

  source:=pg_get_functiondef('fishing_private.content_update_fields(text,jsonb)'::regprocedure);
  needle:='  return fields;';
  if position(needle in source)=0 then raise exception 'spot update fields changed';end if;
  execute replace(source,needle,$new$  if kind='spot' and payload ? 'fishing_status' then
    fields:=fields||jsonb_build_object('fishing_status',fishing_private.spot_fishing_status(payload));
  end if;
  return fields;$new$);

  source:=pg_get_functiondef('fishing_private.install_content_update(text,uuid,jsonb)'::regprocedure);
  needle:=$old$update public.fishing_spots set name=fields->>'name',$old$;
  if position(needle in source)=0 then raise exception 'spot install fields changed';end if;
  execute replace(source,needle,$new$update public.fishing_spots set
      fishing_status=case when fields ? 'fishing_status' then fishing_private.spot_fishing_status(fields) else fishing_status end,
      name=fields->>'name',$new$);
end $migration$;
