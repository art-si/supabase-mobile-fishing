-- Return only public-facing identity fields, after checking both content and actor visibility.
create function fishing_private.discussion_person(actor uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',p.id,'nickname',p.nickname,'avatar',
    (select fishing_private.asset_json(m) from public.media_assets m where m.avatar_profile_id=p.id))
  from public.profiles p where p.id=actor and not fishing_private.is_blocked(p.id,(select auth.uid()));
$$;
create index post_likes_discussion_idx on public.post_likes(post_id,user_id);

create function fishing_private.discussion_likes(k text,after_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare post uuid; viewer uuid:=auth.uid();
begin
  if left(k,5)='post:' then
    post:=substr(k,6)::uuid;
    if not fishing_private.can_view_post(post) then raise exception 'NOT_FOUND'; end if;
  elsif k is null or length(k)>180 or not fishing_private.community_target_visible(k) then
    raise exception 'NOT_FOUND';
  end if;
  return (
    with candidates as (
      select user_id from public.post_likes where post is not null and post_id=post
      union all
      select user_id from fishing_private.spot_reactions where post is null and target=k and kind='like'
    ), page as materialized (
      select user_id from candidates where (after_id is null or user_id>after_id)
        and not fishing_private.is_blocked(user_id,viewer)
      order by user_id limit 19
    ), visible as (select user_id from page order by user_id limit 18)
    select jsonb_build_object('items',coalesce((select jsonb_agg(fishing_private.discussion_person(user_id) order by user_id)
      from visible),'[]'::jsonb),'next',case when (select count(*) from page)>18
        then (select user_id from visible order by user_id desc limit 1) end)
  );
end $$;
revoke all on function fishing_private.discussion_person(uuid),fishing_private.discussion_likes(text,uuid)
  from public,anon,authenticated,service_role;

do $migration$
declare source text; anchor text;
begin
  source:=pg_get_functiondef('fishing_private.read_api(text,jsonb)'::regprocedure);
  anchor:='  case action';
  if strpos(source,anchor)=0 then raise exception 'Unexpected read dispatcher'; end if;
  execute replace(source,anchor,anchor||$sql$
  when 'discussion_likes' then return fishing_private.discussion_likes(payload->>'target',nullif(payload->>'cursor','')::uuid);$sql$);
  source:=pg_get_functiondef('fishing_private.notification_json(fishing_private.notifications)'::regprocedure);
  anchor:='''title'',case when available then label';
  if strpos(source,anchor)=0 then raise exception 'Unexpected notification projection'; end if;
  execute replace(source,anchor,$sql$'actor',case when available and n.category='interaction' then fishing_private.discussion_person(n.actor_id) end,
    $sql$||anchor);
end $migration$;
