-- Supabase authorize() inserts topic/extension probes without `private`, whose
-- managed default is false. The old row predicate therefore denied every join.
-- Private wire delivery is enforced by realtime.send(..., true) and the client's
-- private channel option, not by a probe-row field. Keep exact account scoping,
-- profile existence and Broadcast-only reads; do not grant any client writes.
alter policy fishing_user_notifications on realtime.messages using (
  extension='broadcast'
  and topic=(select realtime.topic())
  and (select realtime.topic())='fishing:user:'||(select auth.uid())::text
  and exists(select 1 from public.profiles where id=(select auth.uid()))
);
