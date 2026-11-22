-- The live parent is cleared on deletion. Keep the requested ID for retry identity
-- and deleted-quote placeholders, even if someone later reuses the deleted UUID.
alter table fishing_private.spot_discussions
  add column reply_to_id uuid references fishing_private.spot_discussions(id) on delete set null,
  add column requested_reply_id uuid,
  drop constraint spot_discussions_body_check,
  add constraint spot_discussions_body_check check (char_length(btrim(body)) <= 500);
create index spot_discussions_reply_idx on fishing_private.spot_discussions(reply_to_id)
  where reply_to_id is not null;

alter table public.media_assets
  add column spot_discussion_id uuid references fishing_private.spot_discussions(id) on delete cascade,
  drop constraint media_single_parent,
  add constraint media_single_parent check
    (num_nonnulls(post_id,trip_id,report_id,message_id,spot_id,avatar_profile_id,comment_id,spot_discussion_id) <= 1);
create index media_assets_spot_discussion_idx on public.media_assets(spot_discussion_id, sort_order)
  where spot_discussion_id is not null;

create or replace function fishing_private.can_view_media(target uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.media_assets m where m.id=target and m.message_id is null and
    case when m.spot_discussion_id is not null then exists (
      select from fishing_private.spot_discussions d where d.id=m.spot_discussion_id
        and fishing_private.community_target_visible(d.target)
        and not fishing_private.is_blocked(d.author_id,(select auth.uid())))
    when m.comment_id is not null then fishing_private.can_view_comment_media(m.comment_id)
    else m.owner_id=(select auth.uid())
      or (m.avatar_profile_id is not null and not fishing_private.is_blocked(m.owner_id,(select auth.uid())))
      or (m.spot_id is not null and not m.is_staged and fishing_private.can_view_spot(m.spot_id))
      or (m.post_id is not null and not m.is_staged and fishing_private.can_view_post(m.post_id))
      or (fishing_private.is_moderator() and exists(select from public.posts p where p.id=m.post_id and p.audience<>'private' and p.status<>'deleted'))
      or (fishing_private.is_moderator() and exists(select from public.fishing_spots s where s.id=m.spot_id and s.audience<>'private' and s.status<>'deleted'))
    end);
$$;

-- Keep existing attachment entry points from claiming or moving a discussion photo.
do $migration$
declare item record; source text;
begin
  for item in select * from (values
    ('set_content_media(text,uuid,jsonb)', 'and m.comment_id is null', 'and m.comment_id is null and m.spot_discussion_id is null'),
    ('content_update_media(uuid,jsonb,boolean)', 'and m.comment_id is null', 'and m.comment_id is null and m.spot_discussion_id is null'),
    ('set_spot_photos(uuid,jsonb,boolean)', 'and m.comment_id is null', 'and m.comment_id is null and m.spot_discussion_id is null'),
    ('update_water_report(jsonb)', 'and m.comment_id is null', 'and m.comment_id is null and m.spot_discussion_id is null'),
    ('water_report_write(text,jsonb)', 'and comment_id is null', 'and comment_id is null and spot_discussion_id is null'),
    ('set_profile_avatar(uuid)', 'm.comment_id)=0', 'm.comment_id,m.spot_discussion_id)=0'),
    ('comment_write(text,jsonb)', 'm.comment_id)=0', 'm.comment_id,m.spot_discussion_id)=0')
  ) as writers(signature,anchor,replacement) loop
    source:=pg_get_functiondef(('fishing_private.'||item.signature)::regprocedure);
    if position(item.anchor in source)=0 then raise exception 'Unexpected attachment writer: %',item.signature; end if;
    execute replace(source,item.anchor,item.replacement);
  end loop;
end $migration$;

