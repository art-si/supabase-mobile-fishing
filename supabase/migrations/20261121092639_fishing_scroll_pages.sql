-- Use the same visible coordinates and sorting as the original spot reader.
-- Callers that omit the cursor field retain the original response.
do $migration$
declare source text;
begin
  source := pg_get_functiondef('fishing_private.spots_by_distance(jsonb)'::regprocedure);
  if position('order by distance asc nulls last,created_at desc,id desc limit 100' in source)=0 then
    raise exception 'spot list paging anchor changed';
  end if;
  execute replace(replace(replace(source,
    'items jsonb;',
    'items jsonb; next_cursor text; page_size integer:=case when payload ? ''cursor'' then 24 else 100 end;'),
    'select * from measured order by distance asc nulls last,created_at desc,id desc limit 100',
    $sql$
    select *, row_number() over (order by distance asc nulls last,created_at desc,id desc) as row_no
    from measured
    where (not (payload ? 'cursor') or (x between 73 and 136 and y between 3 and 54))
      and (nullif(payload->>'cursor','') is null
      or coalesce(distance,1e20) > split_part(payload->>'cursor','|',1)::float8
      or (coalesce(distance,1e20) = split_part(payload->>'cursor','|',1)::float8
        and (created_at,id) < (split_part(payload->>'cursor','|',2)::timestamptz,
          split_part(payload->>'cursor','|',3)::uuid)))
    order by distance asc nulls last,created_at desc,id desc limit page_size+1
    $sql$),
    $old$else '{}'::jsonb end order by distance asc nulls last,created_at desc,id desc),'[]'::jsonb) into items from nearest;
  return jsonb_build_object('items',items,'next',null);$old$,
    $new$else '{}'::jsonb end order by row_no) filter (where row_no<=page_size),'[]'::jsonb),
    case when count(*)>page_size and payload ? 'cursor' then
      max(coalesce(distance,1e20)::text||'|'||created_at::text||'|'||id::text)
        filter (where row_no=page_size) end
  into items,next_cursor from nearest;
  return jsonb_build_object('items',items,'next',next_cursor);$new$);
end $migration$;

