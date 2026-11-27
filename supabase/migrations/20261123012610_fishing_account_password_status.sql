-- Auth owns the password. Return only the current user's configured/unconfigured state.
-- The definer is private because clients must never receive auth.users or a password hash.
create function fishing_private.password_configured() returns boolean
language plpgsql stable security definer set search_path='' as $$
declare configured boolean;
begin
  if auth.uid() is null then
    raise exception using message='NOT_AUTHENTICATED', errcode='28000';
  end if;
  select coalesce(u.encrypted_password <> '', false) into configured
  from auth.users u where u.id = auth.uid();
  if not found then
    raise exception using message='NOT_AUTHENTICATED', errcode='28000';
  end if;
  return configured;
end;
$$;
revoke all on function fishing_private.password_configured() from public, anon, authenticated, service_role;
grant execute on function fishing_private.password_configured() to authenticated;

create function public.fishing_password_configured() returns boolean
language sql stable security invoker set search_path='' as $$
  select fishing_private.password_configured();
$$;
revoke all on function public.fishing_password_configured() from public, anon, authenticated, service_role;
grant execute on function public.fishing_password_configured() to authenticated;
