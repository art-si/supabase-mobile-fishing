-- Private evidence uses the same ordered image/video media contract as publishing.
create or replace function fishing_private.video_parent_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.kind='video' and new.message_id is not null then raise exception 'VIDEO_NOT_ALLOWED';end if;
  return new;
end $$;

create or replace function fishing_private.water_report_json(target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select (to_jsonb(r)-'owner_id'-'signature') || jsonb_build_object('media',coalesce((
    select jsonb_agg(fishing_private.asset_json(m) order by m.sort_order,m.created_at,m.id)
    from public.media_assets m where m.report_id=r.id),'[]'::jsonb))
  from public.water_reports r where r.id=target and r.owner_id=auth.uid() and r.status='saved';
$$;

do $migration$
declare source text; needle text;
begin
  source:=pg_get_functiondef('fishing_private.water_report_write(text,jsonb)'::regprocedure);
  needle:='existing public.water_reports; item jsonb;';
  if position(needle in source)=0 then raise exception 'REPORT_ORDER_DECLARATION_MISMATCH';end if;
  source:=replace(source,needle,'existing public.water_reports; item jsonb; media_order integer:=0;');
  needle:='update public.media_assets set report_id = target where id = (item->>''id'')::uuid and owner_id = uid';
  if position(needle in source)=0 then raise exception 'REPORT_ORDER_WRITE_MISMATCH';end if;
  source:=replace(source,needle,'update public.media_assets set report_id = target,sort_order=media_order where id = (item->>''id'')::uuid and owner_id = uid');
  needle:=$old$    if not found then raise exception 'FORBIDDEN'; end if;
  end loop;$old$;
  if position(needle in source)=0 then raise exception 'REPORT_ORDER_INCREMENT_MISMATCH';end if;
  source:=replace(source,needle,$new$    if not found then raise exception 'FORBIDDEN'; end if;
    media_order:=media_order+1;
  end loop;$new$);
  execute source;
end $migration$;
