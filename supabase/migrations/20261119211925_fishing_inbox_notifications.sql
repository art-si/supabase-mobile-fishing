-- In-app only. References are reauthorized on every read; no copied post/comment,
-- profile, media, location, reporter or moderator data is stored in the inbox.
create table fishing_private.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  likes boolean not null default true,
  comments boolean not null default true
);
create table fishing_private.notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete cascade,
  kind text not null check(kind in ('like','comment','reply','friend_accepted','review','report_result','zone_review')),
  category text generated always as
    (case when kind in ('like','comment','reply','friend_accepted') then 'interaction' else 'system' end) stored,
  event_key text not null check(length(event_key) between 1 and 200),
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  spot_id uuid references public.fishing_spots(id) on delete cascade,
  request_id uuid references public.friend_requests(id) on delete cascade,
  report_id uuid references public.content_reports(id) on delete cascade,
  zone_id uuid references public.fishing_zone_reports(id) on delete cascade,
  review_id bigint references fishing_private.moderation_actions(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  unique(recipient_id,event_key),
  check(actor_id is null or actor_id<>recipient_id),
  check((kind in ('like','comment','reply','friend_accepted'))=(actor_id is not null))
);
create index notifications_page_idx on fishing_private.notifications(recipient_id,category,id desc);
create index notifications_unread_idx on fishing_private.notifications(recipient_id,category,id desc) where read_at is null;
create index notifications_actor_idx on fishing_private.notifications(actor_id) where actor_id is not null;
create index notifications_post_idx on fishing_private.notifications(post_id) where post_id is not null;
create index notifications_comment_idx on fishing_private.notifications(comment_id) where comment_id is not null;
create index notifications_spot_idx on fishing_private.notifications(spot_id) where spot_id is not null;
create index notifications_request_idx on fishing_private.notifications(request_id) where request_id is not null;
create index notifications_report_idx on fishing_private.notifications(report_id) where report_id is not null;
create index notifications_zone_idx on fishing_private.notifications(zone_id) where zone_id is not null;
create index notifications_review_idx on fishing_private.notifications(review_id) where review_id is not null;
alter table fishing_private.notifications enable row level security;
alter table fishing_private.notification_preferences enable row level security;
revoke all on fishing_private.notifications,fishing_private.notification_preferences from public,anon,authenticated,service_role;

-- Internal producer only. Event keys deduplicate business retries and unlike/re-like.
create function fishing_private.enqueue_notification(recipient uuid,notice_kind text,actor uuid,target uuid,audit_id bigint default null)
returns void language plpgsql security invoker set search_path='' as $$
declare p uuid; c uuid; s uuid; f uuid; r uuid; z uuid; k text; inserted bigint;
  review fishing_private.moderation_actions;
begin
  if recipient is null or recipient=actor or not exists(select 1 from public.profiles where id=recipient) then return;end if;
  if actor is not null and fishing_private.is_blocked(recipient,actor) then return;end if;
  if notice_kind='like' and exists(select 1 from fishing_private.notification_preferences where user_id=recipient and not likes) then return;end if;
  if notice_kind in ('comment','reply') and exists(select 1 from fishing_private.notification_preferences where user_id=recipient and not comments) then return;end if;
  case notice_kind
  when 'like' then p:=target;k:='like:'||target::text||':'||actor::text;
  when 'comment','reply' then
    c:=target;select post_id into p from public.comments where id=c;
    k:='comment:'||c::text;
  when 'friend_accepted' then f:=target;k:='friend:'||f::text;
  when 'review' then
    select * into review from fishing_private.moderation_actions where id=audit_id;
    if review.target_type='post' then p:=review.target_id;
    elsif review.target_type='spot' then s:=review.target_id;
    elsif review.target_type='comment' then
      c:=review.target_id;select post_id into p from public.comments where id=c;
    else return;end if;
    k:='review:'||audit_id::text;
  when 'report_result' then r:=target;k:='report:'||r::text;
  when 'zone_review' then
    z:=target;select 'zone:'||id::text||':'||revision::text into k from public.fishing_zone_reports where id=z;
  else raise exception 'INVALID_INPUT';
  end case;
  insert into fishing_private.notifications(recipient_id,actor_id,kind,event_key,
    post_id,comment_id,spot_id,request_id,report_id,zone_id,review_id)
    values(recipient,actor,notice_kind,k,p,c,s,f,r,z,audit_id)
    on conflict(recipient_id,event_key) do nothing returning id into inserted;
  if inserted is not null then perform fishing_private.notify_social_user(recipient);end if;
end $$;

