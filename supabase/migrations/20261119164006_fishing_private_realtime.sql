-- Receive-only, per-account invalidations. Never broadcast rows, content or locations.
-- realtime.messages is managed by Supabase and already has RLS enabled.
create policy fishing_user_notifications on realtime.messages
  for select to authenticated using (
    extension='broadcast' and private
    and topic=(select realtime.topic())
    and (select realtime.topic())='fishing:user:'||(select auth.uid())::text
    and exists(select 1 from public.profiles where id=(select auth.uid()))
  );
-- Deliberately no INSERT policy: clients cannot impersonate server notifications.

-- Peer reading activity is available only through the friendship-aware projection.
alter policy members_read on public.conversation_members
  using (user_id=(select auth.uid()));

create function fishing_private.notify_social_user(recipient uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if recipient is not null then
    perform realtime.send('{"v":1}'::jsonb,'invalidate','fishing:user:'||recipient::text,true);
  end if;
end $$;

create function fishing_private.notify_social_change() returns trigger
-- Trigger-only definer also permits Auth's account-deletion cascades to invalidate peers.
-- No client EXECUTE grant; business writes retain their own auth/relationship checks.
language plpgsql security definer set search_path='' as $$
declare a uuid; b uuid;
begin
  if TG_TABLE_SCHEMA<>'public' then raise exception 'INVALID_TRIGGER'; end if;
  case TG_TABLE_NAME
  when 'messages' then
    select user_a,user_b into a,b from public.conversations where id=NEW.conversation_id;
    if not fishing_private.are_friends(a,b) then return null; end if;
  when 'conversation_members' then
    -- Own devices may clear their unread badge; an ex-friend never gets new read activity.
    a:=NEW.user_id;
    select case when user_a=a then user_b else user_a end into b
      from public.conversations where id=NEW.conversation_id;
    if not fishing_private.are_friends(a,b) then b:=null; end if;
  when 'friend_requests' then
    if TG_OP='DELETE' then a:=OLD.sender_id; b:=OLD.recipient_id;
    else a:=NEW.sender_id; b:=NEW.recipient_id; end if;
  when 'friendships' then
    if TG_OP='DELETE' then a:=OLD.user_a; b:=OLD.user_b;
    else a:=NEW.user_a; b:=NEW.user_b; end if;
  when 'blocks' then
    if TG_OP='DELETE' then a:=OLD.blocker_id; b:=OLD.blocked_id;
    else a:=NEW.blocker_id; b:=NEW.blocked_id; end if;
  else raise exception 'INVALID_TRIGGER';
  end case;
  perform fishing_private.notify_social_user(a);
  if b is distinct from a then perform fishing_private.notify_social_user(b); end if;
  return null;
end $$;
revoke all on function fishing_private.notify_social_user(uuid),
  fishing_private.notify_social_change() from public,anon,authenticated,service_role;

create trigger fishing_message_notice after insert on public.messages
  for each row execute function fishing_private.notify_social_change();
create trigger fishing_member_notice after insert on public.conversation_members
  for each row execute function fishing_private.notify_social_change();
create trigger fishing_read_notice after update of last_read_sequence on public.conversation_members
  for each row when (OLD.last_read_sequence is distinct from NEW.last_read_sequence)
  execute function fishing_private.notify_social_change();
create trigger fishing_request_notice after insert or update or delete on public.friend_requests
  for each row execute function fishing_private.notify_social_change();
create trigger fishing_friend_notice after insert or delete on public.friendships
  for each row execute function fishing_private.notify_social_change();
create trigger fishing_block_notice after insert or delete on public.blocks
  for each row execute function fishing_private.notify_social_change();

-- Preserve all unrelated/account dispatch branches and fail if the expected projection changed.
do $$
declare source text; needle text;
begin
  source:=pg_get_functiondef('fishing_private.read_api(text,jsonb)'::regprocedure);
  needle:='''can_send'',fishing_private.are_friends(c.user_a,c.user_b)';
  if position(needle in source)=0 then raise exception 'social projection changed'; end if;
  execute replace(source,needle,needle||',
        ''peer_read_sequence'',case when fishing_private.are_friends(c.user_a,c.user_b)
          then coalesce((select peer.last_read_sequence from public.conversation_members peer
            where peer.conversation_id=c.id and peer.user_id<>uid),0) else null end');
end $$;
