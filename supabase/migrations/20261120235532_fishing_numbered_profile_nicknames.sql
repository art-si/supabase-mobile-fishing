create sequence fishing_private.profile_nickname_seq start with 100001;
revoke all on sequence fishing_private.profile_nickname_seq from public, anon, authenticated, service_role;
grant usage on sequence fishing_private.profile_nickname_seq to service_role;

alter table public.profiles
  alter column nickname set default ('钓友' || nextval('fishing_private.profile_nickname_seq'::regclass)::text);
