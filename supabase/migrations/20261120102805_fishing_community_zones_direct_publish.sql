-- Community boundaries are immediately visible with community provenance.
-- They never become official records. Existing moderation and feedback remain.
do $migration$
declare source text; needle text;
begin
  source:=pg_get_functiondef('fishing_private.zones_write(text,jsonb)'::regprocedure);
  needle:='source_url,boundary)';
  if position(needle in source)=0 then raise exception 'community insert columns changed';end if;
  source:=replace(source,needle,'source_url,boundary,status)');
  needle:=$old$btrim(coalesce(payload->>'source_url','')),payload->'boundary')$old$;
  if position(needle in source)=0 then raise exception 'community insert values changed';end if;
  execute replace(source,needle,$new$btrim(coalesce(payload->>'source_url','')),payload->'boundary','published')$new$);

  source:=pg_get_functiondef('fishing_private.zone_json(public.fishing_zone_reports)'::regprocedure);
  needle:='钓友沿水域标记的禁钓范围，已审核；以当地最新公告和现场标识为准。';
  if position(needle in source)=0 then raise exception 'community provenance changed';end if;
  execute replace(source,needle,'钓友圈定的禁钓范围，以当地公告和现场标识为准。');
end $migration$;

alter table public.fishing_zone_reports alter column status set default 'published';
update public.fishing_zone_reports set status='published',revision=revision+1,updated_at=now()
where status='pending' and boundary is not null
  and expires_on >= (now() at time zone 'Asia/Shanghai')::date;
