create or replace function fishing_private.community_spot_summary(p_target text, uid uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object(
    'target',p_target,'status',fishing_private.community_spot_state(p_target),
    'likes',(select count(*) from fishing_private.spot_reactions where target=p_target and kind='like'),
    'rank_likes',(select count(*) from fishing_private.spot_reactions where target=p_target and kind='like'
      and user_id is distinct from (select s.author_id from public.fishing_spots s where s.id=fishing_private.community_spot_id(p_target))),
    'liked',exists(select from fishing_private.spot_reactions where target=p_target and kind='like' and user_id=uid),
    'map_resolved',left(p_target,5)='spot:' or exists (select from fishing_private.spot_lead_points lead where p_target='lead:'||lead.city||'|'||lead.name),
    'pending_analysis',exists (select from fishing_private.spot_discussions where target=p_target
      and verdict is null and retry_at<=now() and created_at>=now()-interval '90 days'),
    'comments',(select count(*) from fishing_private.spot_discussions where target=p_target and not fishing_private.is_blocked(author_id,uid)),
    'saved',case when left(p_target,5)='spot:' then exists(select from public.spot_bookmarks where spot_id=fishing_private.community_spot_id(p_target) and user_id=uid)
      else exists(select from fishing_private.spot_reactions where target=p_target and kind='bookmark' and user_id=uid) end
  )
$$;

create or replace function fishing_private.nearby_prohibited_spot_points(payload jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$
  with viewport as (
    select box(point((payload->>'west')::float8-.018,(payload->>'south')::float8-.012),
      point((payload->>'east')::float8+.018,(payload->>'north')::float8+.012)) as bounds
  ), points as (
    select s.id::text,s.name,s.city,s.observed_on,s.created_at,s.review_revision,l.longitude,l.latitude,
      false as catalog, opinion.status='prohibited' as community_based
    from viewport v join public.spot_locations l on point(l.longitude,l.latitude)<@v.bounds
      join public.fishing_spots s on s.id=l.spot_id
      cross join lateral (select fishing_private.community_spot_state('spot:'||s.id::text) status) opinion
    where s.audience='public' and s.precision='exact' and s.status='published' and fishing_private.can_view_spot(s.id)
      and case opinion.status when 'prohibited' then true when 'open' then false
        when 'unavailable' then false else s.fishing_status='prohibited' end
    union all
    select 'lead:'||l.city||'|'||l.name,l.name,l.city,null,l.created_at,1,l.longitude,l.latitude,true,true
    from viewport v join fishing_private.spot_lead_points l on point(l.longitude,l.latitude)<@v.bounds
    where fishing_private.community_spot_state('lead:'||l.city||'|'||l.name)='prohibited'
  ), newest as (
    select * from points order by observed_on desc nulls last,created_at desc nulls last,id limit 100
  )
  select coalesce(jsonb_agg(to_jsonb(p) order by p.observed_on desc nulls last,p.created_at desc nulls last,p.id),'[]'::jsonb)
  from newest p
$$;
