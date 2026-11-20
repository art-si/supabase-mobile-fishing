-- Comment attachments reuse sanitized private uploads and existing governance.
alter table public.media_assets add column comment_id uuid references public.comments(id) on delete cascade;
create index media_assets_comment_idx on public.media_assets(comment_id) where comment_id is not null;
alter table public.media_assets drop constraint media_single_parent,
  add constraint media_single_parent check(num_nonnulls(post_id,trip_id,report_id,message_id,spot_id,avatar_profile_id,comment_id)<=1);
alter table public.comments drop constraint comments_body_check,
  add constraint comments_body_check check((deleted_at is null and length(trim(body)) between 0 and 500) or (deleted_at is not null and body=''));

create function fishing_private.comment_media(target uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(fishing_private.asset_json(m) order by m.sort_order,m.created_at,m.id),'[]'::jsonb)
  from public.media_assets m where m.comment_id=target;
$$;
create function fishing_private.comment_excerpt(target uuid) returns text
language sql stable security invoker set search_path='' as $$
  select coalesce(nullif(c.body,''),case
    when exists(select 1 from public.media_assets m where m.comment_id=c.id and m.kind='video') then
      case when exists(select 1 from public.media_assets m where m.comment_id=c.id and m.kind='image') then '[图片/视频]' else '[视频]' end
    else '[图片]' end) from public.comments c where c.id=target;
$$;
create function fishing_private.can_view_comment_media(target uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.comments c join public.posts p on p.id=c.post_id where c.id=target and c.deleted_at is null and (
    (fishing_private.can_view_post(c.post_id) and (c.status='published' or c.author_id=(select auth.uid()))
      and not fishing_private.is_blocked(c.author_id,(select auth.uid())))
    or (fishing_private.is_moderator() and p.audience<>'private' and p.status<>'deleted')));
$$;
create or replace function fishing_private.can_view_media(target uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.media_assets m where m.id=target and (
    (m.comment_id is not null and fishing_private.can_view_comment_media(m.comment_id))
    or (m.comment_id is null and (
      m.owner_id=(select auth.uid())
      or (m.avatar_profile_id is not null and not fishing_private.is_blocked(m.owner_id,(select auth.uid())))
      or (m.spot_id is not null and not m.is_staged and fishing_private.can_view_spot(m.spot_id))
      or (m.post_id is not null and not m.is_staged and fishing_private.can_view_post(m.post_id))
      or (m.message_id is not null and exists(select 1 from public.messages msg where msg.id=m.message_id and fishing_private.is_member(msg.conversation_id)))
      or (fishing_private.is_moderator() and exists(select 1 from public.posts p where p.id=m.post_id and p.audience<>'private' and p.status<>'deleted'))
      or (fishing_private.is_moderator() and exists(select 1 from public.fishing_spots s where s.id=m.spot_id and s.audience<>'private' and s.status<>'deleted'))
    ))));
$$;
create or replace function fishing_private.comment_json(target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',c.id,'post_id',c.post_id,'status',c.status,
    'author',fishing_private.profile_json(c.author_id),'body',c.body,'created_at',c.created_at,
    'media',fishing_private.comment_media(c.id),'reply_to_id',c.reply_to_id,'reply_to',(
      select jsonb_build_object('id',r.id,'author',fishing_private.profile_json(r.author_id),
        'body',left(fishing_private.comment_excerpt(r.id),160)) from public.comments r
      where r.id=c.reply_to_id and r.post_id=c.post_id and r.deleted_at is null and r.status='published'
        and not fishing_private.is_blocked(r.author_id,(select auth.uid()))
    ))
  from public.comments c where c.id=target and c.deleted_at is null
    and (c.status='published' or c.author_id=(select auth.uid()))
    and fishing_private.can_view_post(c.post_id)
    and not fishing_private.is_blocked(c.author_id,(select auth.uid()));
$$;
create or replace function fishing_private.comment_write(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); target uuid:=nullif(payload->>'id','')::uuid;
  post_target uuid:=nullif(payload->>'post_id','')::uuid; reply_target uuid:=nullif(payload->>'reply_to_id','')::uuid;
  content text:=trim(payload->>'body'); existing public.comments; quoted public.comments;
  photos jsonb:=coalesce(payload->'media','[]'::jsonb); ids uuid[]; prior_ids uuid[]; amount integer;