create function fishing_private.fishing_record_page(p_kind text, payload jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare
  viewer uuid := auth.uid();
  author uuid := (payload->>'id')::uuid;
  cursor_value text := nullif(payload->>'cursor','');
  before_date timestamptz := split_part(cursor_value,'|',1)::timestamptz;
  before_id uuid := split_part(cursor_value,'|',2)::uuid;
  saved boolean := coalesce(payload->>'type'='saved',false);
  output jsonb;
begin
  if p_kind<>'profile_posts' and viewer is null then raise exception 'NOT_AUTHENTICATED'; end if;
  with visible as (
    select p.id,p.created_at as sort_date
    from public.posts p
    where p_kind in ('profile_posts','library_posts')
      and case when p_kind='profile_posts' then p.author_id=author
        when saved then exists(select 1 from public.post_bookmarks b where b.user_id=viewer and b.post_id=p.id)
        else p.author_id=viewer end
      and fishing_private.can_view_post(p.id)
    union all
    select s.id,s.created_at
    from public.fishing_spots s
    where p_kind='library_spots'
      and case when saved then exists(select 1 from public.spot_bookmarks b where b.user_id=viewer and b.spot_id=s.id)
        else s.author_id=viewer end
      and fishing_private.can_view_spot(s.id)
    union all
    select t.id,t.occurred_on::timestamp at time zone 'UTC' from public.trips t
    where p_kind='library_trips' and t.owner_id=viewer
    union all
    select r.id,r.created_at from public.water_reports r
    where p_kind='water_report_page' and r.owner_id=viewer and r.status='saved'
  ), page as (
    select *, row_number() over (order by sort_date desc,id desc) as row_no
    from visible
    where before_date is null or (sort_date,id)<(before_date,before_id)
    order by sort_date desc,id desc limit 21
  )
  select jsonb_build_object(
    'items',coalesce(jsonb_agg(case p_kind
      when 'library_spots' then fishing_private.spot_json(id)
      when 'library_trips' then fishing_private.trip_json(id)
      when 'water_report_page' then fishing_private.water_report_json(id)
      else fishing_private.post_json(id) end order by row_no) filter(where row_no<=20),'[]'::jsonb),
    'next',case when count(*)>20 then max(sort_date::text||'|'||id::text) filter(where row_no=20) end)
  into output from page;
  return output;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
  raise exception 'INVALID_INPUT';
end $$;
revoke all on function fishing_private.fishing_record_page(text,jsonb) from public,anon,authenticated,service_role;

do $migration$
declare source text; anchor text:='  case action';
  profile_anchor text:='    select coalesce(jsonb_agg(fishing_private.post_json(p.id) order by p.created_at desc),''[]''::jsonb) into items from (select * from public.posts where author_id=target and fishing_private.can_view_post(id) order by created_at desc limit 30)p;';
begin
  source:=pg_get_functiondef('fishing_private.read_api(text,jsonb)'::regprocedure);
  if position(anchor in source)=0 or position(profile_anchor in source)=0 then
    raise exception 'fishing record reader anchor changed';
  end if;
  source:=replace(source,anchor,anchor||$sql$
  when 'library_posts' then return fishing_private.fishing_record_page(action,payload);
  when 'library_spots' then return fishing_private.fishing_record_page(action,payload);
  when 'library_trips' then return fishing_private.fishing_record_page(action,payload);$sql$);
  source:=replace(source, 'when ''water_reports'' then return fishing_private.water_report_read(payload);',
    $sql$when 'water_reports' then
    if payload ? 'cursor' and target is null then
      return fishing_private.fishing_record_page('water_report_page',payload);
    end if;
    return fishing_private.water_report_read(payload);$sql$);
  source:=replace(source, profile_anchor, $sql$
    if payload ? 'cursor' then
      items:=fishing_private.fishing_record_page('profile_posts',payload||jsonb_build_object('id',target));
      return jsonb_build_object('profile',result,
        'following',exists(select 1 from public.follows where follower_id=uid and followed_id=target),
        'friend',fishing_private.are_friends(uid,target),
        'blocked',exists(select 1 from public.blocks where blocker_id=uid and blocked_id=target),
        'posts',items->'items','posts_next',items->'next');
    end if;$sql$||profile_anchor);
  execute source;
end $migration$;

create function fishing_private.spot_discussion_page(p_target text, viewer uuid, cursor_value text) returns jsonb
language sql stable security invoker set search_path='' as $$
  with page as (
    select *, row_number() over (order by created_at desc,id desc) as row_no
    from fishing_private.spot_discussions
    where target=p_target and not fishing_private.is_blocked(author_id,viewer)
      and (nullif(cursor_value,'') is null or
        (created_at,id)<(split_part(cursor_value,'|',1)::timestamptz,split_part(cursor_value,'|',2)::uuid))
    order by created_at desc,id desc limit 21
  )
  select jsonb_build_object('summary',fishing_private.community_spot_summary(p_target,viewer),
    'items',coalesce(jsonb_agg(jsonb_build_object('id',id,'body',body,'created_at',created_at,
      'own',coalesce(author_id=viewer,false),'author',fishing_private.profile_json(author_id))
      order by row_no) filter(where row_no<=20),'[]'::jsonb),
    'next',case when count(*)>20 then max(created_at::text||'|'||id::text) filter(where row_no=20) end)
  from page
$$;
revoke all on function fishing_private.spot_discussion_page(text,uuid,text) from public,anon,authenticated,service_role;

do $migration$
declare source text; anchor text:='  if p_action=''comments'' then';
begin
  source:=pg_get_functiondef('fishing_private.spot_community(text,jsonb)'::regprocedure);
  if position(anchor in source)=0 then raise exception 'spot discussion paging anchor changed'; end if;
  execute replace(source,anchor,$sql$
  if p_action='comments' and p_payload ? 'cursor' then
    return fishing_private.spot_discussion_page(k,uid,p_payload->>'cursor');
  end if;
  if p_action='comments' then$sql$);
end $migration$;
