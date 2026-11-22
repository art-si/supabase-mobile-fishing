-- Preserve archived rows and existing friend-only visibility. Retire the public
-- chat and relationship workflows, including for already-installed clients.
do $$
declare source text; updated text;
begin
  source := pg_get_functiondef('fishing_private.read_api(text,jsonb)'::regprocedure);
  updated := regexp_replace(source, $pattern$  when 'people' then[\s\S]*?(?=  when 'profile' then)$pattern$, '');
  if updated = source then raise exception 'people dispatch changed'; end if;
  source := updated;
  updated := regexp_replace(source, $pattern$  when 'social' then[\s\S]*?(?=  when 'library' then)$pattern$, '');
  if updated = source then raise exception 'social dispatch changed'; end if;
  source := updated;
  updated := replace(source, $old$  when 'message_content' then return fishing_private.chat_content(payload);$old$, '');
  if updated = source then raise exception 'message content dispatch changed'; end if;
  execute replace(updated, $old$,'friend',fishing_private.are_friends(uid,target)$old$, '');

  source := pg_get_functiondef('fishing_private.write_api(text,jsonb)'::regprocedure);
  updated := regexp_replace(source, $pattern$  when 'follow','friend_request','unfriend','block','conversation' then[\s\S]*?(?=  when 'report' then)$pattern$, $replacement$  when 'follow','block' then
    if target=uid or not exists(select 1 from public.profiles where id=target) then raise exception 'INVALID_INPUT';end if;
    perform pg_advisory_xact_lock(hashtextextended(least(uid,target)::text||'/'||greatest(uid,target)::text,0));
    if action='follow' then
      if fishing_private.is_blocked(uid,target) then raise exception 'BLOCKED';end if;
      if desired then
        insert into public.follows(follower_id,followed_id) values(uid,target) on conflict do nothing;
      else delete from public.follows where follower_id=uid and followed_id=target;end if;
    elsif desired then
      insert into public.blocks(blocker_id,blocked_id) values(uid,target) on conflict do nothing;
      delete from public.friendships where user_a=least(uid,target) and user_b=greatest(uid,target);
      delete from public.follows where (follower_id=uid and followed_id=target) or (follower_id=target and followed_id=uid);
    else delete from public.blocks where blocker_id=uid and blocked_id=target;end if;
    return to_jsonb(true);
$replacement$);
  if updated = source then raise exception 'relationship dispatch changed'; end if;
  execute updated;

  source := pg_get_functiondef('fishing_private.can_view_media(uuid)'::regprocedure);
  updated := regexp_replace(source, $pattern$\n      or \(m\.message_id is not null and exists[^\n]+\)$pattern$, '');
  if updated = source then raise exception 'chat media access changed'; end if;
  execute replace(updated, 'where m.id=target and (', 'where m.id=target and m.message_id is null and (');

  source := pg_get_functiondef('fishing_private.notifications_api(text,jsonb)'::regprocedure);
  updated := replace(source, 'n.recipient_id=uid and', $new$n.recipient_id=uid and n.kind<>'friend_accepted' and$new$);
  updated := replace(updated, 'where recipient_id=uid and', $new$where recipient_id=uid and kind<>'friend_accepted' and$new$);
  updated := replace(updated, 'where id=target_id and recipient_id=uid', $new$where id=target_id and recipient_id=uid and kind<>'friend_accepted'$new$);
  if updated = source then raise exception 'notification dispatch changed'; end if;
  execute updated;

  source := pg_get_functiondef('fishing_private.notification_summary()'::regprocedure);
  updated := replace(source, $old$n.category='interaction'$old$, $new$n.category='interaction' and n.kind<>'friend_accepted'$new$);
  if updated = source then raise exception 'notification summary changed'; end if;
  execute updated;
end $$;

drop trigger fishing_message_notice on public.messages;
drop trigger fishing_member_notice on public.conversation_members;
drop trigger fishing_read_notice on public.conversation_members;
drop trigger fishing_request_notice on public.friend_requests;
drop trigger fishing_friend_notice on public.friendships;
drop trigger fishing_friend_inbox on public.friend_requests;

revoke all on public.messages, public.conversations, public.conversation_members,
  public.friend_requests, public.friendships from public, anon, authenticated;
drop policy messages_read on public.messages;
drop policy conversations_read on public.conversations;
drop policy members_read on public.conversation_members;
drop policy requests_read on public.friend_requests;
drop policy friendships_read on public.friendships;

drop function fishing_private.chat_content(jsonb);
drop function fishing_private.chat_send(jsonb);
drop function fishing_private.message_json(public.messages);
drop function fishing_private.chat_card(text,uuid,uuid);
