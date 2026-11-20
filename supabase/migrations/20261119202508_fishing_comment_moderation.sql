-- Comments use the existing community report/review queue. This creates no moderator.
-- Hidden text stays visible only to its author while the parent is still accessible;
-- quoted text is never shown while hidden. Deletion remains irreversible.
alter table public.comments
  add column status text not null default 'published' check(status in ('published','hidden')),
  add column review_revision integer not null default 1 check(review_revision>0);
create trigger comments_review_revision before update on public.comments
  for each row execute function fishing_private.bump_review_revision();
alter table public.content_reports drop constraint content_reports_target_type_check;
alter table public.content_reports add constraint content_reports_target_type_check
  check(target_type in ('post','spot','profile','comment'));
alter policy comments_read on public.comments using (
  deleted_at is null and (status='published' or author_id=(select auth.uid()))
  and fishing_private.can_view_post(post_id)
  and not fishing_private.is_blocked(author_id,(select auth.uid()))
);

create or replace function fishing_private.comment_json(target uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',c.id,'post_id',c.post_id,'status',c.status,
    'author',fishing_private.profile_json(c.author_id),'body',c.body,'created_at',c.created_at,
    'reply_to_id',c.reply_to_id,'reply_to',(
      select jsonb_build_object('id',r.id,'author',fishing_private.profile_json(r.author_id),
        'body',left(r.body,160)) from public.comments r
      where r.id=c.reply_to_id and r.post_id=c.post_id and r.deleted_at is null and r.status='published'
        and not fishing_private.is_blocked(r.author_id,(select auth.uid()))
    ))
  from public.comments c where c.id=target and c.deleted_at is null
    and (c.status='published' or c.author_id=(select auth.uid()))
    and fishing_private.can_view_post(c.post_id)
    and not fishing_private.is_blocked(c.author_id,(select auth.uid()));
$$;

