-- Replies are references, not copies of someone else's text. Every projection reauthorizes
-- the post, comment and quoted comment. Deleted bodies are erased, not archived in receipts.
alter table public.comments add column reply_to_id uuid;
alter table public.comments add column deleted_at timestamptz;
alter table public.comments drop constraint comments_body_check;
alter table public.comments add constraint comments_body_check check (
  (deleted_at is null and length(trim(body)) between 1 and 500)
  or (deleted_at is not null and body = '')
);
alter table public.comments add constraint comments_post_id_id_key unique(post_id,id);
alter table public.comments add constraint comments_reply_same_post_fk
  foreign key(post_id,reply_to_id) references public.comments(post_id,id)
  on delete set null (reply_to_id);
alter table public.comments add constraint comments_no_self_reply check(reply_to_id <> id);
create index comments_reply_idx on public.comments(post_id,reply_to_id) where reply_to_id is not null;
alter policy comments_read on public.comments using (
  deleted_at is null and fishing_private.can_view_post(post_id)
  and not fishing_private.is_blocked(author_id,(select auth.uid()))
);

create function fishing_private.comment_json(target uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',c.id,'post_id',c.post_id,
    'author',fishing_private.profile_json(c.author_id),'body',c.body,'created_at',c.created_at,
    'reply_to_id',c.reply_to_id,'reply_to',(
      select jsonb_build_object('id',r.id,'author',fishing_private.profile_json(r.author_id),
        'body',left(r.body,160)) from public.comments r
      where r.id=c.reply_to_id and r.post_id=c.post_id and r.deleted_at is null
        and not fishing_private.is_blocked(r.author_id,(select auth.uid()))
    ))
  from public.comments c where c.id=target and c.deleted_at is null
    and fishing_private.can_view_post(c.post_id)
    and not fishing_private.is_blocked(c.author_id,(select auth.uid()));
$$;

