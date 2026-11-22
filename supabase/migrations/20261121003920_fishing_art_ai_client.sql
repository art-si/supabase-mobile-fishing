-- Vault creates a project-scoped service credential without returning its value.
do $$
begin
  if to_regclass('vault.secrets') is null then return; end if;
  if not exists (select 1 from vault.secrets where name = 'art-ai/fishing-client-token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'art-ai/fishing-client-token',
      '钓友集调用 Art AI 服务的凭证'
    );
  end if;
end;
$$;

create function public.fishing_art_ai_client_token() returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if to_regclass('vault.decrypted_secrets') is null then return null; end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = 'art-ai/fishing-client-token');
end;
$$;

revoke all on function public.fishing_art_ai_client_token() from public, anon, authenticated;
grant execute on function public.fishing_art_ai_client_token() to service_role;
