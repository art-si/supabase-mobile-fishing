-- Source-grounded names help the extractor avoid using a generic article headline
-- as a venue name. Hints never supply coordinates or bypass evidence verification.
alter table fishing_private.spot_source_jobs add column places jsonb not null default '[]'::jsonb
  check(jsonb_typeof(places)='array' and jsonb_array_length(places)<=6);

create or replace function public.fishing_enqueue_spot_sources(sources jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare entry jsonb; changed integer:=0; inserted integer; hints jsonb;
begin
  if jsonb_typeof(sources) is distinct from 'array' or jsonb_array_length(sources)>100 then
    raise exception 'INVALID_INPUT' using errcode='22023';
  end if;
  for entry in select value from jsonb_array_elements(sources) loop
    hints:=coalesce(entry->'places','[]');
    if jsonb_typeof(hints) is distinct from 'array' or jsonb_array_length(hints)>6 or exists(
      select 1 from jsonb_array_elements(hints) p where length(coalesce(p->>'name','')) not between 2 and 40 or
        (p ? 'query' and length(coalesce(p->>'query','')) not between 2 and 40)
    ) then raise exception 'INVALID_HINT' using errcode='22023'; end if;
    insert into fishing_private.spot_source_cities(city) values(entry->>'city') on conflict do nothing;
    insert into fishing_private.spot_source_jobs as j(city,url,places) values(entry->>'city',entry->>'url',hints)
      on conflict(city,url) do update set places=excluded.places,next_check=now()
      where jsonb_array_length(excluded.places)>0 and j.places is distinct from excluded.places;
    get diagnostics inserted=row_count;
    changed:=changed+inserted;
  end loop;
  return changed;
end $$;

-- Reuse earlier editorial names only as hints. The worker independently checks
-- each name against the fetched article before sending it to the extractor.
update fishing_private.spot_source_jobs j set places=coalesce((
  select jsonb_agg(hint) from (
    select distinct jsonb_build_object('name',coalesce(l.card->>'poiQuery',l.name)) hint
    from public.fishing_spot_leads l where l.city=j.city and exists(
      select 1 from jsonb_array_elements(jsonb_build_array(l.card->'source')||coalesce(l.card->'relatedSources','[]')) source
      where source->>'url'=j.url
    ) limit 6
  ) s
),'[]');

create or replace function public.fishing_claim_spot_sources() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare claimed jsonb; city_jobs jsonb;
begin
  with due as (
    select id from fishing_private.spot_source_jobs
    where next_check<=now() and (lease_until is null or lease_until<now())
    order by next_check,id limit 3 for update skip locked
  ), jobs as (
    update fishing_private.spot_source_jobs j set state='processing',lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1
    from due where j.id=due.id returning j.id,j.city,j.url,j.lease,j.attempts,j.places
  ) select coalesce(jsonb_agg(to_jsonb(jobs)),'[]') into claimed from jobs;
  with due as (
    select city from fishing_private.spot_source_cities
    where next_search<=now() and (lease_until is null or lease_until<now())
    order by next_search,city limit 1 for update skip locked
  ), jobs as (
    update fishing_private.spot_source_cities c set lease=gen_random_uuid(),lease_until=now()+interval '5 minutes'
    from due where c.city=due.city returning c.city,c.lease
  ) select coalesce(jsonb_agg(to_jsonb(jobs)),'[]') into city_jobs from jobs;
  return jsonb_build_object('sources',claimed,'cities',city_jobs);
end $$;