create function fishing_private.comments_page(target uuid, cursor_value text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cursor_time timestamptz; cursor_id uuid; items jsonb; next_cursor text; total bigint;
begin
  if not fishing_private.can_view_post(target) then raise exception 'NOT_FOUND'; end if;
  if coalesce(cursor_value,'') <> '' then
    if length(cursor_value)>100 or array_length(string_to_array(cursor_value,'|'),1)<>2 then
      raise exception 'INVALID_INPUT'; end if;
    begin
      cursor_time := split_part(cursor_value,'|',1)::timestamptz;
      cursor_id := split_part(cursor_value,'|',2)::uuid;
      if not isfinite(cursor_time) then raise exception 'INVALID_INPUT'; end if;
    exception when others then raise exception 'INVALID_INPUT'; end;
  end if;
  with candidates as (
    select c.id,c.created_at from public.comments c where c.post_id=target and c.deleted_at is null
      and not fishing_private.is_blocked(c.author_id,(select auth.uid()))
      and (cursor_time is null or (c.created_at,c.id)<(cursor_time,cursor_id))
    order by c.created_at desc,c.id desc limit 31
  ), numbered as(select *,row_number() over(order by created_at desc,id desc) n from candidates)
  select coalesce(jsonb_agg(fishing_private.comment_json(id) order by created_at desc,id desc)
      filter(where n<=30),'[]'::jsonb),
    case when count(*)>30 then max(created_at::text||'|'||id::text) filter(where n=30) end
    into items,next_cursor from numbered;
  select count(*) into total from public.comments c where c.post_id=target and c.deleted_at is null
    and not fishing_private.is_blocked(c.author_id,(select auth.uid()));
  return jsonb_build_object('items',items,'next',next_cursor,'total',total);
end $$;

create function fishing_private.comment_write(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid:=auth.uid(); target uuid:=nullif(payload->>'id','')::uuid;
  post_target uuid:=nullif(payload->>'post_id','')::uuid;
  reply_target uuid:=nullif(payload->>'reply_to_id','')::uuid;
  content text:=trim(payload->>'body'); existing public.comments; quoted public.comments;
begin
  -- Called only by write_api, after its per-user advisory lock and rate limit.
  if uid is null or not exists(select 1 from public.profiles where id=uid) then
    raise exception 'NOT_AUTHENTICATED'; end if;
  if target is null or post_target is null then raise exception 'INVALID_INPUT'; end if;
  -- Same ordering as author content mutations: user lock -> post -> comment.
  perform 1 from public.posts where id=post_target for share;
  if not found or not fishing_private.can_view_post(post_target) then raise exception 'NOT_FOUND'; end if;
  select * into existing from public.comments where id=target for update;
  if action='delete_comment' then
    if existing.id is null or existing.author_id<>uid or existing.post_id<>post_target then
      raise exception 'NOT_FOUND'; end if;
    update public.comments set body='',deleted_at=coalesce(deleted_at,clock_timestamp()) where id=target;
    return to_jsonb(true);
  end if;
  if action<>'comment' or content is null or length(content) not between 1 and 500
    or jsonb_typeof(payload->'body') is distinct from 'string' then raise exception 'INVALID_INPUT'; end if;
  if existing.id is not null then
    if existing.author_id<>uid or existing.post_id<>post_target then raise exception 'FORBIDDEN'; end if;
    if existing.deleted_at is not null then raise exception 'NOT_FOUND'; end if;
    if existing.body<>content or existing.reply_to_id is distinct from reply_target then
      raise exception 'COMMENT_REQUEST_REUSED'; end if;
    return to_jsonb(true);
  end if;
  if reply_target is not null then
    select * into quoted from public.comments where id=reply_target for share;
    if quoted.id is null or quoted.post_id<>post_target or quoted.deleted_at is not null
      or fishing_private.is_blocked(quoted.author_id,uid) or reply_target=target then
      raise exception 'COMMENT_REPLY_UNAVAILABLE'; end if;
  end if;
  insert into public.comments(id,post_id,author_id,body,reply_to_id)
    values(target,post_target,uid,content,reply_target);
  return to_jsonb(true);
end $$;
revoke all on function fishing_private.comment_json(uuid),
  fishing_private.comments_page(uuid,text),fishing_private.comment_write(text,jsonb)
  from public,anon,authenticated;

-- Keep wrappers/grants, all other actions, and the existing abuse controls unchanged.
do $$
declare source text; old_sql text;
begin
  source := pg_get_functiondef('fishing_private.post_json(uuid)'::regprocedure);
  old_sql := 'where c.post_id=p.id and not fishing_private.is_blocked';
  if (length(source)-length(replace(source,old_sql,'')))<>length(old_sql) then
    raise exception 'post count layout changed'; end if;
  execute replace(source,old_sql,'where c.post_id=p.id and c.deleted_at is null and not fishing_private.is_blocked');

  source := pg_get_functiondef('fishing_private.read_api(text,jsonb)'::regprocedure);
  old_sql := substring(source from '  when ''post'' then[\s\S]*?(?=  when ''spots'' then)');
  if old_sql is null then raise exception 'post read layout changed'; end if;
  execute replace(source,old_sql,$new$  when 'comments' then
    return fishing_private.comments_page(target,payload->>'cursor');
  when 'post' then
    result:=fishing_private.post_json(target);if result is null then raise exception 'NOT_FOUND';end if;
    items:=fishing_private.comments_page(target);
    return jsonb_build_object('post',result,'comments',items->'items','comments_next',items->'next');
$new$);

  source := pg_get_functiondef('fishing_private.write_api(text,jsonb)'::regprocedure);
  old_sql := substring(source from '  when ''comment'' then[\s\S]*?(?=  when ''save_spot'')');
  if old_sql is null then raise exception 'comment write layout changed'; end if;
  execute replace(source,old_sql,$new$  when 'comment', 'delete_comment' then
    return fishing_private.comment_write(action,payload);
$new$);
end $$;
