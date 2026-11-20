-- Operational review: caller authority is always read from the private membership table.
-- No moderator membership is created by this migration.
alter table public.posts add column review_revision integer not null default 1 check(review_revision>0);
alter table public.fishing_spots add column review_revision integer not null default 1 check(review_revision>0);
alter table fishing_private.moderation_actions
  add column request_id uuid,
  add column previous_status text,
  add column content_revision integer,
  add constraint moderation_request_unique unique(moderator_id,request_id);
create index moderation_target_idx on fishing_private.moderation_actions(target_type,target_id,id desc);
create index posts_review_queue_idx on public.posts(created_at,id) where status='pending' and audience<>'private';
create index spots_review_queue_idx on public.fishing_spots(created_at,id) where status='pending' and audience<>'private';

create function fishing_private.bump_review_revision() returns trigger language plpgsql set search_path='' as $$
begin new.review_revision:=old.review_revision+1; return new; end $$;
create trigger posts_review_revision before update on public.posts for each row execute function fishing_private.bump_review_revision();
create trigger spots_review_revision before update on public.fishing_spots for each row execute function fishing_private.bump_review_revision();

create function fishing_private.is_moderator() returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from fishing_private.moderators where user_id=auth.uid());
$$;

create function fishing_private.review_item(kind text,target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not fishing_private.is_moderator() then raise exception 'FORBIDDEN';end if;
  if kind='post' then
    select jsonb_build_object('id',p.id,'type','post','title',p.title,'body',p.body,'status',p.status,
      'revision',p.review_revision,'audience',p.audience,'created_at',p.created_at,
      'author',fishing_private.profile_json(p.author_id),
      'details',jsonb_build_object('鱼种',p.species,'钓法',p.method,'饵料',p.bait,'日期',p.occurred_on,'地点描述',p.location_label),
      'media',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'path',m.path,'width',m.width,'height',m.height) order by m.created_at,m.id) from public.media_assets m where m.post_id=p.id),'[]'::jsonb))
    into result from public.posts p where p.id=target and p.status<>'deleted' and p.audience<>'private';
  elsif kind='spot' then
    -- Do not join spot_locations: review never reveals hidden/precise coordinates or access notes.
    select jsonb_build_object('id',s.id,'type','spot','title',s.name,'body',s.description,'status',s.status,
      'revision',s.review_revision,'audience',s.audience,'created_at',s.created_at,
      'author',fishing_private.profile_json(s.author_id),
      'details',jsonb_build_object('城市',s.city,'水域',s.water_type,'鱼种',s.species,'费用说明',s.fee_note,'核实日期',s.observed_on),
      'media','[]'::jsonb)
    into result from public.fishing_spots s where s.id=target and s.status<>'deleted' and s.audience<>'private';
  else raise exception 'INVALID_INPUT'; end if;
  if result is null then raise exception 'NOT_FOUND';end if;
  return result;
end $$;

create function fishing_private.moderation_api(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); target uuid:=nullif(payload->>'id','')::uuid; kind text:=payload->>'type';
  decision text:=payload->>'decision'; reason text:=btrim(coalesce(payload->>'reason',''));
  expected integer; revision integer; owner_id uuid; current_status text; audience text;
  review_request_id uuid; prior fishing_private.moderation_actions; result jsonb; items jsonb; next_cursor jsonb;
  cursor_time timestamptz; cursor_id uuid; cursor_type text;