create function fishing_private.capture_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner_id uuid; replied_id uuid;
begin
  if TG_TABLE_SCHEMA='public' and TG_TABLE_NAME='post_likes' then
    if TG_OP='DELETE' then
      select author_id into owner_id from public.posts where id=OLD.post_id;
      perform fishing_private.notify_social_user(owner_id);return null;
    end if;
    select author_id into owner_id from public.posts where id=NEW.post_id;
    perform fishing_private.enqueue_notification(owner_id,'like',NEW.user_id,NEW.post_id);
  elsif TG_TABLE_SCHEMA='public' and TG_TABLE_NAME='comments' then
    if NEW.deleted_at is not null or NEW.status<>'published' then return null;end if;
    select author_id into owner_id from public.posts where id=NEW.post_id;
    select author_id into replied_id from public.comments
      where id=NEW.reply_to_id and post_id=NEW.post_id and deleted_at is null and status='published';
    -- Reply first; when the post author is also the quoted author, send only one.
    if replied_id is not null then
      perform fishing_private.enqueue_notification(replied_id,'reply',NEW.author_id,NEW.id);
    end if;
    perform fishing_private.enqueue_notification(owner_id,'comment',NEW.author_id,NEW.id);
  elsif TG_TABLE_SCHEMA='public' and TG_TABLE_NAME='friend_requests' then
    if NEW.status='accepted' and OLD.status is distinct from NEW.status then
      perform fishing_private.enqueue_notification(NEW.sender_id,'friend_accepted',NEW.recipient_id,NEW.id);
    end if;
  elsif TG_TABLE_SCHEMA='fishing_private' and TG_TABLE_NAME='moderation_actions' then
    if NEW.target_type='post' then select author_id into owner_id from public.posts where id=NEW.target_id;
    elsif NEW.target_type='spot' then select author_id into owner_id from public.fishing_spots where id=NEW.target_id;
    elsif NEW.target_type='comment' then select author_id into owner_id from public.comments where id=NEW.target_id;
    end if;
    perform fishing_private.enqueue_notification(owner_id,'review',null,NEW.target_id,NEW.id);
  elsif TG_TABLE_SCHEMA='public' and TG_TABLE_NAME='content_reports' then
    if OLD.status='pending' and NEW.status in ('actioned','dismissed','unavailable') then
      perform fishing_private.enqueue_notification(NEW.reporter_id,'report_result',null,NEW.id);
    end if;
  elsif TG_TABLE_SCHEMA='public' and TG_TABLE_NAME='fishing_zone_reports' then
    if NEW.status is distinct from OLD.status and NEW.status in ('published','rejected','hidden') then
      perform fishing_private.enqueue_notification(NEW.author_id,'zone_review',null,NEW.id);
    end if;
  else raise exception 'INVALID_TRIGGER';end if;
  return null;
end $$;
create trigger fishing_like_inbox after insert or delete on public.post_likes
  for each row execute function fishing_private.capture_notification();
create trigger fishing_comment_inbox after insert on public.comments
  for each row execute function fishing_private.capture_notification();
create trigger fishing_friend_inbox after update of status on public.friend_requests
  for each row execute function fishing_private.capture_notification();
create trigger fishing_review_inbox after insert on fishing_private.moderation_actions
  for each row execute function fishing_private.capture_notification();
create trigger fishing_report_inbox after update of status on public.content_reports
  for each row execute function fishing_private.capture_notification();
create trigger fishing_zone_inbox after update of status on public.fishing_zone_reports
  for each row execute function fishing_private.capture_notification();

create function fishing_private.notification_json(n fishing_private.notifications)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); available boolean:=false; label text; excerpt text; actor_name text;
  target jsonb; decision text; object_kind text;
