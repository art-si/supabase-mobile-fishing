-- Editing reviewed source material invalidates any worker's earlier snapshot.
-- An old lease cannot hide the new annotation behind a long review/backoff date.
create function fishing_private.invalidate_source_annotation_lease() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.places is distinct from old.places then
    new.state:='queued'; new.lease:=null; new.lease_until:=null;
    new.next_check:=now(); new.attempts:=0;
  end if;
  return new;
end $$;
revoke all on function fishing_private.invalidate_source_annotation_lease() from public,anon,authenticated;
grant execute on function fishing_private.invalidate_source_annotation_lease() to service_role;
create trigger spot_source_annotation_lease before update of places
  on fishing_private.spot_source_jobs for each row execute function fishing_private.invalidate_source_annotation_lease();