-- Guard each replacement, retaining every unrelated endpoint, grant and abuse control.
do $migration$
declare source text; old_sql text;
begin
  source:=pg_get_functiondef('fishing_private.comments_page(uuid,text)'::regprocedure);
  old_sql:='c.deleted_at is null';
  if (length(source)-length(replace(source,old_sql,'')))<>2*length(old_sql) then
    raise exception 'comment page layout changed';end if;
  execute replace(source,old_sql,old_sql||' and (c.status=''published'' or c.author_id=(select auth.uid()))');

  source:=pg_get_functiondef('fishing_private.post_json(uuid)'::regprocedure);
  old_sql:='where c.post_id=p.id and c.deleted_at is null';
  if (length(source)-length(replace(source,old_sql,'')))<>length(old_sql) then
    raise exception 'post comment count layout changed';end if;
  execute replace(source,old_sql,old_sql||' and (c.status=''published'' or c.author_id=(select auth.uid()))');

  source:=pg_get_functiondef('fishing_private.comment_write(text,jsonb)'::regprocedure);
  old_sql:='quoted.deleted_at is not null';
  if strpos(source,old_sql)=0 then raise exception 'comment reply check layout changed';end if;
  execute replace(source,old_sql,old_sql||' or quoted.status<>''published''');

  source:=pg_get_functiondef('fishing_private.review_item(text,uuid)'::regprocedure);
  old_sql:='  else raise exception ''INVALID_INPUT''; end if;';
  if strpos(source,old_sql)=0 then raise exception 'review item layout changed';end if;
  execute replace(source,old_sql,$new$  elsif kind='comment' then
    select jsonb_build_object('id',c.id,'type','comment','title','评论','body',c.body,'status',c.status,
      'revision',c.review_revision,'audience',p.audience,'created_at',c.created_at,
      'author',fishing_private.profile_json(c.author_id),'media','[]'::jsonb,
      'details',jsonb_build_object('所在动态',p.title)) into result
    from public.comments c join public.posts p on p.id=c.post_id
    where c.id=target and c.deleted_at is null and p.status<>'deleted' and p.audience<>'private';
  else raise exception 'INVALID_INPUT'; end if;$new$);

  source:=pg_get_functiondef('fishing_private.moderation_api(text,jsonb)'::regprocedure);
  old_sql:='    else raise exception ''INVALID_INPUT'';end if;';
  if strpos(source,old_sql)=0 then raise exception 'review own status layout changed';end if;
  source:=replace(source,old_sql,$new$    elsif kind='comment' then
      select c.status,c.author_id into current_status,owner_id from public.comments c
        where c.id=target and c.deleted_at is null and fishing_private.can_view_post(c.post_id);
    else raise exception 'INVALID_INPUT';end if;$new$);
  old_sql:='kind not in (''post'',''spot'')';
  if strpos(source,old_sql)=0 then raise exception 'review kind layout changed';end if;
  source:=replace(source,old_sql,'kind not in (''post'',''spot'',''comment'')');
  old_sql:=$old$  else
    select s.author_id,s.status,s.review_revision,s.audience into owner_id,current_status,revision,audience from public.fishing_spots s where s.id=target for update;
  end if;$old$;
  if strpos(source,old_sql)=0 then raise exception 'review target lock layout changed';end if;
  source:=replace(source,old_sql,$new$  elsif kind='spot' then
    select s.author_id,s.status,s.review_revision,s.audience into owner_id,current_status,revision,audience from public.fishing_spots s where s.id=target for update;
  else
    -- Same ordering as comment create/delete: user lock -> parent post -> comment.
    perform 1 from public.posts p where p.id=(select c.post_id from public.comments c where c.id=target) for update;
    select c.author_id,c.status,c.review_revision,p.audience into owner_id,current_status,revision,audience
      from public.comments c join public.posts p on p.id=c.post_id
      where c.id=target and c.deleted_at is null and p.status<>'deleted' and p.audience<>'private'
      for update of c;
  end if;$new$);
  old_sql:='  else update public.fishing_spots set status=decision where id=target;end if;';
  if strpos(source,old_sql)=0 then raise exception 'review update layout changed';end if;
  execute replace(source,old_sql,$new$  elsif kind='spot' then update public.fishing_spots set status=decision where id=target;
  else update public.comments set status=decision where id=target;end if;$new$);

  source:=pg_get_functiondef('fishing_private.report_target(text,uuid)'::regprocedure);
  old_sql:='kind in (''post'',''spot'')';
  if strpos(source,old_sql)=0 then raise exception 'report target layout changed';end if;
  execute replace(source,old_sql,'kind in (''post'',''spot'',''comment'')');

  source:=pg_get_functiondef('fishing_private.content_reports_api(text,jsonb)'::regprocedure);
  old_sql:='kind not in (''post'',''spot'',''profile'')';
  if strpos(source,old_sql)=0 then raise exception 'report submit kind layout changed';end if;
  source:=replace(source,old_sql,'kind not in (''post'',''spot'',''profile'',''comment'')');
  old_sql:=$old$    else
      select p.nickname,p.id,0 into label,owner_id,target_revision from public.profiles p where p.id=target and not fishing_private.is_blocked(uid,p.id);$old$;
  if strpos(source,old_sql)=0 then raise exception 'report submit target layout changed';end if;
  source:=replace(source,old_sql,$new$    elsif kind='comment' then
      -- Keep a generic label, not a retained copy of the comment or its author.
      select '评论',c.author_id,c.review_revision into label,owner_id,target_revision
        from public.comments c join public.posts p on p.id=c.post_id
        where c.id=target and c.deleted_at is null and c.status='published'
          and p.status='published' and p.audience<>'private' and fishing_private.can_view_post(p.id)
          and not fishing_private.is_blocked(uid,c.author_id);
    else
      select p.nickname,p.id,0 into label,owner_id,target_revision from public.profiles p where p.id=target and not fishing_private.is_blocked(uid,p.id);$new$);
  old_sql:='        else select p.nickname into label from public.profiles p where p.id=report.target_id;end if;';
  if strpos(source,old_sql)=0 then raise exception 'report queue label layout changed';end if;
  source:=replace(source,old_sql,$new$        elsif report.target_type='comment' then
          select '评论' into label from public.comments c join public.posts p on p.id=c.post_id
            where c.id=report.target_id and c.deleted_at is null and p.status<>'deleted' and p.audience<>'private';
        else select p.nickname into label from public.profiles p where p.id=report.target_id;end if;$new$);
  old_sql:='  else select p.id into owner_id from public.profiles p where p.id=report.target_id for update;end if;';
  if strpos(source,old_sql)=0 then raise exception 'report target lock layout changed';end if;
  source:=replace(source,old_sql,$new$  elsif report.target_type='comment' then
    perform 1 from public.posts p where p.id=(select c.post_id from public.comments c where c.id=report.target_id) for update;
    select c.author_id into owner_id from public.comments c where c.id=report.target_id for update;
  else select p.id into owner_id from public.profiles p where p.id=report.target_id for update;end if;$new$);
  old_sql:='report.target_type in (''post'',''spot'')';
  if strpos(source,old_sql)=0 then raise exception 'report hide capability layout changed';end if;
  source:=replace(source,old_sql,'report.target_type in (''post'',''spot'',''comment'')');
  old_sql:='report.target_type not in (''post'',''spot'')';
  if strpos(source,old_sql)=0 then raise exception 'report hide transition layout changed';end if;
  execute replace(source,old_sql,'report.target_type not in (''post'',''spot'',''comment'')');
end $migration$;

-- Replacement preserves ACLs; be explicit for the internal projection as defense in depth.
revoke all on function fishing_private.comment_json(uuid) from public,anon,authenticated;
