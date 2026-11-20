-- Posts need text OR owned photos, never a mandatory invented title. Private logs need a title/date.
-- Raw writes remain unavailable; validation runs inside the existing authenticated RPC transaction.
alter table public.posts drop constraint posts_title_check, drop constraint posts_body_check;
alter table public.posts add constraint posts_title_check check(length(title) <= 60),
  add constraint posts_body_check check(length(body) <= 2000);
alter table public.trips drop constraint trips_body_check;
alter table public.trips add constraint trips_body_check check(length(body) <= 2000);

alter table public.media_assets add column sort_order integer not null default 0
  check(sort_order between 0 and 8);
-- Preserve the former chronological order of existing post/log photos.
with ordered as (
  select id, (row_number() over(partition by post_id,trip_id order by created_at,id)-1)::integer n
  from public.media_assets where post_id is not null or trip_id is not null
)
update public.media_assets m set sort_order=o.n from ordered o where o.id=m.id;

create function fishing_private.validate_composition(content_type text,payload jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare photos jsonb:=coalesce(payload->'media','[]'); field text; value text;
begin
  if content_type is null or content_type not in ('post','trip') then raise exception 'INVALID_INPUT'; end if;
  foreach field in array array['title','body'] loop
    if payload->field is not null and payload->field <> 'null'::jsonb
      and jsonb_typeof(payload->field) <> 'string' then raise exception 'INVALID_INPUT'; end if;
    value:=coalesce(payload->>field,'');
    if length(value)>(case when field='title' then 60 else 2000 end) then raise exception 'INVALID_INPUT'; end if;
  end loop;
  if jsonb_typeof(photos)<>'array' then raise exception 'INVALID_INPUT'; end if;
  if jsonb_array_length(photos)>9 then raise exception 'INVALID_INPUT'; end if;
  if content_type='trip' and coalesce(payload->>'title','') !~ '[^[:space:]　 ]' then
    raise exception 'COMPOSITION_TITLE_REQUIRED';
  end if;
  if content_type='post' and coalesce(payload->>'body','') !~ '[^[:space:]　 ]'
    and jsonb_array_length(photos)=0 then raise exception 'COMPOSITION_EMPTY'; end if;
end $$;

-- Called only after the parent write/ownership/revision check, within the same transaction.
-- It never accepts paths or signed URLs and never borrows chat/report/another record's media.
create function fishing_private.set_content_media(content_type text,target uuid,photos jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); ids uuid[]; amount integer;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if content_type='post' then
    if not exists(select 1 from public.posts where id=target and author_id=uid and status<>'deleted') then raise exception 'NOT_FOUND'; end if;
  elsif content_type='trip' then
    if not exists(select 1 from public.trips where id=target and owner_id=uid) then raise exception 'NOT_FOUND'; end if;
  else raise exception 'INVALID_INPUT'; end if;
  photos:=coalesce(photos,'[]');
  if jsonb_typeof(photos)<>'array' then raise exception 'INVALID_INPUT'; end if;
  amount:=jsonb_array_length(photos);
  if amount>9 then raise exception 'INVALID_INPUT'; end if;
  select coalesce(array_agg((m->>'id')::uuid),array[]::uuid[]) into ids from jsonb_array_elements(photos) m;
  if amount<>(select count(distinct id) from unnest(ids) id) then raise exception 'INVALID_INPUT'; end if;
  perform m.id from public.media_assets m where m.id=any(ids) order by m.id for update;
  if amount<>(select count(*) from public.media_assets m where m.id=any(ids) and m.owner_id=uid
    and m.report_id is null and m.message_id is null
    and ((m.post_id is null and m.trip_id is null)
      or (content_type='post' and m.post_id=target)
      or (content_type='trip' and m.trip_id=target))) then raise exception 'FORBIDDEN'; end if;
  update public.media_assets set post_id=null,trip_id=null,sort_order=0
    where owner_id=uid and ((content_type='post' and post_id=target) or (content_type='trip' and trip_id=target))
      and not(id=any(ids));
  update public.media_assets m set post_id=case when content_type='post' then target end,
    trip_id=case when content_type='trip' then target end,sort_order=(x.ordinality-1)::integer
    from unnest(ids) with ordinality x(id,ordinality) where m.id=x.id and m.owner_id=uid;
end $$;

-- A caption is a read-only fallback for cards/audit/notifications, NOT a generated author title.
create function fishing_private.post_caption(p public.posts) returns text
language sql immutable security invoker set search_path='' as $$
  select coalesce(nullif(btrim(regexp_replace(p.title,'[[:space:]　 ]+',' ','g')),''),nullif(left(btrim(regexp_replace(p.body,'[[:space:]　 ]+',' ','g')),60),''),
    case when p.kind='catch' then '渔获照片' else '心得照片' end);
$$;
revoke all on function fishing_private.validate_composition(text,jsonb),
  fishing_private.set_content_media(text,uuid,jsonb),fishing_private.post_caption(public.posts)
  from public,anon,authenticated;

-- Guarded edits keep current rate limits, Auth, moderation, receipts and all other dispatches intact.
do $$
declare source text; old_block text; new_block text; fn regprocedure; content_type text;
begin
  source:=pg_get_functiondef('fishing_private.write_api(text,jsonb)'::regprocedure);
  foreach content_type in array array['post','trip'] loop
    old_block:=substring(source from '  when ''save_'||content_type||''' then[\s\S]*?(?=  when '')');
    if old_block is null then raise exception 'create dispatch changed'; end if;
    new_block:=replace(old_block,'    insert into public.'||case when content_type='post' then 'posts' else 'trips' end,
      '    perform fishing_private.validate_composition('||quote_literal(content_type)||E',payload);\n    insert into public.'||case when content_type='post' then 'posts' else 'trips' end);
    if new_block=old_block then raise exception 'create insert changed'; end if;
    new_block:=replace(replace(new_block,'trim(payload->>''title'')','trim(coalesce(payload->>''title'',''''))'),
      'trim(payload->>''body'')','trim(coalesce(payload->>''body'',''''))');
    new_block:=regexp_replace(new_block,'    if jsonb_array_length\(coalesce\(payload->''media'',''\[\]''\)\)>9 then[\s\S]*?    end loop;',
      '    perform fishing_private.set_content_media('||quote_literal(content_type)||',target,payload->''media'');');
    if position('set_content_media' in new_block)=0 or position('end loop;' in new_block)>0 then raise exception 'create photos changed'; end if;
    source:=replace(source,old_block,new_block);
  end loop;
  execute source;

  source:=pg_get_functiondef('fishing_private.author_write(text,jsonb)'::regprocedure);
  old_block:='        update public.posts set title = trim(payload->>''title''), body = trim(payload->>''body''),';
  if position(old_block in source)=0 then raise exception 'post edit changed'; end if;
  source:=replace(source,old_block,E'        perform fishing_private.validate_composition(''post'',payload);\n'||old_block);
  old_block:='        update public.trips set title = trim(payload->>''title''), body = trim(payload->>''body''),';
  if position(old_block in source)=0 then raise exception 'trip edit changed'; end if;
  source:=replace(source,old_block,E'        perform fishing_private.validate_composition(''trip'',payload);\n'||old_block);
  source:=replace(replace(source,'trim(payload->>''title'')','trim(coalesce(payload->>''title'',''''))'),
    'trim(payload->>''body'')','trim(coalesce(payload->>''body'',''''))');
  old_block:=substring(source from '  elsif content_type in \(''post'',''trip''\) and command = ''update_content'' then[\s\S]*?(?=  end if;\s*version :=)');
  if old_block is null then raise exception 'edit media changed'; end if;
  source:=replace(source,old_block,E'  elsif content_type in (''post'',''trip'') and command = ''update_content'' then\n    perform fishing_private.set_content_media(content_type,target,payload->''media'');\n');
  execute source;

  foreach fn in array array['fishing_private.post_json(uuid)'::regprocedure,
    'fishing_private.trip_json(uuid)'::regprocedure,'fishing_private.review_item(text,uuid)'::regprocedure] loop
    source:=pg_get_functiondef(fn);
    if position('order by m.created_at,m.id' in source)=0 then raise exception 'media projection changed: %',fn; end if;
    execute replace(source,'order by m.created_at,m.id','order by m.sort_order,m.created_at,m.id');
  end loop;
  foreach fn in array array['fishing_private.review_item(text,uuid)'::regprocedure,
    'fishing_private.moderation_api(text,jsonb)'::regprocedure,
    'fishing_private.chat_card(text,uuid,uuid)'::regprocedure,
    'fishing_private.notification_json(fishing_private.notifications)'::regprocedure] loop
    source:=pg_get_functiondef(fn);
    if position('p.title' in source)=0 then raise exception 'caption projection changed: %',fn; end if;
    -- moderation UNION needs an explicit name; JSON and INTO expressions do not.
    source:=replace(source,'p.title,p.author_id','fishing_private.post_caption(p) as title,p.author_id');
    execute replace(source,'p.title','fishing_private.post_caption(p)');
  end loop;
end $$;
