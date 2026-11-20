-- Public profile images follow the same block relationship as the profile itself.
do $migration$
declare source text; needle text:='or m.avatar_profile_id is not null';
begin
  source:=pg_get_functiondef('fishing_private.can_view_media(uuid)'::regprocedure);
  if (length(source)-length(replace(source,needle,'')))/length(needle)<>1
    then raise exception 'AVATAR_VISIBILITY_ANCHOR';end if;
  execute replace(source,needle,'or (m.avatar_profile_id is not null and not fishing_private.is_blocked(m.owner_id,(select auth.uid())))');
end $migration$;
