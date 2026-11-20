-- Spot photographs follow the same effective/proposed version boundary as their parent.
alter table public.media_assets add column spot_id uuid references public.fishing_spots(id) on delete cascade;
create index media_assets_spot_idx on public.media_assets(spot_id) where spot_id is not null;
alter table public.media_assets drop constraint media_single_parent,
  add constraint media_single_parent check(num_nonnulls(post_id,trip_id,report_id,message_id,spot_id)<=1),
  drop constraint media_staged_parent,
  add constraint media_staged_parent check(not is_staged or post_id is not null or spot_id is not null),
  add constraint spot_media_image_only check(spot_id is null or kind='image');

create function fishing_private.spot_photos(target uuid,selection jsonb default null) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(fishing_private.asset_json(m) order by
    case when selection is null then m.sort_order else x.n::integer end,m.created_at,m.id),'[]'::jsonb)
  from public.media_assets m
  left join jsonb_array_elements(coalesce(selection,'[]')) with ordinality x(photo,n) on m.id=(x.photo->>'id')::uuid
  where m.spot_id=target and ((selection is null and not m.is_staged) or (selection is not null and x.n is not null));
$$;

create function fishing_private.set_spot_photos(target uuid,photos jsonb,staging boolean default false) returns void
language plpgsql security invoker set search_path='' as $$
declare owner uuid; scope text; ids uuid[]; amount integer;
begin
  select author_id,audience into owner,scope from public.fishing_spots where id=target and status<>'deleted' for update;
  if owner is null or auth.uid() is null then raise exception 'NOT_FOUND';end if;
  if owner<>auth.uid() and (staging or scope='private' or not fishing_private.is_moderator()) then raise exception 'FORBIDDEN';end if;
  if jsonb_typeof(photos) is distinct from 'array' then raise exception 'INVALID_INPUT';end if;
  amount:=jsonb_array_length(photos);
  if amount>9 then raise exception 'INVALID_INPUT';end if;
  select coalesce(array_agg((m->>'id')::uuid),array[]::uuid[]) into ids from jsonb_array_elements(photos) m;
  if amount<>(select count(distinct id) from unnest(ids) id) then raise exception 'INVALID_INPUT';end if;
  perform m.id from public.media_assets m where m.spot_id=target or m.id=any(ids) order by m.id for update;
  if amount<>(select count(*) from public.media_assets m where m.id=any(ids) and m.owner_id=owner and m.kind='image'
    and m.post_id is null and m.trip_id is null and m.report_id is null and m.message_id is null
    and (m.spot_id is null or m.spot_id=target)) then raise exception 'FORBIDDEN';end if;
  update public.media_assets set spot_id=null,is_staged=false,sort_order=0
    where spot_id=target and (not staging or is_staged) and not(id=any(ids));
  update public.media_assets m set spot_id=target,is_staged=staging and (m.spot_id is null or m.is_staged),
    sort_order=case when staging and m.spot_id=target and not m.is_staged then m.sort_order else (x.n-1)::integer end
    from unnest(ids) with ordinality x(id,n) where m.id=x.id;
end $$;

-- Soft deletion removes indexes in the same transaction; the existing private queue deletes Storage objects.
create function fishing_private.delete_spot_photos() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.status='deleted' and old.status is distinct from new.status then
    delete from public.media_assets where spot_id=new.id;
  end if;
  return new;
end $$;
create trigger spots_cleanup_photos after update of status on public.fishing_spots
  for each row execute function fishing_private.delete_spot_photos();

