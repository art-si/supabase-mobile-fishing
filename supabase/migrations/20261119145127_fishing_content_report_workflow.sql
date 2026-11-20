-- Community reports only. No access to water-report evidence, chat, or private locations.
alter table public.content_reports
  add column target_label text not null default '',
  add column submitted_revision integer,
  add column revision integer not null default 1 check(revision>0),
  add column resolution text not null default '',
  add column resolved_at timestamptz,
  add constraint content_report_status check(status in ('pending','actioned','dismissed','unavailable')),
  add constraint content_report_resolution check(
    (status='pending' and resolved_at is null and resolution='') or
    (status<>'pending' and resolved_at is not null and length(btrim(resolution)) between 1 and 500));
create index content_reports_owner_page_idx on public.content_reports(reporter_id,created_at desc,id desc);
create index content_reports_pending_page_idx on public.content_reports(created_at,id) where status='pending';
create index content_reports_closed_page_idx on public.content_reports(resolved_at desc,id desc) where status<>'pending';
create table fishing_private.content_report_actions (
  id bigint generated always as identity primary key,
  report_id uuid not null unique,
  moderator_id uuid not null,
  request_id uuid not null,
  report_revision integer not null,
  content_revision integer not null,
  decision text not null check(decision in ('hide','dismiss','unavailable')),
  reason text not null check(length(btrim(reason)) between 1 and 500),
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique(moderator_id,request_id)
);
alter table fishing_private.content_report_actions enable row level security;
revoke all on fishing_private.content_report_actions from public,anon,authenticated;

-- Internal projection: never returns reporter identity or private target data.
create function fishing_private.content_report_json(r public.content_reports) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',r.id,'type',r.target_type,'title',r.target_label,'reason',r.reason,
    'status',r.status,'revision',r.revision,'created_at',r.created_at,
    'resolution',r.resolution,'resolved_at',r.resolved_at);
