create function public.fishing_publish_spot_leads(cards jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $publish$
declare
  changed integer;
begin
  if jsonb_typeof(cards) is distinct from 'array' then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  if jsonb_array_length(cards) not between 1 and 6 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  insert into public.fishing_spot_leads as lead (city, name, card)
  select card->>'city', card->>'name', card
  from jsonb_array_elements(cards) as incoming(card)
  on conflict (city, name) do update
  set card = lead.card || jsonb_build_object(
    'relatedSources',
    (
      select jsonb_agg(distinct_links.link order by distinct_links.position)
      from (
        select distinct on (rtrim(links.link->>'url', '/')) links.link, links.position
        from jsonb_array_elements(
          coalesce(lead.card->'relatedSources', '[]'::jsonb) ||
          jsonb_build_array(excluded.card->'source') ||
          coalesce(excluded.card->'relatedSources', '[]'::jsonb)
        ) with ordinality as links(link, position)
        where rtrim(links.link->>'url', '/') <> rtrim(lead.card->'source'->>'url', '/')
        order by rtrim(links.link->>'url', '/'), links.position
      ) as distinct_links
    )
  )
  where exists (
    select 1 from jsonb_array_elements(
      jsonb_build_array(excluded.card->'source') || coalesce(excluded.card->'relatedSources', '[]'::jsonb)
    ) as new_links(link)
    where not exists (
      select 1 from jsonb_array_elements(
        jsonb_build_array(lead.card->'source') || coalesce(lead.card->'relatedSources', '[]'::jsonb)
      ) as current_links(link)
      where rtrim(new_links.link->>'url', '/') = rtrim(current_links.link->>'url', '/')
    )
  );

  get diagnostics changed = row_count;
  return changed;
end;
$publish$;

revoke all on function public.fishing_publish_spot_leads(jsonb) from public, anon, authenticated;
grant execute on function public.fishing_publish_spot_leads(jsonb) to service_role;