begin
  if uid is null or not exists(select 1 from public.profiles where id=uid) then raise exception 'NOT_AUTHENTICATED';end if;
  if action='access' then return jsonb_build_object('allowed',fishing_private.is_moderator());end if;
  if action='own_status' then
    if kind='post' then select p.status,p.author_id into current_status,owner_id from public.posts p where p.id=target;
    elsif kind='spot' then select s.status,s.author_id into current_status,owner_id from public.fishing_spots s where s.id=target;
    else raise exception 'INVALID_INPUT';end if;
    if owner_id is distinct from uid or current_status='deleted' then raise exception 'NOT_FOUND';end if;
    select a.reason into reason from fishing_private.moderation_actions a where a.target_type=kind and a.target_id=target
      and a.decision=current_status order by a.id desc limit 1;
    return jsonb_build_object('status',current_status,'reason',coalesce(reason,''));
  end if;
  if not fishing_private.is_moderator() then raise exception 'FORBIDDEN';end if;
  if action='queue' then
    if coalesce(payload->>'cursor','null')<>'null' then
      cursor_time:=(payload->'cursor'->>'created_at')::timestamptz;
      cursor_id:=(payload->'cursor'->>'id')::uuid;
      cursor_type:=payload->'cursor'->>'type';
      if cursor_time is null or cursor_id is null or cursor_type is null or cursor_type not in ('post','spot') then raise exception 'INVALID_INPUT';end if;
    end if;
    with candidates as (
      select p.id,'post'::text kind,p.title,p.author_id,p.created_at,p.audience from public.posts p where p.status='pending' and p.audience<>'private'
      union all
      select s.id,'spot'::text,s.name,s.author_id,s.created_at,s.audience from public.fishing_spots s where s.status='pending' and s.audience<>'private'
    ), page as (
      select * from candidates c where cursor_time is null or (c.created_at,c.id,c.kind)>(cursor_time,cursor_id,cursor_type)
      order by c.created_at,c.id,c.kind limit 13
    ), numbered as(select c.*,row_number() over(order by c.created_at,c.id,c.kind) n from page c)
    select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'type',c.kind,'title',c.title,'author',fishing_private.profile_json(c.author_id),
      'audience',c.audience,'created_at',c.created_at) order by c.n) filter(where c.n<=12),'[]'::jsonb),
      case when count(*)>12 then (jsonb_agg(jsonb_build_object('id',c.id,'type',c.kind,'created_at',c.created_at)) filter(where c.n=12))->0 else null end
      into items,next_cursor from numbered c;
    return jsonb_build_object('items',items,'next',next_cursor);
  elsif action='item' then return fishing_private.review_item(kind,target);
  elsif action<>'decide' then raise exception 'INVALID_INPUT';end if;

  expected:=(payload->>'revision')::integer;
  review_request_id:=nullif(payload->>'request_id','')::uuid;
  if target is null or review_request_id is null or expected is null or expected<1 or kind is null or kind not in ('post','spot')
    or decision is null or decision not in ('published','rejected','hidden') or length(reason) not between 1 and 500 then raise exception 'INVALID_INPUT';end if;
  perform pg_advisory_xact_lock(hashtextextended('fishing-user:'||uid::text,0));
  select * into prior from fishing_private.moderation_actions a where a.moderator_id=uid and a.request_id=review_request_id;
  if found then
    if prior.target_id<>target or prior.target_type<>kind or prior.decision<>decision or prior.reason<>reason or prior.content_revision<>expected then raise exception 'REVIEW_CONFLICT';end if;
    return jsonb_build_object('status',prior.decision,'revision',prior.content_revision+1);
  end if;
  if (select count(*) from fishing_private.rate_events where user_id=uid and created_at>now()-interval '1 minute')>=90 then raise exception 'RATE_LIMIT';end if;
  if kind='post' then
    select p.author_id,p.status,p.review_revision,p.audience into owner_id,current_status,revision,audience from public.posts p where p.id=target for update;
  else
    select s.author_id,s.status,s.review_revision,s.audience into owner_id,current_status,revision,audience from public.fishing_spots s where s.id=target for update;
  end if;
  if owner_id is null or current_status='deleted' or audience='private' then raise exception 'NOT_FOUND';end if;
  if owner_id=uid then raise exception 'SELF_REVIEW';end if;
  if revision<>expected then raise exception 'REVIEW_CONFLICT';end if;
  if not ((current_status='pending' and decision in ('published','rejected'))
    or (current_status='published' and decision='hidden')
    or (current_status in ('rejected','hidden') and decision='published')) then raise exception 'INVALID_TRANSITION';end if;
  if kind='post' then update public.posts set status=decision where id=target;
  else update public.fishing_spots set status=decision where id=target;end if;
  insert into fishing_private.moderation_actions(moderator_id,target_type,target_id,decision,reason,request_id,previous_status,content_revision)
    values(uid,kind,target,decision,reason,review_request_id,current_status,revision);
  insert into fishing_private.rate_events(user_id,action) values(uid,'moderate');
  delete from fishing_private.rate_events where user_id=uid and created_at<now()-interval '1 day';
  return jsonb_build_object('status',decision,'revision',revision+1);
end $$;

-- Route the pre-existing command through the same validation: no stale-version bypass.
do $migration$
declare definition text; before_block text;
begin
  select pg_get_functiondef('fishing_private.write_api(text,jsonb)'::regprocedure) into definition;
  before_block:=substring(definition from '  when ''moderate'' then[\s\S]*?(?=  else raise exception ''INVALID_INPUT'';)');
  if before_block is null then raise exception 'Unexpected write_api definition; inspect before migrating';end if;
  definition:=replace(definition,before_block,E'  when ''moderate'' then\n    return fishing_private.moderation_api(''decide'',payload);\n');
  execute definition;
end $migration$;

-- Reviewable post photos only. Never expand access to unattached uploads or private trip photos.
create or replace function fishing_private.can_view_media(target uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.media_assets m where m.id=target and
    (m.owner_id=auth.uid() or (m.post_id is not null and fishing_private.can_view_post(m.post_id))
      or (fishing_private.is_moderator() and exists(select 1 from public.posts p where p.id=m.post_id and p.audience<>'private' and p.status<>'deleted'))));
$$;
create function public.fishing_moderation(action text,payload jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$
  select fishing_private.moderation_api(action,payload);
$$;
revoke all on function fishing_private.bump_review_revision(),fishing_private.is_moderator(),fishing_private.review_item(text,uuid),fishing_private.moderation_api(text,jsonb),public.fishing_moderation(text,jsonb) from public,anon,authenticated;
grant execute on function fishing_private.moderation_api(text,jsonb),public.fishing_moderation(text,jsonb) to authenticated;
