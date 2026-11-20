-- Publishing extension, layered after catch measurements. Existing RLS and review gates remain authoritative.
alter table public.media_assets add column kind text not null default 'image' check(kind in ('image','video')),
  add column size bigint not null default 0 check(size>=0),
  add column duration numeric check(duration>=0),
  add constraint media_upload_size check((kind='image' and size<=8388608) or (kind='video' and size<=20971520));
alter table public.posts add column occurred_at timestamptz,
  add column additives text not null default '' check(length(additives)<=60),
  add column topic text not null default '' check(length(topic)<=40),
  add column location_longitude numeric,
  add column location_latitude numeric,
  add constraint post_location_pair check((location_longitude is null and location_latitude is null) or
    (location_longitude is not null and location_latitude is not null and location_longitude between -180 and 180 and location_latitude between -90 and 90 and
     location_longitude=round(location_longitude/0.02)*0.02 and location_latitude=round(location_latitude/0.02)*0.02));
alter table public.trips add column occurred_at timestamptz,
  add column additives text not null default '' check(length(additives)<=60);
update storage.buckets set file_size_limit=20971520,allowed_mime_types=array['image/jpeg','image/png','video/mp4'] where id='fishing-media';

create function fishing_private.publishing_time(payload jsonb) returns timestamptz
language plpgsql immutable security invoker set search_path='' as $$
declare moment timestamptz; raw text:=payload->>'occurred_at';
begin
  if raw is null or raw='' then return null;end if;
  if length(raw)>40 or jsonb_typeof(payload->'occurred_at')<>'string' or raw !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then raise exception 'INVALID_INPUT';end if;
  moment:=raw::timestamptz;
  if not isfinite(moment) or (moment at time zone 'Asia/Shanghai')::date is distinct from (payload->>'occurred_on')::date then raise exception 'INVALID_INPUT';end if;
  return moment;
