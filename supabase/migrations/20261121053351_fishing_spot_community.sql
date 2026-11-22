create table fishing_private.spot_discussions (
  id uuid primary key default gen_random_uuid(),
  target text not null,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now(),
  verdict text check (verdict in ('prohibited', 'open', 'unavailable', 'other')),
  retry_at timestamptz not null default now()
);
create index spot_discussion_target_date_idx on fishing_private.spot_discussions(target, created_at desc, id desc);
create index spot_discussion_author_date_idx on fishing_private.spot_discussions(author_id, created_at desc);
create index spot_discussion_pending_idx on fishing_private.spot_discussions(target, retry_at) where verdict is null;
create table fishing_private.spot_reactions (
  target text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('like', 'bookmark')),
  primary key (target, kind, user_id)
);
create index spot_reactions_user_idx on fishing_private.spot_reactions(user_id);
create table fishing_private.spot_lead_points (
  city text not null,
  name text not null,
  longitude double precision not null check (longitude between -180 and 180),
  latitude double precision not null check (latitude between -85 and 85),
  created_at timestamptz not null default now(),
  primary key (city, name),
  foreign key (city, name) references public.fishing_spot_leads(city, name) on delete cascade
);
alter table fishing_private.spot_discussions enable row level security;
alter table fishing_private.spot_reactions enable row level security;
alter table fishing_private.spot_lead_points enable row level security;
revoke all on fishing_private.spot_discussions, fishing_private.spot_reactions, fishing_private.spot_lead_points from public, anon, authenticated;
grant select on fishing_private.spot_discussions, fishing_private.spot_reactions, fishing_private.spot_lead_points to service_role;
grant update on fishing_private.spot_discussions to service_role;
grant insert, update on fishing_private.spot_lead_points to service_role;

-- Internal spots reuse their original bookmarks and visibility rules.
create function fishing_private.community_spot_id(target text) returns uuid
language sql immutable set search_path='' as $$
  select case when target ~ '^spot:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then substr(target,6)::uuid end
$$;
create function fishing_private.community_target_visible(target text) returns boolean
language sql stable set search_path='' as $$
  select case when left(target,5)='spot:'
    then exists (select from public.fishing_spots s
      where s.id=fishing_private.community_spot_id(target) and s.audience='public'
        and s.status='published' and fishing_private.can_view_spot(s.id))
    else target like 'lead:%' and exists (
      select from public.fishing_spot_leads l
      where l.city=split_part(substr(target,6),'|',1)
        and l.name=substr(substr(target,6), length(l.city)+2)
        and target='lead:' || l.city || '|' || l.name
    ) end
$$;

-- Give each account one current opinion per spot. Fishing-quality comments are not status votes.
create function fishing_private.community_spot_state(p_target text) returns text
language sql stable set search_path='' as $$
  with opinions as (
    select distinct on (author_id) verdict
    from fishing_private.spot_discussions
    where target=p_target and verdict in ('prohibited','open','unavailable')
      and created_at >= now() - interval '90 days'
    order by author_id, created_at desc, id desc
  ), tallies as (
    select verdict, count(*) votes from opinions group by verdict
  )
  select coalesce((select verdict from tallies
    where (select sum(votes) from tallies)>=10
      and votes*100>=(select sum(votes) from tallies)*60 limit 1),'')
$$;