begin
  -- Preserve write_api user lock/rate limits and post -> comment locking order.
  if uid is null or not exists(select 1 from public.profiles where id=uid) then raise exception 'NOT_AUTHENTICATED';end if;
  if target is null or post_target is null then raise exception 'INVALID_INPUT';end if;
  perform 1 from public.posts where id=post_target for share;
  if not found or not fishing_private.can_view_post(post_target) then raise exception 'NOT_FOUND';end if;
  select * into existing from public.comments where id=target for update;
  if action='delete_comment' then
    if existing.id is null or existing.author_id<>uid or existing.post_id<>post_target then raise exception 'NOT_FOUND';end if;
    update public.comments set body='',deleted_at=coalesce(deleted_at,clock_timestamp()) where id=target;
    return to_jsonb(true);
  end if;
  if action<>'comment' or content is null or length(content)>500 or jsonb_typeof(payload->'body') is distinct from 'string'
    or jsonb_typeof(photos) is distinct from 'array' then raise exception 'INVALID_INPUT';end if;
  amount:=jsonb_array_length(photos);
  if amount>6 or (content='' and amount=0) then raise exception 'INVALID_INPUT';end if;
  select coalesce(array_agg((x->>'id')::uuid),'{}'::uuid[]) into ids from jsonb_array_elements(photos) x;
  if array_position(ids,null) is not null or amount<>(select count(distinct id) from unnest(ids) id) then raise exception 'INVALID_INPUT';end if;
  if existing.id is not null then
    if existing.author_id<>uid or existing.post_id<>post_target then raise exception 'FORBIDDEN';end if;
    if existing.deleted_at is not null then raise exception 'NOT_FOUND';end if;
    select coalesce(array_agg(m.id order by m.sort_order,m.created_at,m.id),'{}'::uuid[]) into prior_ids from public.media_assets m where m.comment_id=target;
    if existing.body<>content or existing.reply_to_id is distinct from reply_target or prior_ids<>ids then raise exception 'COMMENT_REQUEST_REUSED';end if;
    return to_jsonb(true);
  end if;
  if reply_target is not null then
    select * into quoted from public.comments where id=reply_target for share;
    if quoted.id is null or quoted.post_id<>post_target or quoted.deleted_at is not null or quoted.status<>'published'
      or fishing_private.is_blocked(quoted.author_id,uid) or reply_target=target then raise exception 'COMMENT_REPLY_UNAVAILABLE';end if;
  end if;
  perform m.id from public.media_assets m where m.id=any(ids) order by m.id for update;
  if amount<>(select count(*) from public.media_assets m where m.id=any(ids) and m.owner_id=uid and not m.is_staged
    and num_nonnulls(m.post_id,m.trip_id,m.report_id,m.message_id,m.spot_id,m.avatar_profile_id,m.comment_id)=0)
    then raise exception 'FORBIDDEN';end if;
  insert into public.comments(id,post_id,author_id,body,reply_to_id) values(target,post_target,uid,content,reply_target);
  update public.media_assets m set comment_id=target,sort_order=(x.n-1)::integer from unnest(ids) with ordinality x(id,n) where m.id=x.id;
  return to_jsonb(true);
end $$;

create function fishing_private.delete_comment_media() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then delete from public.media_assets where comment_id=new.id;end if;
  return new;
end $$;
create trigger comments_cleanup_media after update of deleted_at on public.comments for each row execute function fishing_private.delete_comment_media();
create function fishing_private.delete_post_comment_media() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.status='deleted' and old.status is distinct from new.status then
    delete from public.media_assets m using public.comments c where m.comment_id=c.id and c.post_id=new.id;
  end if;
  return new;
end $$;
create trigger posts_cleanup_comment_media after update of status on public.posts for each row execute function fishing_private.delete_post_comment_media();

-- Preserve every existing parent writer, while keeping comment assets exclusive.
do $migration$
declare fn text; source text; needle text;
begin
  foreach fn in array array['fishing_private.set_content_media(text,uuid,jsonb)','fishing_private.content_update_media(uuid,jsonb,boolean)',
    'fishing_private.set_spot_photos(uuid,jsonb,boolean)','fishing_private.update_water_report(jsonb)'] loop
    source:=pg_get_functiondef(fn::regprocedure);needle:='and m.avatar_profile_id is null';
    if position(needle in source)=0 then raise exception 'COMMENT_MEDIA_OWNER_ANCHOR: %',fn;end if;
    execute replace(source,needle,needle||' and m.comment_id is null');
  end loop;
  source:=pg_get_functiondef('fishing_private.water_report_write(text,jsonb)'::regprocedure);needle:='and avatar_profile_id is null';
  if position(needle in source)=0 then raise exception 'COMMENT_REPORT_PARENT_ANCHOR';end if;
  execute replace(source,needle,needle||' and comment_id is null');
  source:=pg_get_functiondef('fishing_private.chat_send(jsonb)'::regprocedure);needle:='num_nonnulls(post_id,trip_id,report_id,message_id,spot_id,avatar_profile_id)=0';
  if position(needle in source)=0 then raise exception 'COMMENT_CHAT_PARENT_ANCHOR';end if;
  execute replace(source,needle,'num_nonnulls(post_id,trip_id,report_id,message_id,spot_id,avatar_profile_id,comment_id)=0');
  source:=pg_get_functiondef('fishing_private.set_profile_avatar(uuid)'::regprocedure);needle:='num_nonnulls(m.post_id,m.trip_id,m.report_id,m.message_id,m.spot_id)=0';
  if position(needle in source)=0 then raise exception 'COMMENT_AVATAR_PARENT_ANCHOR';end if;
  execute replace(source,needle,'num_nonnulls(m.post_id,m.trip_id,m.report_id,m.message_id,m.spot_id,m.comment_id)=0');
  source:=pg_get_functiondef('fishing_private.review_item(text,uuid)'::regprocedure);
  needle:=$old$'author',fishing_private.profile_json(c.author_id),'media','[]'::jsonb,$old$;
  if position(needle in source)=0 then raise exception 'COMMENT_REVIEW_MEDIA_ANCHOR';end if;
  execute replace(source,needle,$new$'author',fishing_private.profile_json(c.author_id),'media',fishing_private.comment_media(c.id),$new$);
  source:=pg_get_functiondef('fishing_private.notification_json(fishing_private.notifications)'::regprocedure);needle:='select true,c.body into available,excerpt';
  if position(needle in source)=0 then raise exception 'COMMENT_NOTIFICATION_MEDIA_ANCHOR';end if;
  execute replace(source,needle,'select true,fishing_private.comment_excerpt(c.id) into available,excerpt');
end $migration$;
revoke all on function fishing_private.comment_media(uuid),fishing_private.comment_excerpt(uuid),
  fishing_private.can_view_comment_media(uuid),fishing_private.comment_json(uuid),fishing_private.comment_write(text,jsonb),
  fishing_private.delete_comment_media(),fishing_private.delete_post_comment_media() from public,anon,authenticated,service_role;
