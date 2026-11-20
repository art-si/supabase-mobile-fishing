-- Images and videos share the same ordered nine-item attachment list.
create or replace function fishing_private.validate_media_selection(photos jsonb) returns void
language plpgsql stable security invoker set search_path='' as $$
begin
  if jsonb_typeof(photos) is distinct from 'array' or jsonb_array_length(photos)>9 then raise exception 'INVALID_INPUT'; end if;
end $$;
revoke all on function fishing_private.validate_media_selection(jsonb) from public,anon,authenticated,service_role;