create function fishing_private.community_spot_summary(p_target text, uid uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object(
    'target',p_target,'status',fishing_private.community_spot_state(p_target),
    'likes',(select count(*) from fishing_private.spot_reactions where target=p_target and kind='like'),
    'liked',exists(select from fishing_private.spot_reactions where target=p_target and kind='like' and user_id=uid),
    'comments',(select count(*) from fishing_private.spot_discussions where target=p_target and not fishing_private.is_blocked(author_id,uid)),
    'saved',case when left(p_target,5)='spot:' then exists(select from public.spot_bookmarks where spot_id=fishing_private.community_spot_id(p_target) and user_id=uid)
      else exists(select from fishing_private.spot_reactions where target=p_target and kind='bookmark' and user_id=uid) end
  )
$$;

create function fishing_private.spot_community(p_action text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); k text:=p_payload->>'target'; target_id uuid;
  msg text; comment_id uuid; selected_kind text; flag boolean; output jsonb;
begin
  if p_action='summary' then
    if jsonb_typeof(p_payload->'targets') is distinct from 'array' or jsonb_array_length(p_payload->'targets')>120 then
      raise exception 'INVALID_INPUT';
    end if;
    return coalesce((select jsonb_agg(fishing_private.community_spot_summary(key,uid))
      from (select distinct key from jsonb_array_elements_text(p_payload->'targets') as entry(key)
        where length(key)<=180 and fishing_private.community_target_visible(key)) visible),'[]'::jsonb);
  end if;
  if p_action='saved_leads' then
    if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
    return coalesce((select jsonb_agg(l.card) from public.fishing_spot_leads l
      join fishing_private.spot_reactions r on r.target='lead:' || l.city || '|' || l.name
      where r.user_id=uid and r.kind='bookmark'),'[]'::jsonb);
  end if;
  if k is null or length(k)>180 or not fishing_private.community_target_visible(k) then raise exception 'NOT_FOUND'; end if;
  target_id:=fishing_private.community_spot_id(k);
  if p_action='comments' then
    return jsonb_build_object('summary',fishing_private.community_spot_summary(k,uid),
      'items',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'body',c.body,'created_at',c.created_at,
        'own',coalesce(c.author_id=uid,false),'author',fishing_private.profile_json(c.author_id)) order by c.created_at desc,c.id desc)
        from (select * from fishing_private.spot_discussions where target=k
          and not fishing_private.is_blocked(author_id,uid) order by created_at desc,id desc limit 100)c),'[]'::jsonb));
  end if;
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_action='react' then
    selected_kind:=p_payload->>'kind';
    if selected_kind is null or selected_kind not in ('like','bookmark') or jsonb_typeof(p_payload->'enabled') is distinct from 'boolean' then
      raise exception 'INVALID_INPUT';
    end if;
    flag:=(p_payload->>'enabled')::boolean;
    if selected_kind='bookmark' and target_id is not null then
      if flag then insert into public.spot_bookmarks(user_id,spot_id) values(uid,target_id) on conflict do nothing;
      else delete from public.spot_bookmarks where user_id=uid and spot_id=target_id; end if;
    elsif flag then
      insert into fishing_private.spot_reactions(target,user_id,kind) values(k,uid,selected_kind) on conflict do nothing;
    else
      delete from fishing_private.spot_reactions where target=k and user_id=uid and kind=selected_kind;
    end if;
    return fishing_private.community_spot_summary(k,uid);
  end if;
  if p_action='comment' then
    msg:=btrim(coalesce(p_payload->>'body',''));
    comment_id:=(p_payload->>'id')::uuid;
    if comment_id is null or char_length(msg) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
    perform pg_advisory_xact_lock(hashtextextended('fishing-spot-comments:' || uid::text,0));
    if exists(select from fishing_private.spot_discussions where id=comment_id) then
      if exists(select from fishing_private.spot_discussions where id=comment_id and author_id=uid and target=k and body=msg)
        then return jsonb_build_object('id',comment_id); end if;
      raise exception 'INVALID_INPUT';
    end if;
    if (select count(*) from fishing_private.spot_discussions where author_id=uid and created_at>now()-interval '10 minutes')>=10
      then raise exception 'RATE_LIMIT'; end if;
    insert into fishing_private.spot_discussions(id,target,author_id,body) values(comment_id,k,uid,msg);
    return jsonb_build_object('id',comment_id);
  end if;
  if p_action='delete_comment' then
    delete from fishing_private.spot_discussions where id=(p_payload->>'id')::uuid and target=k and author_id=uid;
    if not found then raise exception 'NOT_FOUND'; end if;
    return fishing_private.community_spot_summary(k,uid);
  end if;
  raise exception 'INVALID_INPUT';
exception when invalid_text_representation then raise exception 'INVALID_INPUT';
end $$;

