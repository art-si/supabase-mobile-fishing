-- Existing messages and private bucket policies continue to use the same conversation membership.
alter table public.messages drop constraint messages_kind_check, drop constraint message_reference_kind;
alter table public.messages add constraint messages_kind_check
  check (kind in ('text','image','video','sticker','post','spot')),
  add constraint message_reference_kind check (
    (kind='post' and spot_id is null) or (kind='spot' and post_id is null)
    or (kind in ('text','image','video','sticker') and post_id is null and spot_id is null));

-- The existing video trigger only blocked attachments to chat. Match the asset to the message type.
create or replace function fishing_private.video_parent_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.message_id is not null and not exists (
    select 1 from public.messages m where m.id=new.message_id and m.kind=new.kind
  ) then raise exception 'INVALID_INPUT'; end if;
  return new;
end $$;

create or replace function fishing_private.message_json(m public.messages) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when not fishing_private.is_member(m.conversation_id) then null else
    jsonb_build_object('id',m.id,'conversation_id',m.conversation_id,'sender_id',m.sender_id,
      'client_id',m.client_id,'sequence',m.sequence,'kind',m.kind,'body',m.body,'created_at',m.created_at)
    || case when m.kind in ('image','video') then jsonb_build_object('media',coalesce((
      select jsonb_agg(fishing_private.asset_json(a)) from public.media_assets a where a.message_id=m.id
    ),'[]'::jsonb))
    when m.kind in ('post','spot') then jsonb_build_object('card',
      fishing_private.chat_card(m.kind,coalesce(m.post_id,m.spot_id),auth.uid()))
    else '{}'::jsonb end end;
$$;

create or replace function fishing_private.chat_send(payload jsonb) returns jsonb
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
    return fishing_private.message_json(m);
  end if;
  if not fishing_private.are_friends(c.user_a,c.user_b) then raise exception 'NOT_FRIENDS'; end if;
  if message_kind not in ('text','image','video','sticker','post','spot') then raise exception 'INVALID_INPUT'; end if;
  if message_kind in ('text','sticker') then
    if length(content) not between 1 and 2000 or reference_id is not null or asset_id is not null then raise exception 'INVALID_INPUT'; end if;
    if message_kind='sticker' and content not in ('上鱼了','开钓','稳住','收到','厉害','下次约') then raise exception 'INVALID_INPUT'; end if;
  elsif message_kind in ('image','video') then
    if asset_id is null or reference_id is not null then raise exception 'INVALID_INPUT'; end if;
    perform 1 from public.media_assets where id=asset_id and owner_id=uid and kind=message_kind
      and num_nonnulls(post_id,trip_id,report_id,message_id,spot_id,avatar_profile_id,comment_id)=0 for update;
    if not found then
      if message_kind='video' then raise exception 'VIDEO_NOT_AVAILABLE'; end if;
      raise exception 'PHOTO_NOT_AVAILABLE';
    end if;
    content:=case message_kind when 'video' then '[视频]' else '[图片]' end;
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
  if message_kind in ('image','video') then update public.media_assets set message_id=m.id where id=asset_id; end if;
  return fishing_private.message_json(m);
end $$;