exception when invalid_datetime_format or datetime_field_overflow then raise exception 'INVALID_INPUT';
end $$;
create function fishing_private.post_publishing_fields(payload jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare lng numeric; lat numeric; place text:=btrim(coalesce(payload->>'location_label','')); topic text:=btrim(coalesce(payload->>'topic','')); additives text:=btrim(coalesce(payload->>'additives',''));
begin
  if jsonb_typeof(payload->'location_label') is distinct from 'string' or length(place) not between 1 and 80
    or coalesce(jsonb_typeof(payload->'location_longitude'),'null') not in ('string','number')
    or coalesce(jsonb_typeof(payload->'location_latitude'),'null') not in ('string','number')
    or length(payload->>'location_longitude')>32 or length(payload->>'location_latitude')>32 then raise exception 'POST_LOCATION_REQUIRED';end if;
  lng:=(payload->>'location_longitude')::numeric;lat:=(payload->>'location_latitude')::numeric;
  if not(lng between -180 and 180 and lat between -90 and 90) then raise exception 'POST_LOCATION_REQUIRED';end if;
  if length(topic)>40 or length(additives)>60 or coalesce(jsonb_typeof(payload->'topic'),'null') not in ('string','null')
    or coalesce(jsonb_typeof(payload->'additives'),'null') not in ('string','null') then raise exception 'INVALID_INPUT';end if;
  return jsonb_build_object('location_label',place,'location_longitude',round(lng/0.02)*0.02,
    'location_latitude',round(lat/0.02)*0.02,'topic',case when payload->>'kind'='experience' then topic else '' end,
    'additives',case when payload->>'kind'='experience' then '' else additives end,
    'occurred_at',case when payload->>'kind'='experience' then null else fishing_private.publishing_time(payload) end);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'INVALID_INPUT';
end $$;
create function fishing_private.trip_publishing_fields(payload jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
begin
  if length(coalesce(payload->>'additives',''))>60 or coalesce(jsonb_typeof(payload->'additives'),'null') not in ('string','null') then raise exception 'INVALID_INPUT';end if;
  return jsonb_build_object('additives',coalesce(payload->>'additives',''),'occurred_at',fishing_private.publishing_time(payload));
end $$;
create function fishing_private.asset_json(m public.media_assets) returns jsonb
language sql immutable security invoker set search_path='' as $$
  select jsonb_build_object('id',m.id,'path',m.path,'width',m.width,'height',m.height,'kind',m.kind,'duration',m.duration,'size',m.size);
$$;
create function fishing_private.validate_media_selection(photos jsonb) returns void
language plpgsql stable security invoker set search_path='' as $$
declare videos integer;
begin
  select count(*) into videos from public.media_assets m where m.kind='video' and m.id in
    (select (x->>'id')::uuid from jsonb_array_elements(coalesce(photos,'[]')) x);
  if videos>0 and (videos<>1 or jsonb_array_length(photos)<>1) then raise exception 'MEDIA_MIXED';end if;
end $$;
create function fishing_private.video_parent_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.kind='video' and (new.report_id is not null or new.message_id is not null) then raise exception 'VIDEO_NOT_ALLOWED';end if;
  return new;
end $$;
create trigger video_parent_guard before insert or update of kind,report_id,message_id on public.media_assets
  for each row execute function fishing_private.video_parent_guard();
revoke all on function fishing_private.publishing_time(jsonb),fishing_private.post_publishing_fields(jsonb),
  fishing_private.trip_publishing_fields(jsonb),fishing_private.asset_json(public.media_assets),
  fishing_private.validate_media_selection(jsonb),fishing_private.video_parent_guard() from public,anon,authenticated,service_role;

-- Guarded edits extend the deployed functions, including count/length and staged review updates.
do $migration$
declare patch record; source text; fn regprocedure; old_text text;
begin
  for patch in select * from (values
    ('fishing_private.validate_composition(text,jsonb)',
      $old$and jsonb_array_length(photos)=0 then raise exception 'COMPOSITION_EMPTY'; end if;$old$,
      $new$and jsonb_array_length(photos)=0 then raise exception 'COMPOSITION_EMPTY'; end if;
  if content_type='post' then perform fishing_private.post_publishing_fields(payload);
  else perform fishing_private.trip_publishing_fields(payload);end if;$new$),
    ('fishing_private.post_catch_fields(jsonb)',
      $old$    amount:=raw::numeric;$old$,
      $new$    if field='count' and raw is not null and raw !~ '^\d+$' then raise exception 'INVALID_INPUT';end if;
    amount:=raw::numeric;$new$),
    ('fishing_private.write_api(text,jsonb)',
      $old$occurred_on,location_label,audience,status)$old$,
      $new$occurred_on,location_label,location_longitude,location_latitude,topic,additives,occurred_at,audience,status)$new$),
    ('fishing_private.write_api(text,jsonb)',
      $old$coalesce(payload->>'location_label',''),scope,$old$,
      $new$(fishing_private.post_publishing_fields(payload)->>'location_label'),
      (fishing_private.post_publishing_fields(payload)->>'location_longitude')::numeric,
      (fishing_private.post_publishing_fields(payload)->>'location_latitude')::numeric,
      fishing_private.post_publishing_fields(payload)->>'topic',fishing_private.post_publishing_fields(payload)->>'additives',
      (fishing_private.post_publishing_fields(payload)->>'occurred_at')::timestamptz,scope,$new$),
    ('fishing_private.write_api(text,jsonb)',
      $old$occurred_on,method,bait,catch_records)$old$,
      $new$occurred_on,occurred_at,additives,method,bait,catch_records)$new$),
    ('fishing_private.write_api(text,jsonb)',
      $old$(payload->>'occurred_on')::date,coalesce(payload->>'method','')$old$,
      $new$(payload->>'occurred_on')::date,(fishing_private.trip_publishing_fields(payload)->>'occurred_at')::timestamptz,
      fishing_private.trip_publishing_fields(payload)->>'additives',coalesce(payload->>'method','')$new$),
    ('fishing_private.author_write(text,jsonb)',
      $old$occurred_on = (payload->>'occurred_on')::date, location_label = coalesce(payload->>'location_label',''),$old$,
      $new$occurred_on = (payload->>'occurred_on')::date,
          location_label = fishing_private.post_publishing_fields(payload)->>'location_label',
          location_longitude=(fishing_private.post_publishing_fields(payload)->>'location_longitude')::numeric,
          location_latitude=(fishing_private.post_publishing_fields(payload)->>'location_latitude')::numeric,
          topic=fishing_private.post_publishing_fields(payload)->>'topic',additives=fishing_private.post_publishing_fields(payload)->>'additives',
          occurred_at=(fishing_private.post_publishing_fields(payload)->>'occurred_at')::timestamptz,$new$),
    ('fishing_private.author_write(text,jsonb)',
      $old$update public.trips set title =$old$,
      $new$update public.trips set occurred_at=(fishing_private.trip_publishing_fields(payload)->>'occurred_at')::timestamptz,
          additives=fishing_private.trip_publishing_fields(payload)->>'additives',title =$new$),
    ('fishing_private.content_update_fields(text,jsonb)',
      $old$fields:=fields||fishing_private.post_catch_fields(payload);$old$,
      $new$fields:=fields||fishing_private.post_catch_fields(payload)||fishing_private.post_publishing_fields(payload);$new$),
    ('fishing_private.install_content_update(text,uuid,jsonb)',
      $old$occurred_on=(fields->>'occurred_on')::date,location_label=fields->>'location_label',$old$,
      $new$occurred_on=(fields->>'occurred_on')::date,location_label=fields->>'location_label',
      occurred_at=case when fields ? 'occurred_at' then (fields->>'occurred_at')::timestamptz else occurred_at end,
      additives=coalesce(fields->>'additives',additives),topic=coalesce(fields->>'topic',topic),
      location_longitude=coalesce((fields->>'location_longitude')::numeric,location_longitude),
      location_latitude=coalesce((fields->>'location_latitude')::numeric,location_latitude),$new$),
    ('fishing_private.set_content_media(text,uuid,jsonb)',
      $old$  update public.media_assets set post_id=null,trip_id=null,sort_order=0$old$,
      $new$  perform fishing_private.validate_media_selection(photos);
  update public.media_assets set post_id=null,trip_id=null,sort_order=0$new$),
    ('fishing_private.content_update_media(uuid,jsonb,boolean)',
      $old$  update public.media_assets set post_id=null,is_staged=false,sort_order=0$old$,
      $new$  perform fishing_private.validate_media_selection(photos);
  update public.media_assets set post_id=null,is_staged=false,sort_order=0$new$),
    ('fishing_private.review_item(text,uuid)',
      $old$'details',jsonb_build_object('尾数',$old$,
      $new$'details',jsonb_build_object('小药',p.additives,'心得主题',p.topic,'出钓时间',p.occurred_at::text,'尾数',$new$),
    ('fishing_private.content_update_review(text,uuid)',
      $old$'details',jsonb_build_object(
        '尾数',$old$,
      $new$'details',jsonb_build_object('小药',fields->>'additives','心得主题',fields->>'topic','出钓时间',fields->>'occurred_at',
        '尾数',$new$)
  ) changes(function_name,old_text,new_text) loop
    source:=pg_get_functiondef(patch.function_name::regprocedure);
    if strpos(source,patch.old_text)=0 or (length(source)-length(replace(source,patch.old_text,'')))/length(patch.old_text)<>1 then
      raise exception 'PUBLISHING_EXTENSION_ANCHOR: %',patch.function_name;end if;
    execute replace(source,patch.old_text,patch.new_text);
  end loop;
  old_text:='jsonb_build_object(''id'',m.id,''path'',m.path,''width'',m.width,''height'',m.height)';
  foreach fn in array array['fishing_private.post_json(uuid)'::regprocedure,'fishing_private.trip_json(uuid)'::regprocedure,
      'fishing_private.review_item(text,uuid)'::regprocedure,'fishing_private.content_update_photos(uuid,jsonb)'::regprocedure] loop
    source:=pg_get_functiondef(fn);
    if position(old_text in source)=0 then raise exception 'PUBLISHING_MEDIA_ANCHOR: %',fn;end if;
    execute replace(source,old_text,'fishing_private.asset_json(m)');
  end loop;
end $migration$;
