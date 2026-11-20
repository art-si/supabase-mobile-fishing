-- Fish posts are published by their author. Spots and water-boundary reports retain
-- their existing review workflows; ownership, revision and idempotency stay in RPCs.
do $migration$
declare source text; old_block text; new_block text; needle text;
begin
  source:=pg_get_functiondef('fishing_private.write_api(text,jsonb)'::regprocedure);
  old_block:=substring(source from '  when ''save_post'' then[\s\S]*?(?=  when '')');
  if old_block is null then raise exception 'save_post dispatch changed';end if;
  needle:='case when scope=''private'' then ''published'' else ''pending'' end';
  if position(needle in old_block)=0 then raise exception 'save_post status changed';end if;
  new_block:=replace(old_block,needle,'''published''');
  execute replace(source,old_block,new_block);

  -- This helper is invoked only after author_write locks the parent, verifies its
  -- owner/revision and resolves request receipts. Existing field/media validators
  -- and the single atomic install continue to be authoritative.
  source:=pg_get_functiondef('fishing_private.handle_content_update(text,jsonb)'::regprocedure);
  needle:='  select * into proposal from fishing_private.content_updates';
  if position(needle in source)=0 then raise exception 'content update branch changed';end if;
  new_block:=$patch$  if kind='post' and command='update_content' then
    fields:=fishing_private.content_update_fields(kind,payload);
    perform fishing_private.install_content_update(kind,target,fields);
    return true;
  end if;
$patch$;
  execute replace(source,needle,new_block||needle);
end $migration$;

alter table public.posts alter column status set default 'published';

-- Honour an author's already submitted replacement when its base is still live.
-- Set the transaction-local identity only for the existing owner-checked helper,
-- then restore it. Rejected/hidden/deleted publications are never restored here.
do $migration$
declare proposal record; previous_uid text:=current_setting('request.jwt.claim.sub',true);
begin
  for proposal in
    select u.target_id,u.owner_id,u.fields from fishing_private.content_updates u
      join public.posts p on p.id=u.target_id and p.author_id=u.owner_id
      where u.target_type='post' and u.status='pending' and p.status='published'
      order by u.target_id
  loop
    perform set_config('request.jwt.claim.sub',proposal.owner_id::text,true);
    perform fishing_private.install_content_update('post',proposal.target_id,proposal.fields);
  end loop;
  perform set_config('request.jwt.claim.sub',coalesce(previous_uid,''),true);
end $migration$;

-- Pending initial submissions no longer need approval. A previously rejected or
-- hidden record remains owner-visible and can be corrected and published by edit.
update public.posts set status='published' where status='pending';
