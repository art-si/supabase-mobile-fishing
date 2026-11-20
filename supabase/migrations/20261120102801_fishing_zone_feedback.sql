-- Community decisions change the application's fence display, never the source policy.
-- CLI-created migration ordered after its water-fence dependency in this repository.
create table fishing_private.zone_feedback_rounds (
  source text not null check(source in ('community','official')),
  target_id text not null,
  version text not null check(version ~ '^[a-f0-9]{32}$'),
  released boolean not null default false,
  changed_at timestamptz,
  primary key(source,target_id,version)
);
create table fishing_private.zone_feedback_votes (
  source text not null,
  target_id text not null,
  version text not null,
  voter_id uuid not null references public.profiles(id) on delete cascade,
  vote text not null check(vote in ('can_fish','cannot_fish')),
  note text not null default '' check(length(note)<=500),
  updated_at timestamptz not null default now(),
  primary key(source,target_id,version,voter_id),
  foreign key(source,target_id,version) references fishing_private.zone_feedback_rounds on delete cascade
);
create index zone_feedback_voter_idx on fishing_private.zone_feedback_votes(voter_id);
create table fishing_private.zone_feedback_events (
  id bigint generated always as identity primary key,
  source text not null,
  target_id text not null,
  version text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  event text not null check(event in ('vote','release','restore')),
  detail jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(source,target_id,version) references fishing_private.zone_feedback_rounds on delete cascade
);
create index zone_feedback_history_idx on fishing_private.zone_feedback_events(source,target_id,created_at desc);
alter table fishing_private.zone_feedback_rounds enable row level security;
alter table fishing_private.zone_feedback_votes enable row level security;
alter table fishing_private.zone_feedback_events enable row level security;
revoke all on fishing_private.zone_feedback_rounds,fishing_private.zone_feedback_votes,fishing_private.zone_feedback_events from public,anon,authenticated;
grant select,insert,update,delete on fishing_private.zone_feedback_rounds,fishing_private.zone_feedback_votes,fishing_private.zone_feedback_events to service_role;
grant usage,select on sequence fishing_private.zone_feedback_events_id_seq to service_role;

-- Content-derived versions reset the count only when geometry, policy or validity changes.
create function fishing_private.zone_feedback_version(kind text,target text) returns text
language plpgsql stable set search_path='' as $$
declare result text; today date:=(now() at time zone 'Asia/Shanghai')::date;
begin
  if kind='community' then
    select md5(jsonb_build_array(z.boundary,z.description,z.source_url,z.observed_on,z.expires_on,z.revision)::text)
    into result from public.fishing_zone_reports z
    where z.id=target::uuid and z.status='published' and z.boundary is not null
      and z.expires_on>=today;
  elsif kind='official' then
    select md5(jsonb_build_array(z.boundary,z.description,z.source_url,z.boundary_source_url,z.valid_from,z.valid_until)::text)
    into result from public.fishing_official_zones z
    where z.id=target and z.published and z.valid_from<=today and (z.valid_until is null or z.valid_until>=today);
  else raise exception 'INVALID_INPUT';end if;
  if result is null then raise exception 'NOT_FOUND';end if;
  return result;
exception when invalid_text_representation then raise exception 'INVALID_INPUT';
end $$;

create function fishing_private.zone_feedback_state(kind text,target text,current_version text) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object(
    'version',current_version,
    'total',count(*),
    'can_fish',count(*) filter(where v.vote='can_fish'),
    'cannot_fish',count(*) filter(where v.vote='cannot_fish'),
    'percent',case when count(*)=0 then 0 else (count(*) filter(where v.vote='can_fish')*100/count(*))::integer end,
    'mine',max(v.vote) filter(where v.voter_id=auth.uid()),
    'note',coalesce(max(v.note) filter(where v.voter_id=auth.uid()),''),
    'released',coalesce((select r.released from fishing_private.zone_feedback_rounds r where r.source=kind and r.target_id=target and r.version=current_version),false),
    'changed_at',(select r.changed_at from fishing_private.zone_feedback_rounds r where r.source=kind and r.target_id=target and r.version=current_version),
    'minimum',10,'threshold',60)
  from fishing_private.zone_feedback_votes v where v.source=kind and v.target_id=target and v.version=current_version;
$$;

create function fishing_private.zone_feedback_api(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); kind text:=payload->>'source'; target text:=payload->>'id';
  current_version text; choice text:=payload->>'vote'; note text:=btrim(coalesce(payload->>'note',''));
  previous_vote text; previous_note text; state jsonb; before_release boolean; after_release boolean;
  total bigint; can_count bigint; cannot_count bigint;
