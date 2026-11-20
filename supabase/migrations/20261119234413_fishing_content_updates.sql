-- Keep the effective version in public tables; never expose unreviewed replacements there.
create table fishing_private.content_updates (
  target_type text not null check(target_type in ('post','spot')),
  target_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid generated always as (case when target_type='post' then target_id end) stored
    references public.posts(id) on delete cascade,
  spot_id uuid generated always as (case when target_type='spot' then target_id end) stored
    references public.fishing_spots(id) on delete cascade,
  fields jsonb not null check(jsonb_typeof(fields)='object'),
  status text not null default 'pending' check(status in ('pending','rejected')),
  reason text not null default '' check(length(reason)<=500),
  submitted_at timestamptz not null default clock_timestamp(),
  primary key(target_type,target_id)
);
create index content_updates_owner_idx on fishing_private.content_updates(owner_id);
create index content_updates_post_idx on fishing_private.content_updates(post_id) where post_id is not null;
create index content_updates_spot_idx on fishing_private.content_updates(spot_id) where spot_id is not null;
create index content_updates_queue_idx on fishing_private.content_updates(submitted_at,target_id,target_type) where status='pending';
alter table fishing_private.content_updates enable row level security;
revoke all on fishing_private.content_updates from public,anon,authenticated,service_role;
alter table public.media_assets add column is_staged boolean not null default false;
alter table public.media_assets add constraint media_staged_parent check(not is_staged or post_id is not null);
alter table fishing_private.moderation_actions add column is_content_update boolean not null default false;

