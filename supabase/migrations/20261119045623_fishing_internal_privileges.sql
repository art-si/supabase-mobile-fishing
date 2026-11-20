-- The platform's DDL event trigger is not a client RPC. Keep its owner invocation
-- intact while removing inherited EXECUTE privileges from application roles.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