begin
  if payload is null or jsonb_typeof(payload)<>'object' or length(payload::text)>4000
    or target is null or length(target) not between 1 and 160 or kind is null or kind not in ('community','official')
    or action is null or action not in ('state','vote') then raise exception 'INVALID_INPUT';end if;
  if kind='community' and exists(select 1 from public.fishing_zone_reports z where z.id=target::uuid and fishing_private.is_blocked(uid,z.author_id)) then raise exception 'NOT_FOUND';end if;
  if action='vote' then
    if uid is null or not exists(select 1 from public.profiles p where p.id=uid) then raise exception 'NOT_AUTHENTICATED';end if;
    if choice is null or choice not in ('can_fish','cannot_fish') or length(note)>500
      or payload ?| array['voter_id','user_id','released','total','threshold'] then raise exception 'INVALID_INPUT';end if;
    -- All accounts serialize on the same fence, so a concurrent tenth vote cannot be lost.
    perform pg_advisory_xact_lock(hashtextextended('fishing-zone-feedback:'||kind||':'||target,0));
    if kind='community' then perform 1 from public.fishing_zone_reports z where z.id=target::uuid for share;
    else perform 1 from public.fishing_official_zones z where z.id=target for share;end if;
  end if;
  current_version:=fishing_private.zone_feedback_version(kind,target);
  if action='state' then return fishing_private.zone_feedback_state(kind,target,current_version);end if;
  if payload->>'version' is distinct from current_version then raise exception 'REVIEW_CONFLICT';end if;
  select v.vote,v.note into previous_vote,previous_note from fishing_private.zone_feedback_votes v
    where v.source=kind and v.target_id=target and v.version=current_version and v.voter_id=uid;
  -- Lost-response retries neither create another vote nor consume rate quota.
  if previous_vote=choice and previous_note=note then return fishing_private.zone_feedback_state(kind,target,current_version);end if;
  if (select count(*) from fishing_private.rate_events e where e.user_id=uid and e.action='zone_feedback' and e.created_at>now()-interval '1 minute')>=20 then raise exception 'RATE_LIMIT';end if;
  insert into fishing_private.zone_feedback_rounds(source,target_id,version) values(kind,target,current_version) on conflict do nothing;
  select r.released into before_release from fishing_private.zone_feedback_rounds r
    where r.source=kind and r.target_id=target and r.version=current_version for update;
  insert into fishing_private.zone_feedback_votes(source,target_id,version,voter_id,vote,note)
    values(kind,target,current_version,uid,choice,note)
    on conflict(source,target_id,version,voter_id) do update set vote=excluded.vote,note=excluded.note,updated_at=now();
  select count(*),count(*) filter(where v.vote='can_fish'),count(*) filter(where v.vote='cannot_fish')
    into total,can_count,cannot_count from fishing_private.zone_feedback_votes v
    where v.source=kind and v.target_id=target and v.version=current_version;
  after_release:=before_release;
  if total>=10 then
    if can_count*100>=total*60 then after_release:=true;
    elsif cannot_count*100>=total*60 then after_release:=false;end if;
  end if;
  insert into fishing_private.zone_feedback_events(source,target_id,version,actor_id,event,detail)
    values(kind,target,current_version,uid,'vote',jsonb_build_object('previous',previous_vote,'vote',choice,'note',note));
  if before_release is distinct from after_release then
    update fishing_private.zone_feedback_rounds r set released=after_release,changed_at=now()
      where r.source=kind and r.target_id=target and r.version=current_version;
    insert into fishing_private.zone_feedback_events(source,target_id,version,actor_id,event,detail)
      values(kind,target,current_version,uid,case when after_release then 'release' else 'restore' end,
        jsonb_build_object('total',total,'can_fish',can_count,'cannot_fish',cannot_count,'minimum',10,'threshold',60));
  end if;
  insert into fishing_private.rate_events(user_id,action) values(uid,'zone_feedback');
  return fishing_private.zone_feedback_state(kind,target,current_version);
exception when invalid_text_representation or check_violation or not_null_violation then raise exception 'INVALID_INPUT';
end $$;

-- Keep released records discoverable in the map list, but omit their fence overlays.
alter function fishing_private.zones_read(text,jsonb) rename to zones_read_before_feedback;
create function fishing_private.zones_read(action text,payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; item jsonb; state jsonb; items jsonb:='[]'; released jsonb:='[]'; current_version text;
begin
  result:=fishing_private.zones_read_before_feedback(action,payload);
  if jsonb_typeof(result->'items') is distinct from 'array' then return result;end if;
  for item in select value from jsonb_array_elements(result->'items') loop
    if item->>'status'='published' and item->'boundary' is not null and item->'boundary'<>'null'::jsonb
      and (coalesce(item->>'expires_on','')='' or (item->>'expires_on')::date>=(now() at time zone 'Asia/Shanghai')::date) then
      current_version:=fishing_private.zone_feedback_version(item->>'source',item->>'id');
      state:=fishing_private.zone_feedback_state(item->>'source',item->>'id',current_version);
      item:=item||jsonb_build_object('feedback',state);
    end if;
    if action='nearby' and coalesce((item->'feedback'->>'released')::boolean,false) then released:=released||jsonb_build_array(item);
    else items:=items||jsonb_build_array(item);end if;
  end loop;
  return result||jsonb_build_object('items',items,'released',released);
end $$;
create function public.fishing_zone_feedback(action text,payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$select fishing_private.zone_feedback_api(action,payload);$$;
create or replace function public.fishing_zones_read(action text,payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$select fishing_private.zones_read(action,payload);$$;
revoke all on function fishing_private.zone_feedback_version(text,text),fishing_private.zone_feedback_state(text,text,text),fishing_private.zone_feedback_api(text,jsonb),fishing_private.zones_read(text,jsonb),fishing_private.zones_read_before_feedback(text,jsonb),public.fishing_zone_feedback(text,jsonb) from public,anon,authenticated;
grant execute on function fishing_private.zones_read(text,jsonb),fishing_private.zone_feedback_api(text,jsonb),public.fishing_zone_feedback(text,jsonb) to anon,authenticated;
grant execute on function fishing_private.zone_feedback_version(text,text),fishing_private.zone_feedback_state(text,text,text),fishing_private.zone_feedback_api(text,jsonb),fishing_private.zones_read(text,jsonb),fishing_private.zones_read_before_feedback(text,jsonb),public.fishing_zone_feedback(text,jsonb) to service_role;