-- Whitelist and validate BEFORE storing a proposal. Server-managed fields/URLs never enter it.
create function fishing_private.content_update_fields(kind text,payload jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare fields jsonb; key text; max_length integer; weight numeric(10,3); lng double precision; lat double precision;
begin
  if jsonb_typeof(payload) is distinct from 'object' or kind is null or kind not in ('post','spot') then raise exception 'INVALID_INPUT';end if;
  if coalesce(payload->>'audience','private') not in ('public','friends','private') then raise exception 'INVALID_INPUT';end if;
  if kind='post' then
    perform fishing_private.validate_composition('post',payload);
    weight:=nullif(payload->>'weight','')::numeric;
    if (weight is not null and not(weight between 0 and 10000)) or (payload->>'occurred_on')::date is null
      or coalesce(payload->>'kind','') not in ('catch','experience') then raise exception 'INVALID_INPUT';end if;
    fields:=jsonb_build_object('title',trim(coalesce(payload->>'title','')),'body',trim(coalesce(payload->>'body','')),
      'kind',payload->>'kind','species',coalesce(payload->>'species',''),'method',coalesce(payload->>'method',''),
      'bait',coalesce(payload->>'bait',''),'weight_kg',weight,'occurred_on',(payload->>'occurred_on')::date,
      'location_label',coalesce(payload->>'location_label',''),'audience',coalesce(payload->>'audience','private'),
      'media',coalesce((select jsonb_agg(jsonb_build_object('id',(m->>'id')::uuid) order by n)
        from jsonb_array_elements(coalesce(payload->'media','[]')) with ordinality x(m,n)),'[]'::jsonb));
    for key,max_length in select * from (values('species',60),('method',40),('bait',60),('location_label',80)) limits loop
      if length(fields->>key)>max_length then raise exception 'INVALID_INPUT';end if;
    end loop;
  else
    lng:=nullif(payload->>'longitude','')::double precision; lat:=nullif(payload->>'latitude','')::double precision;
    if coalesce(payload->>'water_type','') not in ('自然水域','水库','钓场','其他')
      or coalesce(payload->>'precision','hidden') not in ('exact','area','hidden')
      or (payload->>'observed_on')::date is null
      or length(trim(coalesce(payload->>'name',''))) not between 1 and 60
      or length(trim(coalesce(payload->>'city',''))) not between 1 and 40
      or (lng is null)<>(lat is null)
      or (lng is not null and not(lng between -180 and 180 and lat between -90 and 90))
      or (coalesce(payload->>'precision','hidden')<>'hidden' and lng is null) then raise exception 'INVALID_INPUT';end if;
    fields:=jsonb_build_object('name',trim(payload->>'name'),'city',trim(payload->>'city'),
      'water_type',payload->>'water_type','species',coalesce(payload->>'species',''),
      'description',coalesce(payload->>'description',''),'fee_note',coalesce(payload->>'fee_note','未核实'),
      'observed_on',(payload->>'observed_on')::date,'audience',coalesce(payload->>'audience','private'),
      'precision',coalesce(payload->>'precision','hidden'),'longitude',lng,'latitude',lat,
      'access_note',coalesce(payload->>'access_note',''));
    for key,max_length in select * from (values('species',60),('description',1000),('fee_note',200),('access_note',500)) limits loop
      if length(fields->>key)>max_length then raise exception 'INVALID_INPUT';end if;
    end loop;
  end if;
  return fields;
end $$;

-- Parent is locked first. Lock both effective and proposed assets in stable UUID order.
create function fishing_private.content_update_media(target uuid,photos jsonb,staging boolean) returns void
language plpgsql security invoker set search_path='' as $$
declare owner uuid; scope text; ids uuid[]; amount integer;
begin
  select author_id,audience into owner,scope from public.posts where id=target and status<>'deleted';
  if owner is null or auth.uid() is null then raise exception 'NOT_FOUND';end if;
  if owner<>auth.uid() and (staging or scope='private' or not fishing_private.is_moderator()) then raise exception 'FORBIDDEN';end if;
  if jsonb_typeof(photos) is distinct from 'array' or jsonb_array_length(photos)>9 then raise exception 'INVALID_INPUT';end if;
  amount:=jsonb_array_length(photos);
  select coalesce(array_agg((m->>'id')::uuid),array[]::uuid[]) into ids from jsonb_array_elements(photos) m;
  if amount<>(select count(distinct id) from unnest(ids) id) then raise exception 'INVALID_INPUT';end if;
  perform m.id from public.media_assets m where m.post_id=target or m.id=any(ids) order by m.id for update;
  if amount<>(select count(*) from public.media_assets m where m.id=any(ids) and m.owner_id=owner
    and m.trip_id is null and m.report_id is null and m.message_id is null
    and (m.post_id is null or m.post_id=target)) then raise exception 'FORBIDDEN';end if;
  update public.media_assets set post_id=null,is_staged=false,sort_order=0
    where post_id=target and (not staging or is_staged) and not(id=any(ids));
  update public.media_assets m set post_id=target,
    is_staged=staging and (m.post_id is null or m.is_staged),
    sort_order=case when staging and m.post_id=target and not m.is_staged then m.sort_order else (x.n-1)::integer end
    from unnest(ids) with ordinality x(id,n) where m.id=x.id;
end $$;

create function fishing_private.clear_content_update(kind text,target uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  delete from fishing_private.content_updates where target_type=kind and target_id=target;
  if kind='post' then
    perform m.id from public.media_assets m where m.post_id=target and m.is_staged order by m.id for update;
    update public.media_assets set post_id=null,is_staged=false,sort_order=0 where post_id=target and is_staged;
  end if;
end $$;

-- Called only from owner withdrawal or an authenticated, version-checked reviewer decision.
create function fishing_private.install_content_update(kind text,target uuid,fields jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare owner uuid; scope text;
begin
  if kind='post' then select author_id,audience into owner,scope from public.posts where id=target and status<>'deleted';
  elsif kind='spot' then select author_id,audience into owner,scope from public.fishing_spots where id=target and status<>'deleted';
  else raise exception 'INVALID_INPUT';end if;
  if owner is null or auth.uid() is null then raise exception 'NOT_FOUND';end if;
  if owner<>auth.uid() and (scope='private' or not fishing_private.is_moderator()) then raise exception 'FORBIDDEN';end if;
  -- Bind/promote photos before a private transition clears any remaining staged assets.
  if kind='post' then
    perform fishing_private.content_update_media(target,fields->'media',false);
    update public.posts set title=fields->>'title',body=fields->>'body',kind=fields->>'kind',
      species=fields->>'species',method=fields->>'method',bait=fields->>'bait',weight_kg=(fields->>'weight_kg')::numeric,
      occurred_on=(fields->>'occurred_on')::date,location_label=fields->>'location_label',
      audience=fields->>'audience',status='published' where id=target;
  else
    update public.fishing_spots set name=fields->>'name',city=fields->>'city',water_type=fields->>'water_type',
      species=fields->>'species',description=fields->>'description',fee_note=fields->>'fee_note',
      observed_on=(fields->>'observed_on')::date,audience=fields->>'audience',precision=fields->>'precision',status='published' where id=target;
    if fields->>'longitude' is null then delete from public.spot_locations where spot_id=target;
    else
      insert into public.spot_locations(spot_id,longitude,latitude,access_note)
        values(target,(fields->>'longitude')::double precision,(fields->>'latitude')::double precision,fields->>'access_note')
        on conflict(spot_id) do update set longitude=excluded.longitude,latitude=excluded.latitude,access_note=excluded.access_note;
    end if;
  end if;
  perform fishing_private.clear_content_update(kind,target);
end $$;

-- Runs after the existing owner/parent lock/revision check, before its ordinary edit branch.
create function fishing_private.handle_content_update(command text,payload jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare kind text:=payload->>'type'; target uuid:=(payload->>'id')::uuid; owner uuid;
  current_status text; scope text; precision_value text; fields jsonb; proposal fishing_private.content_updates;
begin
  if kind='trip' then return false;end if;
  if kind='post' then select author_id,status,audience into owner,current_status,scope from public.posts where id=target;
  elsif kind='spot' then select author_id,status,audience,precision into owner,current_status,scope,precision_value from public.fishing_spots where id=target;
  else raise exception 'INVALID_INPUT';end if;
  if owner is distinct from auth.uid() or owner is null or current_status='deleted' then raise exception 'NOT_FOUND';end if;
  select * into proposal from fishing_private.content_updates where target_type=kind and target_id=target for update;
  if command='discard_content_update' then
    if proposal.target_id is null then raise exception 'EDIT_CONFLICT';end if;
    perform fishing_private.clear_content_update(kind,target);
    if kind='post' then update public.posts set audience=audience where id=target;
    else update public.fishing_spots set audience=audience where id=target;end if;
    return true;
  elsif command='withdraw_content' and proposal.target_id is not null then
    perform fishing_private.install_content_update(kind,target,proposal.fields||jsonb_build_object('audience','private'));
    return true;
  elsif command='update_content' and current_status='published' and scope<>'private' and coalesce(payload->>'audience','private')<>'private' then
    fields:=fishing_private.content_update_fields(kind,payload);
    if kind='post' then perform fishing_private.content_update_media(target,fields->'media',true);end if;
    insert into fishing_private.content_updates(target_type,target_id,owner_id,fields)
      values(kind,target,owner,fields) on conflict(target_type,target_id) do update set
        fields=excluded.fields,status='pending',reason='',submitted_at=clock_timestamp();
    if kind='post' then
      update public.posts set audience=case when scope='public' and fields->>'audience'='friends' then 'friends' else scope end where id=target;
    else
      update public.fishing_spots set audience=case when scope='public' and fields->>'audience'='friends' then 'friends' else scope end,
        precision=case when fields->>'precision'='hidden' then 'hidden'
          when precision_value='exact' and fields->>'precision'='area' then 'area' else precision_value end where id=target;
    end if;
    return true;
  end if;
  -- Initial/private/hidden/rejected content still follows the ordinary existing workflow.
  -- Detaching staged assets is safe: the same owner may reattach selected IDs in this transaction.
  perform fishing_private.clear_content_update(kind,target);
  return false;
end $$;

create function fishing_private.content_update_lifecycle() returns trigger
language plpgsql security invoker set search_path='' as $$
declare kind text:=case when tg_table_name='posts' then 'post' else 'spot' end;
begin
  if new.status='deleted' or new.audience='private' then
    perform fishing_private.clear_content_update(kind,new.id);
  elsif new.status='hidden' and old.status is distinct from new.status then
    update fishing_private.content_updates set status='rejected',reason='当前内容已被隐藏，请修正后重新提交。'
      where target_type=kind and target_id=new.id;
  end if;
  return new;
end $$;
create trigger posts_content_update_lifecycle after update of status,audience on public.posts
  for each row execute function fishing_private.content_update_lifecycle();
create trigger spots_content_update_lifecycle after update of status,audience on public.fishing_spots
  for each row execute function fishing_private.content_update_lifecycle();

create function fishing_private.content_update_info(kind text,target uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('status',u.status,'reason',u.reason,'submitted_at',u.submitted_at)
    from fishing_private.content_updates u where u.target_type=kind and u.target_id=target and u.owner_id=(select auth.uid());
$$;
create function fishing_private.content_update_photos(target uuid,fields jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'path',m.path,'width',m.width,'height',m.height) order by x.n),'[]'::jsonb)
    from jsonb_array_elements(fields->'media') with ordinality x(photo,n)
    join public.media_assets m on m.id=(x.photo->>'id')::uuid and m.post_id=target;
$$;

create function fishing_private.content_update_review(kind text,target uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare current_item jsonb; proposal fishing_private.content_updates; fields jsonb; item jsonb;
begin
  if not fishing_private.is_moderator() then raise exception 'FORBIDDEN';end if;
  current_item:=fishing_private.review_item(kind,target);
  select * into proposal from fishing_private.content_updates where target_type=kind and target_id=target;
  if proposal.target_id is null or current_item->>'status'<>'published' or proposal.status<>'pending' then raise exception 'NOT_FOUND';end if;
  fields:=proposal.fields;
  item:=current_item||jsonb_build_object('is_update',true,'status','pending','created_at',proposal.submitted_at,
    'audience',fields->>'audience','current',current_item);
  if kind='post' then
    item:=item||jsonb_build_object('title',fishing_private.post_caption(jsonb_populate_record(null::public.posts,fields)),
      'body',fields->>'body','media',fishing_private.content_update_photos(target,fields),
      'details',jsonb_build_object('鱼种',fields->>'species','钓法',fields->>'method','饵料',fields->>'bait',
        '日期',fields->>'occurred_on','地点描述',fields->>'location_label'));
  else
    -- Explicit whitelist: reviewers NEVER receive proposal coordinates or private access notes.
    item:=item||jsonb_build_object('title',fields->>'name','body',fields->>'description','media','[]'::jsonb,
      'details',jsonb_build_object('城市',fields->>'city','水域',fields->>'water_type','鱼种',fields->>'species',
        '费用说明',fields->>'fee_note','核实日期',fields->>'observed_on'));
  end if;
  return item;
end $$;

create function fishing_private.content_update_decide(payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); kind text:=payload->>'type'; target uuid:=(payload->>'id')::uuid;
  review_request_id uuid:=(payload->>'request_id')::uuid; expected integer:=(payload->>'revision')::integer;
  decision text:=payload->>'decision'; review_reason text:=btrim(coalesce(payload->>'reason',''));
  owner uuid; current_status text; scope text; revision integer; prior fishing_private.moderation_actions;
  proposal fishing_private.content_updates;
begin
  if uid is null or not fishing_private.is_moderator() then raise exception 'FORBIDDEN';end if;
  if kind is null or kind not in ('post','spot') or target is null or review_request_id is null or expected is null or expected<1
    or decision is null or decision not in ('published','rejected') or length(review_reason) not between 1 and 500 then raise exception 'INVALID_INPUT';end if;
  perform pg_advisory_xact_lock(hashtextextended('fishing-user:'||uid::text,0));
  select * into prior from fishing_private.moderation_actions a where a.moderator_id=uid and a.request_id=review_request_id;
  if found then
    if not prior.is_content_update or prior.target_id<>target or prior.target_type<>kind or prior.decision<>decision
      or prior.reason<>review_reason or prior.content_revision<>expected then raise exception 'REVIEW_CONFLICT';end if;
    return jsonb_build_object('status',prior.decision,'revision',prior.content_revision+1,'is_update',true);
  end if;
  if (select count(*) from fishing_private.rate_events where user_id=uid and created_at>now()-interval '1 minute')>=90 then raise exception 'RATE_LIMIT';end if;
  if kind='post' then select author_id,status,audience,review_revision into owner,current_status,scope,revision from public.posts where id=target for update;
  else select author_id,status,audience,review_revision into owner,current_status,scope,revision from public.fishing_spots where id=target for update;end if;
  if owner is null or current_status='deleted' or scope='private' then raise exception 'NOT_FOUND';end if;
  if owner=uid then raise exception 'SELF_REVIEW';end if;
  if revision<>expected then raise exception 'REVIEW_CONFLICT';end if;
  select * into proposal from fishing_private.content_updates where target_type=kind and target_id=target for update;
  if current_status<>'published' or proposal.target_id is null or proposal.status<>'pending' then raise exception 'INVALID_TRANSITION';end if;
  if decision='published' then perform fishing_private.install_content_update(kind,target,proposal.fields);
  else
    update fishing_private.content_updates set status='rejected',reason=review_reason where target_type=kind and target_id=target;
    if kind='post' then update public.posts set audience=audience where id=target;
    else update public.fishing_spots set audience=audience where id=target;end if;
  end if;
  insert into fishing_private.moderation_actions(moderator_id,target_type,target_id,decision,reason,request_id,previous_status,content_revision,is_content_update)
    values(uid,kind,target,decision,review_reason,review_request_id,'pending',revision,true);
  insert into fishing_private.rate_events(user_id,action) values(uid,'moderate');
  delete from fishing_private.rate_events where user_id=uid and created_at<now()-interval '1 day';
  return jsonb_build_object('status',decision,'revision',revision+1,'is_update',true);
end $$;

create function fishing_private.content_review_queue(payload jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare cursor_time timestamptz; cursor_id uuid; cursor_type text; items jsonb; next_cursor jsonb;
begin
  if not fishing_private.is_moderator() then raise exception 'FORBIDDEN';end if;
  if coalesce(payload->>'cursor','null')<>'null' then
    cursor_time:=(payload->'cursor'->>'created_at')::timestamptz;cursor_id:=(payload->'cursor'->>'id')::uuid;cursor_type:=payload->'cursor'->>'type';
    if cursor_time is null or cursor_id is null or cursor_type is null or cursor_type not in ('post','spot') then raise exception 'INVALID_INPUT';end if;
  end if;
  with candidates as (
    select p.id,'post'::text kind,fishing_private.post_caption(p) title,p.author_id,p.created_at,p.audience,false is_update
      from public.posts p where p.status='pending' and p.audience<>'private'
    union all select s.id,'spot',s.name,s.author_id,s.created_at,s.audience,false from public.fishing_spots s where s.status='pending' and s.audience<>'private'
    union all select u.target_id,u.target_type,
      case when u.target_type='post' then fishing_private.post_caption(jsonb_populate_record(null::public.posts,u.fields)) else u.fields->>'name' end,
      u.owner_id,u.submitted_at,u.fields->>'audience',true
      from fishing_private.content_updates u
      left join public.posts p on p.id=u.post_id left join public.fishing_spots s on s.id=u.spot_id
      where u.status='pending' and coalesce(p.status,s.status)='published' and coalesce(p.audience,s.audience)<>'private'
  ), page as (
    select * from candidates c where cursor_time is null or (c.created_at,c.id,c.kind)>(cursor_time,cursor_id,cursor_type)
      order by c.created_at,c.id,c.kind limit 13
  ), numbered as(select c.*,row_number() over(order by c.created_at,c.id,c.kind) n from page c)
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'type',c.kind,'title',c.title,'author',fishing_private.profile_json(c.author_id),
    'audience',c.audience,'created_at',c.created_at,'is_update',c.is_update) order by c.n) filter(where c.n<=12),'[]'::jsonb),
    case when count(*)>12 then (jsonb_agg(jsonb_build_object('id',c.id,'type',c.kind,'created_at',c.created_at)) filter(where c.n=12))->0 end
    into items,next_cursor from numbered c;
  return jsonb_build_object('items',items,'next',next_cursor);
end $$;

-- Guarded patches retain existing Auth, rate limits, log/comment flows and receipt semantics.
do $migration$
declare source text; needle text; replacement text; fn regprocedure; kind text;
begin
  source:=pg_get_functiondef('fishing_private.author_write(text,jsonb)'::regprocedure);
  needle:='''save_spot'', ''update_content'', ''withdraw_content''';
  if position(needle in source)=0 then raise exception 'author commands changed';end if;
  source:=replace(source,needle,needle||', ''discard_content_update''');
  needle:='    if command = ''withdraw_content'' then';
  if position(needle in source)=0 then raise exception 'author version branch changed';end if;
  replacement:=$patch$    if command='discard_content_update' and content_type='trip' then raise exception 'INVALID_INPUT';end if;
    if fishing_private.handle_content_update(command,payload) then
      version:=(fishing_private.author_read(content_type,target)->>'revision')::integer;
      result:=jsonb_build_object('id',target,'type',content_type,'revision',version,'request_id',request_uuid);
      insert into fishing_private.author_write_receipts(user_id,request_id,signature,result) values(uid,request_uuid,signature,result);
      return result;
    end if;
$patch$;
  execute replace(source,needle,replacement||needle);
  source:=pg_get_functiondef('fishing_private.write_api(text,jsonb)'::regprocedure);
  needle:='when ''save_spot'', ''update_content'', ''withdraw_content'' then';
  if position(needle in source)=0 then raise exception 'author dispatch changed';end if;
  execute replace(source,needle,'when ''save_spot'', ''update_content'', ''withdraw_content'', ''discard_content_update'' then');

  source:=pg_get_functiondef('fishing_private.can_view_media(uuid)'::regprocedure);
  needle:='m.post_id is not null and fishing_private.can_view_post(m.post_id)';
  if position(needle in source)=0 then raise exception 'media permission branch changed';end if;
  execute replace(source,needle,'m.post_id is not null and not m.is_staged and fishing_private.can_view_post(m.post_id)');
  foreach fn in array array['fishing_private.post_json(uuid)'::regprocedure,'fishing_private.review_item(text,uuid)'::regprocedure] loop
    source:=pg_get_functiondef(fn);needle:='where m.post_id=p.id)';
    if position(needle in source)=0 then raise exception 'media projection changed: %',fn;end if;
    execute replace(source,needle,'where m.post_id=p.id and not m.is_staged)');
  end loop;
  foreach kind in array array['post','spot'] loop
    fn:=('fishing_private.'||kind||'_json(uuid)')::regprocedure;source:=pg_get_functiondef(fn);
    needle:='jsonb_build_object(''author'',fishing_private.profile_json(';
    if position(needle in source)=0 then raise exception 'owner projection changed';end if;
    replacement:='jsonb_build_object(''content_update'',fishing_private.content_update_info('||quote_literal(kind)||',target),''author'',fishing_private.profile_json(';
    execute replace(source,needle,replacement);
  end loop;
  source:=pg_get_functiondef('fishing_private.author_read(text,uuid)'::regprocedure);
  needle:='  return jsonb_build_object(''item'', item, ''revision'', version);';
  if position(needle in source)=0 then raise exception 'author snapshot changed';end if;
  replacement:=$patch$  return jsonb_build_object('item',item||coalesce((select u.fields||
      case when content_type='post' then jsonb_build_object('media',fishing_private.content_update_photos(target,u.fields)) else '{}'::jsonb end
      from fishing_private.content_updates u where u.target_type=content_type and u.target_id=target and u.owner_id=uid),'{}'::jsonb),
    'revision',version,'publication',jsonb_build_object('status',item->>'status','audience',item->>'audience','precision',item->>'precision'));$patch$;
  execute replace(source,needle,replacement);

  source:=pg_get_functiondef('fishing_private.moderation_api(text,jsonb)'::regprocedure);
  needle:=substring(source from '  if action=''queue'' then[\s\S]*?(?=  elsif action=''item'')');
  if needle is null then raise exception 'moderation queue changed';end if;
  source:=replace(source,needle,$patch$  if action='queue' then return fishing_private.content_review_queue(payload);
  elsif action='proposal_item' then return fishing_private.content_update_review(kind,target);
  elsif action='proposal_decide' then return fishing_private.content_update_decide(payload);
$patch$);
  needle:='if prior.target_id<>target or';
  if position(needle in source)=0 then raise exception 'moderation receipt changed';end if;
  source:=replace(source,needle,'if prior.is_content_update or prior.target_id<>target or');
  needle:='and a.decision=current_status order by';
  if position(needle in source)=0 then raise exception 'owner review reason changed';end if;
  execute replace(source,needle,'and not a.is_content_update and a.decision=current_status order by');
  source:=pg_get_functiondef('fishing_private.notification_json(fishing_private.notifications)'::regprocedure);
  needle:='label:=case object_kind when ''post'' then ''动态'' when ''spot'' then ''钓位'' else ''评论'' end||';
  if position(needle in source)=0 then raise exception 'review notification label changed';end if;
  execute replace(source,needle,needle||'case when exists(select 1 from fishing_private.moderation_actions a where a.id=n.review_id and a.is_content_update) then ''修改'' else '''' end||');
end $migration$;

revoke all on function fishing_private.content_update_fields(text,jsonb),fishing_private.content_update_media(uuid,jsonb,boolean),
  fishing_private.clear_content_update(text,uuid),fishing_private.install_content_update(text,uuid,jsonb),
  fishing_private.handle_content_update(text,jsonb),fishing_private.content_update_lifecycle(),fishing_private.content_update_info(text,uuid),
  fishing_private.content_update_photos(uuid,jsonb),fishing_private.content_update_review(text,uuid),
  fishing_private.content_update_decide(jsonb),fishing_private.content_review_queue(jsonb) from public,anon,authenticated,service_role;
