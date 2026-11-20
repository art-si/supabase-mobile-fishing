-- An avatar is a real, server-sanitized image with one exclusive owner/parent.
-- It reuses the private media bucket, signed reads and committed-deletion queue.
alter table public.media_assets add column avatar_profile_id uuid references public.profiles(id) on delete cascade;
create unique index media_avatar_profile_idx on public.media_assets(avatar_profile_id) where avatar_profile_id is not null;
alter table public.media_assets drop constraint media_single_parent,
  add constraint media_single_parent check(num_nonnulls(post_id,trip_id,report_id,message_id,spot_id,avatar_profile_id)<=1),
  add constraint avatar_media_image_only check(avatar_profile_id is null or
    (kind='image' and owner_id=avatar_profile_id and not is_staged and size>0 and size<=8388608));

create function fishing_private.set_profile_avatar(asset uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); amount integer;
begin
  if uid is null then raise exception 'AUTH_REQUIRED';end if;
  perform p.id from public.profiles p where p.id=uid for update;
  if not found then raise exception 'AUTH_REQUIRED';end if;
  -- Stable ordering, including the old avatar, makes replacement atomic.
  perform m.id from public.media_assets m where m.avatar_profile_id=uid or m.id=asset order by m.id for update;
  if asset is not null and not exists(select 1 from public.media_assets m where m.id=asset and m.owner_id=uid
    and m.kind='image' and m.size>0 and m.size<=8388608 and not m.is_staged
    and m.path=uid::text||'/'||m.id::text||'.jpg'
    and num_nonnulls(m.post_id,m.trip_id,m.report_id,m.message_id,m.spot_id)=0
    and (m.avatar_profile_id is null or m.avatar_profile_id=uid)) then raise exception 'AVATAR_UNAVAILABLE';end if;
  -- Deleting the index revokes future signing immediately; existing cleanup
  -- machinery deletes the old object asynchronously after this transaction commits.
  delete from public.media_assets where avatar_profile_id=uid and (asset is null or id<>asset);
  update public.media_assets set avatar_profile_id=uid,sort_order=0 where id=asset;
end $$;
revoke all on function fishing_private.set_profile_avatar(uuid) from public,anon,authenticated,service_role;

create or replace function fishing_private.profile_json(target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',p.id,'nickname',p.nickname,'handle',p.handle,'city',p.city,'bio',p.bio,'method',p.method,
    'avatar',(select fishing_private.asset_json(m) from public.media_assets m where m.avatar_profile_id=p.id))
  from public.profiles p where p.id=target;
$$;

do $migration$
declare patch record; source text;
begin
  for patch in select * from (values
    ('fishing_private.write_api(text,jsonb)',
      $old$  when 'update_profile' then$old$,
      $new$  when 'update_profile' then
    if payload ? 'avatar_id' then
      if jsonb_typeof(payload->'avatar_id') not in ('string','null') or
        (jsonb_typeof(payload->'avatar_id')='string' and (payload->>'avatar_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then
        raise exception 'AVATAR_UNAVAILABLE';
      end if;
      perform fishing_private.set_profile_avatar((payload->>'avatar_id')::uuid);
    end if;$new$),
    ('fishing_private.can_view_media(uuid)',
      $old$(m.owner_id=(select auth.uid())$old$,
      $new$(m.owner_id=(select auth.uid()) or m.avatar_profile_id is not null$new$),
    ('fishing_private.set_content_media(text,uuid,jsonb)',
      $old$and m.report_id is null and m.message_id is null and m.spot_id is null$old$,
      $new$and m.report_id is null and m.message_id is null and m.spot_id is null and m.avatar_profile_id is null$new$),
    ('fishing_private.content_update_media(uuid,jsonb,boolean)',
      $old$and m.trip_id is null and m.report_id is null and m.message_id is null and m.spot_id is null$old$,
      $new$and m.trip_id is null and m.report_id is null and m.message_id is null and m.spot_id is null and m.avatar_profile_id is null$new$),
    ('fishing_private.set_spot_photos(uuid,jsonb,boolean)',
      $old$and m.post_id is null and m.trip_id is null and m.report_id is null and m.message_id is null$old$,
      $new$and m.post_id is null and m.trip_id is null and m.report_id is null and m.message_id is null and m.avatar_profile_id is null$new$),
    ('fishing_private.chat_send(jsonb)',
      $old$num_nonnulls(post_id,trip_id,report_id,message_id,spot_id)=0$old$,
      $new$num_nonnulls(post_id,trip_id,report_id,message_id,spot_id,avatar_profile_id)=0$new$),
    ('fishing_private.water_report_write(text,jsonb)',
      $old$and post_id is null and trip_id is null and report_id is null and message_id is null and spot_id is null$old$,
      $new$and post_id is null and trip_id is null and report_id is null and message_id is null and spot_id is null and avatar_profile_id is null$new$)
  ) patches(function_name,old_text,new_text) loop
    source:=pg_get_functiondef(patch.function_name::regprocedure);
    if strpos(source,patch.old_text)=0 or (length(source)-length(replace(source,patch.old_text,'')))/length(patch.old_text)<>1 then
      raise exception 'AVATAR_ANCHOR: %',patch.function_name;
    end if;
    execute replace(source,patch.old_text,patch.new_text);
  end loop;
end $migration$;