create function public.fishing_spot_community(action text, payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$
  select fishing_private.spot_community(action,payload)
$$;

create function public.fishing_claim_spot_comments(p_target text) returns table(id uuid, body text)
language sql security invoker set search_path='' as $$
  with waiting as (
    select c.id from fishing_private.spot_discussions c
    where c.target=p_target and c.verdict is null and c.retry_at<=now()
      and c.created_at>=now()-interval '90 days'
    order by c.retry_at,c.id limit 12 for update skip locked
  )
  update fishing_private.spot_discussions c set retry_at=now()+interval '5 minutes'
    from waiting where c.id=waiting.id returning c.id,c.body
$$;
create function public.fishing_apply_spot_comment_analysis(p_target text, p_results jsonb) returns text
language plpgsql security invoker set search_path='' as $$
begin
  update fishing_private.spot_discussions c set verdict=r.verdict
    from jsonb_to_recordset(p_results) as r(id uuid, verdict text)
    where c.id=r.id and c.target=p_target and c.verdict is null
      and r.verdict in ('prohibited','open','unavailable','other');
  return fishing_private.community_spot_state(p_target);
end
$$;
create function public.fishing_store_spot_lead_point(p_city text,p_name text,p_lng double precision,p_lat double precision) returns void
language sql security invoker set search_path='' as $$
  insert into fishing_private.spot_lead_points(city,name,longitude,latitude) values(p_city,p_name,p_lng,p_lat)
  on conflict (city,name) do update set longitude=excluded.longitude,latitude=excluded.latitude
$$;
revoke all on function fishing_private.community_spot_id(text), fishing_private.community_target_visible(text),
  fishing_private.community_spot_state(text),fishing_private.community_spot_summary(text,uuid),
  fishing_private.spot_community(text,jsonb), public.fishing_spot_community(text,jsonb),
  public.fishing_claim_spot_comments(text),public.fishing_apply_spot_comment_analysis(text,jsonb),
  public.fishing_store_spot_lead_point(text,text,double precision,double precision) from public,anon,authenticated,service_role;
grant execute on function fishing_private.spot_community(text,jsonb),public.fishing_spot_community(text,jsonb) to anon,authenticated;
grant execute on function public.fishing_claim_spot_comments(text),public.fishing_apply_spot_comment_analysis(text,jsonb),
  public.fishing_store_spot_lead_point(text,text,double precision,double precision),
  fishing_private.community_spot_state(text) to service_role;

-- Preserve the published location and existing bounds/visibility checks when changing pin status.
create or replace function fishing_private.nearby_prohibited_spot_points(payload jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$
  with viewport as (
    select box(
      point((payload->>'west')::float8-.018,(payload->>'south')::float8-.012),
      point((payload->>'east')::float8+.018,(payload->>'north')::float8+.012)
    ) as bounds
  ), points as (
    select s.id::text,s.name,s.city,s.observed_on,s.created_at,s.review_revision,
      l.longitude,l.latitude,false as catalog
    from viewport v join public.spot_locations l on point(l.longitude,l.latitude)<@v.bounds
      join public.fishing_spots s on s.id=l.spot_id
    where s.audience='public' and s.precision='exact' and s.status='published'
      and fishing_private.can_view_spot(s.id)
      and case fishing_private.community_spot_state('spot:' || s.id::text)
        when 'prohibited' then true when 'open' then false when 'unavailable' then false
        else s.fishing_status='prohibited' end
    union all
    select 'lead:' || l.city || '|' || l.name,l.name,l.city,null,l.created_at,1,l.longitude,l.latitude,true
    from viewport v join fishing_private.spot_lead_points l on point(l.longitude,l.latitude)<@v.bounds
    where fishing_private.community_spot_state('lead:' || l.city || '|' || l.name)='prohibited'
  ), newest as (
    select * from points order by observed_on desc nulls last, created_at desc nulls last, id limit 100
  )
  select coalesce(jsonb_agg(to_jsonb(p) order by p.observed_on desc nulls last,p.created_at desc nulls last,p.id),'[]'::jsonb)
  from newest p
$$;
