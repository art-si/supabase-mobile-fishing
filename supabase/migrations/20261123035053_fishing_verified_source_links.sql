-- A verified place must not inherit unchecked legacy links as supporting proof.
create function fishing_private.filter_verified_spot_links() returns trigger
language plpgsql security invoker set search_path='' as $$
declare links jsonb;
begin
  if new.catalog_status='published' then
    select coalesce(jsonb_agg(link order by position),'[]') into links
    from jsonb_array_elements(coalesce(new.card->'relatedSources','[]')) with ordinality as s(link,position)
    where exists(select 1 from fishing_private.spot_source_jobs j
      where j.city=new.city and rtrim(j.url,'/')=rtrim(link->>'url','/')
        and j.state='published' and j.checked_at>now()-interval '14 days');
    new.card:=jsonb_set(new.card,'{relatedSources}',links);
  end if;
  return new;
end $$;
revoke all on function fishing_private.filter_verified_spot_links() from public,anon,authenticated;
grant execute on function fishing_private.filter_verified_spot_links() to service_role;
create trigger fishing_spot_leads_verified_links before insert or update of card,catalog_status
  on public.fishing_spot_leads for each row execute function fishing_private.filter_verified_spot_links();

-- Recheck already-published metadata with the same rule; the verified location,
-- canonical name, interactions and primary evidence remain intact.
update public.fishing_spot_leads set card=card where catalog_status='published';
