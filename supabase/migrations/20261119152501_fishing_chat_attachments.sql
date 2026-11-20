-- Message references never store a content snapshot or coordinates. Reproject on every read.
alter table public.messages add column kind text not null default 'text'
  check (kind in ('text','image','post','spot'));
alter table public.messages add column post_id uuid references public.posts(id) on delete set null;
alter table public.messages add column spot_id uuid references public.fishing_spots(id) on delete set null;
alter table public.messages add constraint message_reference_kind check (
  (kind='post' and spot_id is null) or (kind='spot' and post_id is null)
  or (kind in ('text','image') and post_id is null and spot_id is null));
create index messages_post_idx on public.messages(post_id) where post_id is not null;
create index messages_spot_idx on public.messages(spot_id) where spot_id is not null;
alter table public.media_assets add column message_id uuid references public.messages(id) on delete cascade;
create unique index media_message_idx on public.media_assets(message_id) where message_id is not null;
alter table public.media_assets drop constraint media_single_parent;
alter table public.media_assets add constraint media_single_parent
  check (num_nonnulls(post_id,trip_id,report_id,message_id)<=1);

create function fishing_private.chat_card(kind text, target uuid, viewer uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  -- This is an internal projection, not callable by clients with an arbitrary viewer.
  select case when auth.uid() is null or viewer is null then null
    when kind='post' then (select jsonb_build_object('id',p.id,'type','post','title',p.title,
      'detail',concat_ws(' · ',nullif(p.species,''),nullif(p.method,'')))
      from public.posts p where p.id=target and p.status='published' and p.audience<>'private'
      and not fishing_private.is_blocked(p.author_id,viewer)
      and (p.audience='public' or p.author_id=viewer or fishing_private.are_friends(p.author_id,viewer)))
    when kind='spot' then (select jsonb_build_object('id',s.id,'type','spot','title',s.name,
      'detail',concat_ws(' · ',nullif(s.water_type,''),case s.precision when 'area' then '大致水域' when 'hidden' then '位置未分享' else '精确位置' end))
      from public.fishing_spots s where s.id=target and s.status='published' and s.audience<>'private'
      and not fishing_private.is_blocked(s.author_id,viewer)
      and (s.audience='public' or s.author_id=viewer or fishing_private.are_friends(s.author_id,viewer)))
    else null end;
$$;

create function fishing_private.message_json(m public.messages) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when not fishing_private.is_member(m.conversation_id) then null else
    jsonb_build_object('id',m.id,'conversation_id',m.conversation_id,'sender_id',m.sender_id,
      'client_id',m.client_id,'sequence',m.sequence,'kind',m.kind,'body',m.body,'created_at',m.created_at)
    || case when m.kind='image' then jsonb_build_object('media',coalesce((select jsonb_agg(
      jsonb_build_object('id',a.id,'path',a.path,'width',a.width,'height',a.height))
      from public.media_assets a where a.message_id=m.id),'[]'::jsonb))
    when m.kind in ('post','spot') then jsonb_build_object('card',
      fishing_private.chat_card(m.kind,coalesce(m.post_id,m.spot_id),auth.uid()))
    else '{}'::jsonb end end;
$$;

create function fishing_private.chat_send(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); c public.conversations; m public.messages; seq bigint;
  message_kind text:=coalesce(payload->>'kind','text'); reference_id uuid:=nullif(payload->>'reference_id','')::uuid;
  asset_id uuid:=nullif(payload->>'media_id','')::uuid; client_uuid uuid:=nullif(payload->>'client_id','')::uuid;
  content text:=trim(coalesce(payload->>'body',''));
begin
  if uid is null or not exists(select 1 from public.profiles where id=uid) then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into c from public.conversations where id=(payload->>'conversation_id')::uuid;
  if not found or not fishing_private.is_member(c.id) then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended(c.user_a::text||'/'||c.user_b::text,0));
  if client_uuid is null then raise exception 'INVALID_INPUT'; end if;
  select * into m from public.messages where sender_id=uid and client_id=client_uuid;
  if found then
    if m.conversation_id<>c.id then raise exception 'INVALID_INPUT'; end if;
    -- A lost receipt remains recoverable after unfriend/block; never creates a new message.
    return fishing_private.message_json(m);
  end if;
  if not fishing_private.are_friends(c.user_a,c.user_b) then raise exception 'NOT_FRIENDS'; end if;
  if message_kind not in ('text','image','post','spot') then raise exception 'INVALID_INPUT'; end if;
  if message_kind='text' then
    if length(content) not between 1 and 2000 or reference_id is not null or asset_id is not null then raise exception 'INVALID_INPUT'; end if;
  elsif message_kind='image' then
    if asset_id is null or reference_id is not null then raise exception 'INVALID_INPUT'; end if;
    perform 1 from public.media_assets where id=asset_id and owner_id=uid
      and num_nonnulls(post_id,trip_id,report_id,message_id)=0 for update;
    if not found then raise exception 'PHOTO_NOT_AVAILABLE'; end if;
    content:='[图片]';
  else
    if reference_id is null or asset_id is not null then raise exception 'INVALID_INPUT'; end if;
    if fishing_private.chat_card(message_kind,reference_id,c.user_a) is null
      or fishing_private.chat_card(message_kind,reference_id,c.user_b) is null then raise exception 'CHAT_CONTENT_UNAVAILABLE'; end if;
    content:=case message_kind when 'post' then '[鱼情]' else '[钓位]' end;
  end if;
  update public.conversations set next_sequence=next_sequence+1 where id=c.id returning next_sequence into seq;
  insert into public.messages(conversation_id,sender_id,client_id,sequence,body,kind,post_id,spot_id)
    values(c.id,uid,client_uuid,seq,content,message_kind,
      case when message_kind='post' then reference_id end,case when message_kind='spot' then reference_id end) returning * into m;
  if message_kind='image' then update public.media_assets set message_id=m.id where id=asset_id; end if;
  return fishing_private.message_json(m);
