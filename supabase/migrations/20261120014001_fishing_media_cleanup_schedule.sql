-- Applied to the confirmed project as 20261120014001; the job starts inactive.
-- The scheduler sends a 90-second HMAC proof, never a service-role/Vault secret.
-- pg_net request headers are readable by database roles on the managed platform.
create function fishing_private.dispatch_media_cleanup() returns bigint
language plpgsql security invoker set search_path='' as $$
declare secret text; stamp text; signature text; request_id bigint;
begin
  if not exists(select 1 from fishing_private.media_deletions q
    where (q.state='pending' and q.next_attempt_at<=clock_timestamp() and q.attempts<12)
       or (q.state='working' and q.lease_until<=clock_timestamp())) then return null; end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name='fishing_media_cleanup_hmac';
  if secret is null or secret !~ '^[a-f0-9]{64}$' then raise exception 'MEDIA_CLEANUP_NOT_CONFIGURED'; end if;
  stamp:=floor(extract(epoch from clock_timestamp()))::bigint::text;
  signature:=encode(extensions.hmac('fishing-media-cleanup.v1.'||stamp,secret,'sha256'),'hex');
  select net.http_post(
    url:='https://tlfmfokyhahlpzmpliad.supabase.co/functions/v1/media-cleanup',
    headers:=jsonb_build_object('Content-Type','application/json','x-cleanup-time',stamp,'x-cleanup-signature',signature),
    body:='{}'::jsonb,timeout_milliseconds:=60000) into request_id;
  return request_id;
end;
$$;
revoke all on function fishing_private.dispatch_media_cleanup() from public,anon,authenticated,service_role;

-- PGlite contract environments intentionally have neither extension; they test the queue,
-- not managed scheduling. Hosted PostgreSQL installs the real scheduler and HTTP worker.
do $$
declare job bigint;
begin
  if not exists(select 1 from pg_available_extensions where name='pg_cron')
     or not exists(select 1 from pg_available_extensions where name='pg_net') then return; end if;
  create extension if not exists pg_cron with schema pg_catalog;
  create extension if not exists pg_net with schema extensions;
  grant usage on schema cron to postgres;
  grant all on all tables in schema cron to postgres;
  if not exists(select 1 from vault.secrets where name='fishing_media_cleanup_hmac') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'fishing_media_cleanup_hmac','Scoped HMAC for deleted fishing media cleanup');
  end if;
  select cron.schedule('fishing-media-cleanup','*/5 * * * *','select fishing_private.dispatch_media_cleanup();') into job;
  -- Activation follows verified Edge deployment and a real Storage acceptance run.
  perform cron.alter_job(job,active:=false);
end;
$$;