$$;
create function fishing_private.report_target(kind text,target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not fishing_private.is_moderator() then raise exception 'FORBIDDEN';end if;
  if kind in ('post','spot') then
    begin result:=fishing_private.review_item(kind,target);
    exception when raise_exception then
      if sqlerrm='NOT_FOUND' then return null;else raise;end if;
    end;
  elsif kind='profile' then
    select jsonb_build_object('id',p.id,'type','profile','title',p.nickname,'body',p.bio,
      'author',fishing_private.profile_json(p.id),'revision',0,'status','published','media','[]'::jsonb,
      'details','{}'::jsonb) into result from public.profiles p where p.id=target;
  else raise exception 'INVALID_INPUT';end if;
  return result;
end $$;
create function fishing_private.content_reports_api(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); target uuid; kind text; label text; owner_id uuid; target_revision integer;
  report public.content_reports; existing fishing_private.content_report_actions; content jsonb;
  items jsonb; next_cursor jsonb; row_json jsonb; result jsonb;
  cursor_time timestamptz; cursor_id uuid; section text;
  v_request_id uuid; expected integer; expected_content integer; decision text; v_reason text;
begin
  if uid is null or not exists(select 1 from public.profiles where id=uid) then raise exception 'NOT_AUTHENTICATED';end if;
  if payload is null or jsonb_typeof(payload)<>'object' then raise exception 'INVALID_INPUT';end if;
  if action='submit' then
    target:=nullif(payload->>'id','')::uuid; kind:=payload->>'type'; v_reason:=btrim(coalesce(payload->>'reason',''));
    if target is null or kind is null or kind not in ('post','spot','profile') or length(v_reason) not between 1 and 500 then raise exception 'INVALID_INPUT';end if;
    perform pg_advisory_xact_lock(hashtextextended('fishing-user:'||uid::text,0));
    -- A lost response can be retried after another reviewer has hidden the target.
    select * into report from public.content_reports r where r.reporter_id=uid and r.target_type=kind and r.target_id=target;
    if found then return jsonb_build_object('id',report.id,'status',report.status,'duplicate',true);end if;
    if kind='post' then
      select p.title,p.author_id,p.review_revision into label,owner_id,target_revision from public.posts p
        where p.id=target and p.status='published' and p.audience<>'private' and fishing_private.can_view_post(p.id);
    elsif kind='spot' then
      select s.name,s.author_id,s.review_revision into label,owner_id,target_revision from public.fishing_spots s
        where s.id=target and s.status='published' and s.audience<>'private' and fishing_private.can_view_spot(s.id);
    else
      select p.nickname,p.id,0 into label,owner_id,target_revision from public.profiles p where p.id=target and not fishing_private.is_blocked(uid,p.id);
    end if;
    if owner_id is null then raise exception 'NOT_FOUND';end if;
    if owner_id=uid then raise exception 'INVALID_INPUT';end if;
    if (select count(*) from public.content_reports r where r.reporter_id=uid and r.created_at>now()-interval '1 day')>=20 then raise exception 'RATE_LIMIT';end if;
    insert into public.content_reports(reporter_id,target_type,target_id,target_label,submitted_revision,reason)
      values(uid,kind,target,left(label,180),target_revision,v_reason) returning * into report;
    return jsonb_build_object('id',report.id,'status',report.status,'duplicate',false);
  end if;
  if action not in ('mine','queue','item','decide') or action is null then raise exception 'INVALID_INPUT';end if;
  if action<>'mine' and not fishing_private.is_moderator() then raise exception 'FORBIDDEN';end if;
  if action in ('mine','queue') then
    section:=coalesce(payload->>'section','pending');
    if section not in ('pending','closed') then raise exception 'INVALID_INPUT';end if;
    if coalesce(payload->>'cursor','null')<>'null' then
      cursor_time:=(payload->'cursor'->>'time')::timestamptz; cursor_id:=(payload->'cursor'->>'id')::uuid;
      if cursor_time is null or not isfinite(cursor_time) or cursor_id is null then raise exception 'INVALID_INPUT';end if;
    end if;
    items:='[]'::jsonb; next_cursor:=null;
    for report in
      select r.* from public.content_reports r where
        ((action='mine' and r.reporter_id=uid) or
         (action='queue' and ((section='pending' and r.status='pending') or (section='closed' and r.status<>'pending'))))
        and (cursor_time is null or
          (action='queue' and section='pending' and (r.created_at,r.id)>(cursor_time,cursor_id)) or
          (action='queue' and section='closed' and (r.resolved_at,r.id)<(cursor_time,cursor_id)) or
          (action='mine' and (r.created_at,r.id)<(cursor_time,cursor_id)))
      order by
        case when action='queue' and section='pending' then r.created_at end asc,
        case when action='queue' and section='pending' then r.id end asc,
        case when action='queue' and section='closed' then r.resolved_at else r.created_at end desc,r.id desc limit 13
    loop
      if jsonb_array_length(items)=12 then exit;end if;
      row_json:=fishing_private.content_report_json(report);
      if action='queue' then
        -- A withdrawn title is not retained for reviewers. The reporter sees only their original snapshot.
        if report.target_type='post' then select p.title into label from public.posts p where p.id=report.target_id and p.status<>'deleted' and p.audience<>'private';
        elsif report.target_type='spot' then select s.name into label from public.fishing_spots s where s.id=report.target_id and s.status<>'deleted' and s.audience<>'private';
        else select p.nickname into label from public.profiles p where p.id=report.target_id;end if;
        row_json:=row_json||jsonb_build_object('title',coalesce(label,'内容已不可用'));
      end if;
      items:=items||jsonb_build_array(row_json);
      next_cursor:=jsonb_build_object('id',report.id,'time',case when action='queue' and section='closed' then report.resolved_at else report.created_at end);
    end loop;
    -- The 13th loop row is present only when another page exists.
    if jsonb_array_length(items)<12 or report.id=(items->11->>'id')::uuid then next_cursor:=null;end if;
    return jsonb_build_object('items',items,'next',next_cursor);
  end if;
  target:=nullif(payload->>'id','')::uuid;
  if target is null then raise exception 'INVALID_INPUT';end if;
  if action='decide' then
    v_request_id:=nullif(payload->>'request_id','')::uuid;
    expected:=(payload->>'revision')::integer; expected_content:=(payload->>'content_revision')::integer;
    decision:=payload->>'decision'; v_reason:=btrim(coalesce(payload->>'reason',''));
    if v_request_id is null or expected is null or expected<1 or expected_content is null or expected_content<0
      or decision is null or decision not in ('hide','dismiss','unavailable') or length(v_reason) not between 1 and 500 then raise exception 'INVALID_INPUT';end if;
    perform pg_advisory_xact_lock(hashtextextended('fishing-user:'||uid::text,0));
    select * into existing from fishing_private.content_report_actions a where a.moderator_id=uid and a.request_id=v_request_id;
    if found then
      if existing.report_id<>target or existing.report_revision<>expected or existing.content_revision<>expected_content
        or existing.decision<>decision or existing.reason<>v_reason then raise exception 'REVIEW_CONFLICT';end if;
      select * into report from public.content_reports r where r.id=target;
      if report.id is null then raise exception 'NOT_FOUND';end if;
      content:=fishing_private.report_target(report.target_type,report.target_id);
      return fishing_private.content_report_json(report)||existing.result||jsonb_build_object('title',coalesce(content->>'title','内容已不可用'));
    end if;
    select * into report from public.content_reports r where r.id=target for update;
  else select * into report from public.content_reports r where r.id=target;end if;
  if report.id is null then raise exception 'NOT_FOUND';end if;
  -- Lock the target before evaluating its latest visibility/revision; never restore deleted data.
  if report.target_type='post' then
    select p.author_id into owner_id from public.posts p where p.id=report.target_id for update;
  elsif report.target_type='spot' then
    select s.author_id into owner_id from public.fishing_spots s where s.id=report.target_id for update;
  else select p.id into owner_id from public.profiles p where p.id=report.target_id for update;end if;
  content:=fishing_private.report_target(report.target_type,report.target_id);
  target_revision:=coalesce((content->>'revision')::integer,0);
  if action='item' then
    return jsonb_build_object('report',fishing_private.content_report_json(report)||jsonb_build_object('title',coalesce(content->>'title','内容已不可用')),
      'content',content,'content_revision',target_revision,
      'changed',content is not null and report.submitted_revision is not null and report.submitted_revision<>target_revision,
      'needs_other_reviewer',uid=report.reporter_id or coalesce(uid=owner_id,false),
      'can_hide',coalesce(content->>'status'='published' and report.target_type in ('post','spot'),false));
  end if;
  if uid=report.reporter_id or uid=owner_id then raise exception 'SELF_REPORT_REVIEW';end if;
  if report.status<>'pending' or report.revision<>expected or target_revision<>expected_content then raise exception 'REVIEW_CONFLICT';end if;
  if (select count(*) from fishing_private.rate_events where user_id=uid and created_at>now()-interval '1 minute')>=90 then raise exception 'RATE_LIMIT';end if;
  if decision='hide' then
    if content is null or content->>'status'<>'published' or report.target_type not in ('post','spot') then raise exception 'INVALID_TRANSITION';end if;
    perform fishing_private.moderation_api('decide',jsonb_build_object('id',report.target_id,'type',report.target_type,
      'revision',target_revision,'decision','hidden','reason',v_reason,'request_id',v_request_id));
  elsif decision='unavailable' then
    if content is not null and content->>'status'='published' then raise exception 'INVALID_TRANSITION';end if;
  elsif content is null or content->>'status'<>'published' then raise exception 'INVALID_TRANSITION';
  end if;
  update public.content_reports r set status=case decision when 'hide' then 'actioned' when 'dismiss' then 'dismissed' else 'unavailable' end,
    resolution=v_reason,resolved_at=now(),revision=r.revision+1 where r.id=target returning * into report;
  result:=fishing_private.content_report_json(report)||jsonb_build_object('title',coalesce(content->>'title','内容已不可用'));
  insert into fishing_private.content_report_actions(report_id,moderator_id,request_id,report_revision,content_revision,decision,reason,result)
    values(target,uid,v_request_id,expected,expected_content,decision,v_reason,result-'reason'-'title'-'created_at');
  if decision<>'hide' then insert into fishing_private.rate_events(user_id,action) values(uid,'report_decide');end if;
  return result;
end $$;
create function public.fishing_reports(action text,payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$select fishing_private.content_reports_api(action,payload);$$;
revoke all on function fishing_private.content_report_json(public.content_reports),fishing_private.report_target(text,uuid),fishing_private.content_reports_api(text,jsonb),public.fishing_reports(text,jsonb) from public,anon,authenticated;
grant execute on function fishing_private.content_reports_api(text,jsonb),public.fishing_reports(text,jsonb) to authenticated;

-- Existing clients use the same validation and deduplication path.
do $migration$
declare definition text; before_block text;
begin
  select pg_get_functiondef('fishing_private.write_api(text,jsonb)'::regprocedure) into definition;
  before_block:=substring(definition from '  when ''report'' then[\s\S]*?(?=  when ''delete_content'' then)');
  if before_block is null then raise exception 'Unexpected report command; inspect before migrating';end if;
  execute replace(definition,before_block,E'  when ''report'' then\n    return fishing_private.content_reports_api(''submit'',payload);\n');
end $migration$;
