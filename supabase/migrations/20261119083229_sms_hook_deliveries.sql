-- Server-only SMS delivery ledger. Never store telephone numbers, OTPs, raw
-- webhook bodies or provider responses here. payload_digest is an HMAC made
-- with a dedicated server secret, not an unkeyed hash of a low-entropy OTP.
create table public.sms_hook_deliveries (
  event_id text primary key check (length(event_id) between 1 and 200),
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  reservation_id uuid not null,
  state text not null default 'pending'
    check (state in ('pending', 'succeeded', 'failed', 'unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  retain_until timestamptz not null check (retain_until >= created_at + interval '24 hours')
);

alter table public.sms_hook_deliveries enable row level security;
alter table public.sms_hook_deliveries force row level security;
revoke all on table public.sms_hook_deliveries from public, anon, authenticated, service_role;
grant select, insert on table public.sms_hook_deliveries to service_role;
grant update (state, updated_at) on table public.sms_hook_deliveries to service_role;

comment on table public.sms_hook_deliveries is
  'Server-only at-most-once SMS ledger. Pending/unknown/failed entries are never reclaimed automatically. No client policies, raw OTP or phone data. retain_until is a minimum retention marker, not a retry lease.';
