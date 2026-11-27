-- Search aliases can recover old records with no POI ID, but cannot override a different verified POI.
-- Same-city names can identify different venues. Do not move another venue's
-- comments, likes, bookmarks or source proof onto a different provider POI.
create or replace function public.fishing_finish_spot_source(job_id uuid,lease_token uuid,result jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare job fishing_private.spot_source_jobs; entry jsonb; previous public.fishing_spot_leads;
  state_name text:=result->>'state'; canonical_name text; merged jsonb;
begin
  select * into job from fishing_private.spot_source_jobs where id=job_id and lease=lease_token and lease_until>now() for update;
  if not found then return false; end if;
  if state_name not in ('published','review','blocked','failed') or state_name is null or
    length(coalesce(result->>'reason',''))>100 then raise exception 'INVALID_RESULT' using errcode='22023'; end if;
  if state_name='published' then
    if jsonb_typeof(result->'cards') is distinct from 'array' or jsonb_array_length(result->'cards') not between 1 and 6 then
      raise exception 'INVALID_CARDS' using errcode='22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(result->'cards') as incoming(c)
      join public.fishing_spot_leads l on l.city=job.city and l.name=c->>'name'
      where l.card->>'poiId' is not null and l.card->>'poiId'<>c->>'poiId'
    ) or exists (
      select 1 from jsonb_array_elements(result->'cards') as a(c)
      join jsonb_array_elements(result->'cards') as b(c) on a.c->>'name'=b.c->>'name'
      where a.c->>'poiId'<>b.c->>'poiId'
    ) then
      update fishing_private.spot_source_jobs set state='review',reason='same_name_different_place',
        lease=null,lease_until=null,checked_at=now(),next_check=now()+interval '30 days',result_count=0
        where id=job_id;
      update public.fishing_spot_leads set catalog_status='review'
        where city=job.city and card->'source'->>'url'=job.url;
      return false;
    end if;
    for entry in select value from jsonb_array_elements(result->'cards') loop
      if entry->>'city' is distinct from job.city or entry->'source'->>'url' is distinct from job.url or
        length(coalesce(entry->>'name','')) not between 2 and 40 or
        length(coalesce(entry->>'evidence','')) not between 4 and 90 or
        entry->>'waterType' is distinct from '钓场' or
        jsonb_typeof(entry->'sourcePosition'->'longitude') is distinct from 'number' or
        jsonb_typeof(entry->'sourcePosition'->'latitude') is distinct from 'number' or
        entry->'sourcePosition'->>'crs' is distinct from 'GCJ-02' or
        not ((entry->'sourcePosition'->>'longitude')::numeric between 73 and 136) or
        not ((entry->'sourcePosition'->>'latitude')::numeric between 3 and 54) or
        coalesce(entry->>'poiId','') !~ '^[A-Za-z0-9]{5,40}$' then
        raise exception 'UNVERIFIED_CARD' using errcode='22023';
      end if;
      -- A POI has one canonical card in a city. Keep its old name so likes, comments
      -- and bookmarks continue to use the same lead:city|name community key.
      select * into previous from public.fishing_spot_leads l
        where l.city=job.city and (l.name=entry->>'name' or l.card->>'poiId'=entry->>'poiId' or
          (coalesce(l.card->>'poiQuery',l.name) in (entry->>'poiQuery',entry->>'name') and
            (l.card->>'poiId' is null or l.card->>'poiId'=entry->>'poiId')))
        order by (l.name=entry->>'name') desc,l.name limit 1;
      canonical_name:=coalesce(previous.name,entry->>'name');
      select coalesce(jsonb_agg(link),'[]'::jsonb) into merged from (
        select distinct on (rtrim(link->>'url','/')) link
        from jsonb_array_elements(coalesce(previous.card->'relatedSources','[]') ||
          case when previous.card is null then '[]'::jsonb else jsonb_build_array(previous.card->'source') end ||
          coalesce(entry->'relatedSources','[]')) as links(link)
        where link->>'url' is not null and rtrim(link->>'url','/')<>rtrim(job.url,'/')
        order by rtrim(link->>'url','/') limit 12
      ) links;
      entry:=entry || jsonb_build_object('name',canonical_name,'verifiedAt',now(),'relatedSources',merged);
      insert into public.fishing_spot_leads(city,name,card,catalog_status,verified_at,valid_until)
        values(job.city,canonical_name,entry,'published',now(),now()+interval '14 days')
      on conflict(city,name) do update set card=excluded.card,catalog_status='published',verified_at=now(),valid_until=excluded.valid_until;
      perform public.fishing_store_spot_lead_point(job.city,canonical_name,
        (entry->'sourcePosition'->>'longitude')::double precision,(entry->'sourcePosition'->>'latitude')::double precision);
    end loop;
    update public.fishing_spot_leads l set catalog_status='review'
      where l.city=job.city and l.card->'source'->>'url'=job.url and l.catalog_status='published'
        and not exists(select 1 from jsonb_array_elements(result->'cards') as cards(c) where c->>'poiId'=l.card->>'poiId');
  elsif state_name in ('review','blocked') then
    update public.fishing_spot_leads set catalog_status=case when result->>'reason' in ('fishing_restriction','source_http_404','source_http_410','venue_closed') then 'withdrawn' else 'review' end
    where city=job.city and card->'source'->>'url'=job.url;
  end if;
  update fishing_private.spot_source_jobs set state=state_name,lease=null,lease_until=null,checked_at=now(),
    reason=coalesce(result->>'reason',''),http_status=coalesce((result->>'httpStatus')::integer,0),
    content_hash=coalesce(result->>'hash',''),result_count=coalesce(jsonb_array_length(result->'cards'),0),
    next_check=now()+case when state_name='failed' then least(interval '7 days',interval '10 minutes'*power(2,least(attempts,10)))
      when state_name='published' then interval '7 days' else interval '30 days' end
    where id=job_id;
  return true;
end $$;