create function fishing_private.write_spot_discussion(k text, uid uuid, payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  entry_id uuid:=(payload->>'id')::uuid; parent uuid:=(payload->>'reply_to_id')::uuid;
  msg text:=btrim(coalesce(payload->>'body','')); pictures jsonb:=coalesce(payload->'media','[]'::jsonb);
  ids uuid[]; attached uuid[]; prior fishing_private.spot_discussions;
begin
  if entry_id is null or jsonb_typeof(payload->'body') is distinct from 'string' or length(msg)>500
    or jsonb_typeof(pictures) is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
  if jsonb_array_length(pictures)>6 or (msg='' and jsonb_array_length(pictures)=0) then raise exception 'INVALID_INPUT'; end if;
  select array(select (part->>'id')::uuid from jsonb_array_elements(pictures) with ordinality p(part,n) order by n) into ids;
  if cardinality(ids)<>(select count(distinct id) from unnest(ids) id) then raise exception 'INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fishing-spot-comments:'||uid::text,0));
  select * into prior from fishing_private.spot_discussions where id=entry_id for update;
  if found then
    if prior.target<>k or prior.author_id<>uid then raise exception 'FORBIDDEN'; end if;
    select array(select id from public.media_assets where spot_discussion_id=entry_id order by sort_order,id) into attached;
    if prior.body<>msg or prior.requested_reply_id is distinct from parent or ids<>attached then raise exception 'COMMENT_REQUEST_REUSED'; end if;
    return jsonb_build_object('id',entry_id);
  end if;
  if parent is not null then
    perform 1 from fishing_private.spot_discussions d where d.id=parent and d.target=k
      and not fishing_private.is_blocked(d.author_id,uid) for key share;
    if not found then raise exception 'COMMENT_REPLY_UNAVAILABLE'; end if;
  end if;
  if (select count(*) from fishing_private.spot_discussions where author_id=uid and created_at>now()-interval '10 minutes')>=10
    then raise exception 'RATE_LIMIT'; end if;
  perform m.id from public.media_assets m where m.id=any(ids) order by m.id for update;
  if cardinality(ids)<>(select count(*) from public.media_assets m where m.id=any(ids) and m.owner_id=uid
    and m.kind='image' and not m.is_staged and num_nonnulls(m.post_id,m.trip_id,m.report_id,m.message_id,
      m.spot_id,m.avatar_profile_id,m.comment_id,m.spot_discussion_id)=0) then raise exception 'FORBIDDEN'; end if;
  insert into fishing_private.spot_discussions(id,target,author_id,body,reply_to_id,requested_reply_id,verdict)
    values(entry_id,k,uid,msg,parent,parent,case when msg='' then 'other' end);
  update public.media_assets m set spot_discussion_id=entry_id,sort_order=p.n-1
    from unnest(ids) with ordinality p(id,n) where m.id=p.id;
  return jsonb_build_object('id',entry_id);
end $$;

create function fishing_private.spot_discussion_list(p_target text,viewer uuid,cursor_value text,page_size integer)
returns jsonb language sql stable security invoker set search_path='' as $$
  with page as materialized (
    select d.* from fishing_private.spot_discussions d where d.target=p_target
      and not fishing_private.is_blocked(d.author_id,viewer)
      and (nullif(cursor_value,'') is null or
        (d.created_at,d.id)<(split_part(cursor_value,'|',1)::timestamptz,split_part(cursor_value,'|',2)::uuid))
    order by d.created_at desc,d.id desc limit page_size+1
  ), visible as (
    select * from page order by created_at desc,id desc limit page_size
  )
  select jsonb_build_object('summary',fishing_private.community_spot_summary(p_target,viewer),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'body',d.body,'created_at',d.created_at,
      'own',coalesce(d.author_id=viewer,false),'author',fishing_private.profile_json(d.author_id),
      'reply_to_id',d.requested_reply_id,'reply_to',case when q.id is not null then jsonb_build_object(
        'id',q.id,'author',fishing_private.profile_json(q.author_id),'body',left(coalesce(nullif(q.body,''),'[图片]'),160)) end,
      'media',coalesce((select jsonb_agg(fishing_private.asset_json(m) order by m.sort_order,m.id)
        from public.media_assets m where m.spot_discussion_id=d.id),'[]'::jsonb))
      order by d.created_at desc,d.id desc)
      from visible d left join fishing_private.spot_discussions q on q.id=d.reply_to_id and q.target=d.target
        and not fishing_private.is_blocked(q.author_id,viewer)),'[]'::jsonb),
    'next',case when (select count(*) from page)>page_size then
      (select created_at::text||'|'||id::text from visible order by created_at,id limit 1) end);
$$;

-- Replace only the discussion branches of the authenticated dispatcher.
do $migration$
declare source text:=pg_get_functiondef('fishing_private.spot_community(text,jsonb)'::regprocedure);
  start_at integer; end_at integer;
begin
  start_at:=strpos(source,'  if p_action=''comments'' and p_payload ? ''cursor'' then');
  end_at:=start_at-1+strpos(substr(source,start_at),'  if uid is null then');
  if start_at=0 or end_at<=start_at then raise exception 'Unexpected spot discussion reader'; end if;
  source:=substr(source,1,start_at-1)||$sql$  if p_action='comments' then
    return fishing_private.spot_discussion_list(k,uid,p_payload->>'cursor',case when p_payload ? 'cursor' then 20 else 100 end);
  end if;
$sql$||substr(source,end_at);
  start_at:=strpos(source,'  if p_action=''comment'' then');
  end_at:=strpos(source,'  if p_action=''delete_comment'' then');
  if start_at=0 or end_at<=start_at then raise exception 'Unexpected spot discussion writer'; end if;
  execute substr(source,1,start_at-1)||$sql$  if p_action='comment' then
    return fishing_private.write_spot_discussion(k,uid,p_payload);
  end if;
$sql$||substr(source,end_at);
end $migration$;
drop function fishing_private.spot_discussion_page(text,uuid,text);
revoke all on function fishing_private.write_spot_discussion(text,uuid,jsonb),
  fishing_private.spot_discussion_list(text,uuid,text,integer) from public,anon,authenticated,service_role;