-- Exact anchors preserve deployed Auth, receipts, moderation, and all other media kinds.
do $migration$
declare patch record; source text;
begin
  for patch in select * from (values
    ('fishing_private.spot_json(uuid)',
      $old$'saved',exists(select 1 from public.spot_bookmarks$old$,
      $new$'media',fishing_private.spot_photos(target),'saved',exists(select 1 from public.spot_bookmarks$new$),
    ('fishing_private.can_view_media(uuid)',
      $old$(m.owner_id=(select auth.uid()) or$old$,
      $new$(m.owner_id=(select auth.uid())
      or (m.spot_id is not null and not m.is_staged and fishing_private.can_view_spot(m.spot_id))
      or (fishing_private.is_moderator() and exists(select 1 from public.fishing_spots s
        where s.id=m.spot_id and s.audience<>'private' and s.status<>'deleted')) or$new$),
    ('fishing_private.author_write(text,jsonb)',
      $old$  if content_type = 'spot' and command <> 'withdraw_content' then$old$,
      $new$  if content_type = 'spot' and command <> 'withdraw_content' then
    if command='save_spot' or payload ? 'media' then
      perform fishing_private.set_spot_photos(target,coalesce(payload->'media','[]'),false);
    end if;$new$),
    ('fishing_private.handle_content_update(text,jsonb)',
      $old$    if kind='post' then perform fishing_private.content_update_media(target,fields->'media',true);end if;$old$,
      $new$    if kind='post' then perform fishing_private.content_update_media(target,fields->'media',true);
    else
      fields:=fields||jsonb_build_object('media',case when payload ? 'media' then payload->'media'
        else coalesce(proposal.fields->'media',fishing_private.spot_photos(target)) end);
      perform fishing_private.set_spot_photos(target,fields->'media',true);
      fields:=jsonb_set(fields,'{media}',coalesce((select jsonb_agg(jsonb_build_object('id',(m->>'id')::uuid) order by n)
        from jsonb_array_elements(fields->'media') with ordinality x(m,n)),'[]'::jsonb));
    end if;$new$),
    ('fishing_private.install_content_update(text,uuid,jsonb)',
      $old$    update public.fishing_spots set name=fields->>'name'$old$,
      $new$    if fields ? 'media' then perform fishing_private.set_spot_photos(target,fields->'media',false);end if;
    update public.fishing_spots set name=fields->>'name'$new$),
    ('fishing_private.clear_content_update(text,uuid)',
      $old$    update public.media_assets set post_id=null,is_staged=false,sort_order=0 where post_id=target and is_staged;$old$,
      $new$    update public.media_assets set post_id=null,is_staged=false,sort_order=0 where post_id=target and is_staged;
  elsif kind='spot' then
    perform m.id from public.media_assets m where m.spot_id=target and m.is_staged order by m.id for update;
    update public.media_assets set spot_id=null,is_staged=false,sort_order=0 where spot_id=target and is_staged;$new$),
    ('fishing_private.author_read(text,uuid)',
      $old$case when content_type='post' then jsonb_build_object('media',fishing_private.content_update_photos(target,u.fields)) else '{}'::jsonb end$old$,
      $new$case when content_type='post' then jsonb_build_object('media',fishing_private.content_update_photos(target,u.fields))
        when content_type='spot' and u.fields ? 'media' then jsonb_build_object('media',fishing_private.spot_photos(target,u.fields->'media')) else '{}'::jsonb end$new$),
    ('fishing_private.review_item(text,uuid)',
      $old$'media','[]'::jsonb)
    into result from public.fishing_spots$old$,
      $new$'media',fishing_private.spot_photos(target))
    into result from public.fishing_spots$new$),
    ('fishing_private.content_update_review(text,uuid)',
      $old$'title',fields->>'name','body',fields->>'description','media','[]'::jsonb,$old$,
      $new$'title',fields->>'name','body',fields->>'description','media',fishing_private.spot_photos(target,fields->'media'),$new$),
    ('fishing_private.set_content_media(text,uuid,jsonb)',
      $old$and m.report_id is null and m.message_id is null$old$,
      $new$and m.report_id is null and m.message_id is null and m.spot_id is null$new$),
    ('fishing_private.content_update_media(uuid,jsonb,boolean)',
      $old$and m.trip_id is null and m.report_id is null and m.message_id is null$old$,
      $new$and m.trip_id is null and m.report_id is null and m.message_id is null and m.spot_id is null$new$),
    ('fishing_private.chat_send(jsonb)',
      $old$num_nonnulls(post_id,trip_id,report_id,message_id)=0$old$,
      $new$num_nonnulls(post_id,trip_id,report_id,message_id,spot_id)=0$new$),
    ('fishing_private.water_report_write(text,jsonb)',
      $old$and post_id is null and trip_id is null and report_id is null and message_id is null$old$,
      $new$and post_id is null and trip_id is null and report_id is null and message_id is null and spot_id is null$new$)
  ) patches(function_name,old_text,new_text) loop
    source:=pg_get_functiondef(patch.function_name::regprocedure);
    if strpos(source,patch.old_text)=0 or (length(source)-length(replace(source,patch.old_text,'')))/length(patch.old_text)<>1 then
      raise exception 'SPOT_PHOTO_ANCHOR: %',patch.function_name;
    end if;
    execute replace(source,patch.old_text,patch.new_text);
  end loop;
end $migration$;
revoke all on function fishing_private.spot_photos(uuid,jsonb),fishing_private.set_spot_photos(uuid,jsonb,boolean),
  fishing_private.delete_spot_photos() from public,anon,authenticated,service_role;