begin
  if uid is null or uid is distinct from n.recipient_id then return null;end if;
  if n.actor_id is null or not fishing_private.is_blocked(uid,n.actor_id) then
    if n.actor_id is not null then select nickname into actor_name from public.profiles where id=n.actor_id;end if;
    case n.kind
    when 'like' then
      select true,p.title into available,excerpt from public.posts p where p.id=n.post_id
        and p.author_id=uid and p.status='published' and p.audience<>'private'
        and exists(select 1 from public.post_likes l where l.post_id=p.id and l.user_id=n.actor_id);
      label:=coalesce(actor_name,'钓友')||'赞了你的动态';
      target:=jsonb_build_object('type','post','id',n.post_id);
    when 'comment','reply' then
      select true,c.body into available,excerpt from public.comments c join public.posts p on p.id=c.post_id
        where c.id=n.comment_id and c.post_id=n.post_id and c.author_id=n.actor_id
        and c.deleted_at is null and c.status='published' and p.status='published' and p.audience<>'private'
        and fishing_private.can_view_post(p.id)
        and ((n.kind='comment' and p.author_id=uid) or (n.kind='reply' and exists(
          select 1 from public.comments r where r.id=c.reply_to_id and r.post_id=p.id
            and r.author_id=uid and r.deleted_at is null and r.status='published')));
      label:=coalesce(actor_name,'钓友')||case when n.kind='reply' then '回复了你的评论' else '评论了你的动态' end;
      target:=jsonb_build_object('type','post','id',n.post_id);
    when 'friend_accepted' then
      select true into available from public.friend_requests r where r.id=n.request_id
        and r.sender_id=uid and r.recipient_id=n.actor_id and r.status='accepted'
        and fishing_private.are_friends(uid,n.actor_id);
      label:=coalesce(actor_name,'钓友')||'通过了好友申请';excerpt:='现在可以交流鱼情了';
      target:=jsonb_build_object('type','person','id',n.actor_id);
    when 'review' then
      select a.target_type,a.decision into object_kind,decision from fishing_private.moderation_actions a where a.id=n.review_id;
      if object_kind='post' then
        select true,p.title into available,excerpt from public.posts p
          where p.id=n.post_id and p.author_id=uid and p.status<>'deleted';
      elsif object_kind='spot' then
        select true,s.name into available,excerpt from public.fishing_spots s
          where s.id=n.spot_id and s.author_id=uid and s.status<>'deleted';
      elsif object_kind='comment' then
        select true,c.body into available,excerpt from public.comments c where c.id=n.comment_id
          and c.author_id=uid and c.deleted_at is null and fishing_private.can_view_post(c.post_id);
      end if;
      label:=case object_kind when 'post' then '动态' when 'spot' then '钓位' else '评论' end||
        case decision when 'published' then '已通过复核' when 'rejected' then '未通过审核' else '已被隐藏' end;
      target:=jsonb_build_object('type',case when object_kind='spot' then 'spot' else 'post' end,
        'id',coalesce(n.post_id,n.spot_id));
    when 'report_result' then
      select true into available from public.content_reports r where r.id=n.report_id and r.reporter_id=uid and r.status<>'pending';
      label:='举报已有处理结果';excerpt:='在“我的举报”查看最新处理说明';
      target:=jsonb_build_object('type','reports','id',n.report_id);
    when 'zone_review' then
      select true,z.title,z.status into available,excerpt,decision from public.fishing_zone_reports z
        where z.id=n.zone_id and z.author_id=uid and z.status in ('published','rejected','hidden');
      label:='禁钓提醒审核有更新';target:=jsonb_build_object('type','zones','id',n.zone_id);
    end case;
  end if;
  available:=coalesce(available,false);
  return jsonb_build_object('id',n.id::text,'kind',n.kind,'category',n.category,
    'created_at',n.created_at,'read',n.read_at is not null or not available,'available',available,
    'title',case when available then label else '内容已不可见' end,
    'preview',case when available then left(coalesce(excerpt,''),160) else '内容或关系已变化，不再展示原信息。' end,
    'target',case when available then target else null end);
end $$;

create function fishing_private.notification_summary() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); interactions integer; systems integer;
begin
  if uid is null or not exists(select 1 from public.profiles where id=uid) then raise exception 'NOT_AUTHENTICATED';end if;
  select count(*) into interactions from (
    select 1 from fishing_private.notifications n where n.recipient_id=uid and n.category='interaction'
      and n.read_at is null and (fishing_private.notification_json(n)->>'available')::boolean limit 100) q;
  select count(*) into systems from (
    select 1 from fishing_private.notifications n where n.recipient_id=uid and n.category='system'
      and n.read_at is null and (fishing_private.notification_json(n)->>'available')::boolean limit 100) q;
  return jsonb_build_object('interaction',interactions,'system',systems);
end $$;

create function fishing_private.notifications_api(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); section text:=coalesce(payload->>'category','interaction');
  cursor_id bigint; target_id bigint; items jsonb; next_cursor text; row_json jsonb;
  ids bigint[]; notice fishing_private.notifications; pref fishing_private.notification_preferences;
  key text; value boolean; changed integer;