end $$;

create function fishing_private.chat_content(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare target uuid:=nullif(payload->>'id','')::uuid; ids uuid[]; result jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not fishing_private.is_member(target) then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(payload->'ids') is distinct from 'array' or jsonb_array_length(payload->'ids')>100 then raise exception 'INVALID_INPUT'; end if;
  select array_agg(x::uuid) into ids from jsonb_array_elements_text(payload->'ids') x;
  select coalesce(jsonb_agg(fishing_private.message_json(m) order by m.sequence),'[]'::jsonb) into result
    from public.messages m where m.conversation_id=target and m.id=any(ids);
  return result;
end $$;

create or replace function fishing_private.can_view_media(target uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.media_assets m where m.id=target and
    (m.owner_id=(select auth.uid()) or (m.post_id is not null and fishing_private.can_view_post(m.post_id))
      or (m.message_id is not null and exists(select 1 from public.messages msg where msg.id=m.message_id and fishing_private.is_member(msg.conversation_id)))
      or (fishing_private.is_moderator() and exists(select 1 from public.posts p where p.id=m.post_id and p.audience<>'private' and p.status<>'deleted'))));
$$;
revoke all on function fishing_private.chat_card(text,uuid,uuid),fishing_private.message_json(public.messages),
  fishing_private.chat_send(jsonb),fishing_private.chat_content(jsonb) from public,anon,authenticated;

-- Patch only the known dispatch branches; preserve all other feature/auth migrations.
do $$
declare source text; old_branch text;
begin
  source:=pg_get_functiondef('fishing_private.write_api(text,jsonb)'::regprocedure);
  old_branch:=substring(source from '  when ''send_message'' then[\s\S]*?(?=  when ''read_conversation'' then)');
  if old_branch is null then raise exception 'send_message dispatch changed'; end if;
  source:=replace(source,old_branch,E'  when ''send_message'' then return fishing_private.chat_send(payload);\n');
  if position('and post_id is null and trip_id is null and report_id is null' in source)=0 then raise exception 'upload ownership changed'; end if;
  execute replace(source,'and post_id is null and trip_id is null and report_id is null','and post_id is null and trip_id is null and report_id is null and message_id is null');
  source:=pg_get_functiondef('fishing_private.read_api(text,jsonb)'::regprocedure);
  if position('jsonb_agg(to_jsonb(m) order by sequence)' in source)=0 then raise exception 'message read changed'; end if;
  source:=replace(source,'jsonb_agg(to_jsonb(m) order by sequence)','jsonb_agg(fishing_private.message_json(m) order by sequence)');
  execute replace(source,'  case action',E'  case action\n  when ''message_content'' then return fishing_private.chat_content(payload);');
  source:=pg_get_functiondef('fishing_private.author_write(text,jsonb)'::regprocedure);
  if position('m.post_id is null and m.trip_id is null and m.report_id is null' in source)=0 then raise exception 'author media ownership changed'; end if;
  execute replace(source,'m.post_id is null and m.trip_id is null and m.report_id is null','m.post_id is null and m.trip_id is null and m.report_id is null and m.message_id is null');
  source:=pg_get_functiondef('fishing_private.water_report_write(text,jsonb)'::regprocedure);
  if position('and post_id is null and trip_id is null and report_id is null' in source)=0 then raise exception 'report media ownership changed'; end if;
  execute replace(source,'and post_id is null and trip_id is null and report_id is null','and post_id is null and trip_id is null and report_id is null and message_id is null');
end $$;
