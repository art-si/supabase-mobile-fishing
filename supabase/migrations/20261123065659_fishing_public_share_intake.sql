-- Only published public spot descriptions can supply external public share URLs.
-- No private/friends posts, device locations, author IDs or account credentials enter this inbox.
create table fishing_private.spot_share_inbox (
  spot_id uuid primary key references public.fishing_spots(id) on delete cascade,
  fingerprint text not null,
  state text not null default 'queued' check(state in ('queued','processing','done')),
  lease uuid, lease_until timestamptz,
  updated_at timestamptz not null default now(), processed_at timestamptz
);
alter table fishing_private.spot_share_inbox enable row level security;
revoke all on fishing_private.spot_share_inbox from public,anon,authenticated;
grant select,insert,update,delete on fishing_private.spot_share_inbox to service_role;
create index spot_share_inbox_due on fishing_private.spot_share_inbox(updated_at,spot_id) where state<>'done';

create function fishing_private.collect_public_spot_shares() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status<>'published' or new.audience<>'public' or
    new.description !~ 'https://(www\.)?(xiaohongshu\.com|xhslink\.(com|cn)|douyin\.com|v\.douyin\.com|jingxuan\.douyin\.com|toutiao\.com|m\.toutiao\.com|mp\.weixin\.qq\.com|bilibili\.com|t\.bilibili\.com|b23\.tv)/' then
    delete from fishing_private.spot_share_inbox where spot_id=new.id;
    return new;
  end if;
  insert into fishing_private.spot_share_inbox(spot_id,fingerprint)
    values(new.id,md5(jsonb_build_array(new.city,new.description)::text))
  on conflict(spot_id) do update set fingerprint=excluded.fingerprint,state='queued',lease=null,lease_until=null,
    updated_at=now(),processed_at=null
    where spot_share_inbox.fingerprint<>excluded.fingerprint;
  return new;
end $$;
revoke all on function fishing_private.collect_public_spot_shares() from public,anon,authenticated;
create trigger fishing_public_spot_share_intake after insert or update of city,description,status,audience
  on public.fishing_spots for each row execute function fishing_private.collect_public_spot_shares();

create function public.fishing_claim_spot_shares() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  with due as (
    select i.spot_id from fishing_private.spot_share_inbox i
    where i.state<>'done' and (i.lease_until is null or i.lease_until<now())
      and exists(select 1 from public.fishing_spots s where s.id=i.spot_id and s.audience='public' and s.status='published')
    order by i.updated_at,i.spot_id limit 5 for update skip locked
  ), claimed as (
    update fishing_private.spot_share_inbox i set state='processing',lease=gen_random_uuid(),lease_until=now()+interval '5 minutes'
    from due where i.spot_id=due.spot_id returning i.spot_id,i.lease,i.fingerprint
  ) select coalesce(jsonb_agg(jsonb_build_object('id',c.spot_id,'lease',c.lease,'fingerprint',c.fingerprint,
      'city',s.city,'description',s.description)),'[]') into result
    from claimed c join public.fishing_spots s on s.id=c.spot_id;
  return result;
end $$;

create function public.fishing_finish_spot_shares(spot uuid,lease_token uuid,fingerprint text,sources jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare current_spot public.fishing_spots; intake fishing_private.spot_share_inbox; count_added integer;
begin
  -- Lock in the same spot -> inbox order as an author edit/withdrawal.
  select * into current_spot from public.fishing_spots where id=spot for share;
  if not found or current_spot.audience<>'public' or current_spot.status<>'published' then
    return jsonb_build_object('applied',false,'enqueued',0);
  end if;
  select * into intake from fishing_private.spot_share_inbox i
    where i.spot_id=spot and i.lease=lease_token and i.lease_until>now() and i.state='processing' for update;
  if not found or intake.fingerprint is distinct from fingerprint or
    md5(jsonb_build_array(current_spot.city,current_spot.description)::text) is distinct from fingerprint then
    return jsonb_build_object('applied',false,'enqueued',0);
  end if;
  if jsonb_typeof(sources) is distinct from 'array' or jsonb_array_length(sources)>6 or exists(
    select 1 from jsonb_array_elements(sources) s where jsonb_typeof(s) is distinct from 'string' or
      length(s#>>'{}') not between 12 and 500 or
      (s#>>'{}') !~ '^https://(www\.)?(xiaohongshu\.com|xhslink\.(com|cn)|douyin\.com|v\.douyin\.com|jingxuan\.douyin\.com|toutiao\.com|m\.toutiao\.com|mp\.weixin\.qq\.com|bilibili\.com|t\.bilibili\.com|b23\.tv)/'
  ) then raise exception 'INVALID_INPUT' using errcode='22023';end if;
  -- The server owns the city and queues URLs only. User descriptions are never
  -- treated as fetched original evidence or copied into privileged annotations.
  select public.fishing_enqueue_spot_sources(coalesce(jsonb_agg(jsonb_build_object('city',current_spot.city,'url',s#>>'{}')),'[]'))
    into count_added from jsonb_array_elements(sources) s;
  update fishing_private.spot_share_inbox set state='done',processed_at=now(),lease=null,lease_until=null where spot_id=spot;
  return jsonb_build_object('applied',true,'enqueued',count_added);
end $$;
revoke all on function public.fishing_claim_spot_shares(),public.fishing_finish_spot_shares(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.fishing_claim_spot_shares(),public.fishing_finish_spot_shares(uuid,uuid,text,jsonb) to service_role;

insert into fishing_private.spot_share_inbox(spot_id,fingerprint)
  select id,md5(jsonb_build_array(city,description)::text) from public.fishing_spots
  where status='published' and audience='public' and
    description ~ 'https://(www\.)?(xiaohongshu\.com|xhslink\.(com|cn)|douyin\.com|v\.douyin\.com|jingxuan\.douyin\.com|toutiao\.com|m\.toutiao\.com|mp\.weixin\.qq\.com|bilibili\.com|t\.bilibili\.com|b23\.tv)/'
  on conflict do nothing;