begin
  if uid is null or not exists(select 1 from public.profiles where id=uid) then raise exception 'NOT_AUTHENTICATED';end if;
  if payload is null or jsonb_typeof(payload)<>'object' then raise exception 'INVALID_INPUT';end if;
  if action='summary' then return fishing_private.notification_summary();end if;
  if action in ('preferences','set_preference') then
    if action='set_preference' then
      key:=payload->>'key';
      if key is null or key not in ('likes','comments') or jsonb_typeof(payload->'enabled') is distinct from 'boolean' then raise exception 'INVALID_INPUT';end if;
      value:=(payload->>'enabled')::boolean;
      insert into fishing_private.notification_preferences(user_id,likes,comments)
        values(uid,case when key='likes' then value else true end,case when key='comments' then value else true end)
        on conflict(user_id) do update set
          likes=case when key='likes' then value else notification_preferences.likes end,
          comments=case when key='comments' then value else notification_preferences.comments end;
      perform fishing_private.notify_social_user(uid);
    end if;
    select * into pref from fishing_private.notification_preferences where user_id=uid;
    return jsonb_build_object('likes',coalesce(pref.likes,true),'comments',coalesce(pref.comments,true));
  end if;
  if action='page' then
    if section not in ('interaction','system') then raise exception 'INVALID_INPUT';end if;
    if coalesce(payload->>'cursor','')<>'' then
      if payload->>'cursor' !~ '^[1-9][0-9]{0,17}$' then raise exception 'INVALID_INPUT';end if;
      cursor_id:=(payload->>'cursor')::bigint;
    end if;
    with page as (
      select * from fishing_private.notifications n where n.recipient_id=uid and n.category=section
        and (cursor_id is null or n.id<cursor_id) order by n.id desc limit 21
    ), numbered as (select p.*,row_number() over(order by id desc) pos from page p)
    -- Rows and cursor share one statement snapshot, including under concurrent inserts/deletes.
    select coalesce(jsonb_agg(fishing_private.notification_json(n) order by n.id desc) filter(where p.pos<=20),'[]'::jsonb),
      case when count(*)>20 then (min(n.id) filter(where p.pos<=20))::text end
      into items,next_cursor from numbered p join fishing_private.notifications n on n.id=p.id;
    return jsonb_build_object('items',items,'next',next_cursor,'summary',fishing_private.notification_summary());
  elsif action='open' then
    if coalesce(payload->>'id','') !~ '^[1-9][0-9]{0,17}$' then raise exception 'INVALID_INPUT';end if;
    target_id:=(payload->>'id')::bigint;
    select * into notice from fishing_private.notifications where id=target_id and recipient_id=uid;
    if notice.id is null then raise exception 'NOT_FOUND';end if;
    row_json:=fishing_private.notification_json(notice);
    update fishing_private.notifications set read_at=clock_timestamp() where id=notice.id and recipient_id=uid and read_at is null;
    get diagnostics changed=row_count;
    if changed>0 then perform fishing_private.notify_social_user(uid);end if;
    return jsonb_set(row_json,'{read}','true'::jsonb);
  elsif action in ('refresh','mark_read') then
    if section not in ('interaction','system') then raise exception 'INVALID_INPUT';end if;
    if jsonb_typeof(payload->'ids') is distinct from 'array' or jsonb_array_length(payload->'ids')>200 then raise exception 'INVALID_INPUT';end if;
    if exists(select 1 from jsonb_array_elements(payload->'ids') v
      where jsonb_typeof(v) is distinct from 'string' or (v#>>'{}') !~ '^[1-9][0-9]{0,17}$') then raise exception 'INVALID_INPUT';end if;
    select coalesce(array_agg(v::bigint),'{}'::bigint[]) into ids from jsonb_array_elements_text(payload->'ids') v;
    if action='mark_read' then
      -- Explicit loaded IDs only: a concurrent, unseen event is never marked read.
      update fishing_private.notifications set read_at=clock_timestamp() where recipient_id=uid and id=any(ids) and read_at is null;
      get diagnostics changed=row_count;
      if changed>0 then perform fishing_private.notify_social_user(uid);end if;
    end if;
    select coalesce(jsonb_agg(fishing_private.notification_json(n) order by n.id desc),'[]'::jsonb) into items
      from fishing_private.notifications n where n.recipient_id=uid and n.id=any(ids);
    return jsonb_build_object('items',items,'summary',fishing_private.notification_summary(),
      'latest', (select max(id)::text from fishing_private.notifications where recipient_id=uid and category=section));
  end if;
  raise exception 'INVALID_INPUT';
end $$;
create function public.fishing_notifications(action text,payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$select fishing_private.notifications_api(action,payload);$$;
revoke all on function fishing_private.enqueue_notification(uuid,text,uuid,uuid,bigint),
  fishing_private.capture_notification(),fishing_private.notification_json(fishing_private.notifications),
  fishing_private.notification_summary(),fishing_private.notifications_api(text,jsonb),
  public.fishing_notifications(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function fishing_private.notifications_api(text,jsonb),public.fishing_notifications(text,jsonb) to authenticated;

-- Existing social refresh/realtime continues to own message-screen updates. Unread
-- station notices are separate from chat receipts, and optional to older clients.
do $$
declare source text; needle text;
begin
  source:=pg_get_functiondef('fishing_private.read_api(text,jsonb)'::regprocedure);
  needle:='  when ''social'' then'||chr(10)||'    return jsonb_build_object(';
  if position(needle in source)=0 then raise exception 'social projection changed';end if;
  execute replace(source,needle,needle||chr(10)||'      ''notifications'',fishing_private.notification_summary(),');
end $$;
