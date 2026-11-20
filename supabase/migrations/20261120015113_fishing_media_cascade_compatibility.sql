-- Auth deletes cascade through media_assets as supabase_auth_admin, which deliberately
-- has no access to fishing_private. The trigger queues OLD rows with fixed search_path.
alter function fishing_private.enqueue_deleted_media() security definer;
revoke all on function fishing_private.enqueue_deleted_media() from public,anon,authenticated;
