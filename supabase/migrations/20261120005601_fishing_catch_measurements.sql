-- Optional catch facts. Unknown stays NULL; zero tails is a recorded blank outing.
-- Clients convert jin to kg; the API only accepts canonical kg/cm/tails.
alter table public.posts add column count integer check(count between 0 and 10000),
  add column length_cm numeric check(length_cm between 0 and 10000);
-- Preserve entered decimals rather than rounding a small catch to zero (including jin / 2).
-- Existing range constraints and recorded post weights remain unchanged.
alter table public.posts alter column weight_kg type numeric;
drop trigger trips_summarize_catches on public.trips;
alter table public.trips alter column weight_kg type numeric;
create trigger trips_summarize_catches before insert or update of catch_records, species, count, weight_kg
  on public.trips for each row execute function fishing_private.summarize_trip_catches();
-- Repair only summaries whose earlier numeric(10,3) storage rounded the authoritative rows.
update public.trips t set catch_records=t.catch_records,revision=t.revision+1
where t.weight_kg is distinct from (
  select case when count(item->>'weight_kg')=jsonb_array_length(t.catch_records)
    and jsonb_array_length(t.catch_records)>0 then sum((item->>'weight_kg')::numeric) end
  from jsonb_array_elements(t.catch_records) item
);

create function fishing_private.post_catch_fields(payload jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare field text; raw text; amount numeric; result jsonb:='{}'; output_key text;
begin
  foreach field in array array['weight','count','length'] loop
    -- Omitted new fields from older clients preserve existing values during edits.
    if field<>'weight' and not(payload ? field) then continue;end if;
    if coalesce(jsonb_typeof(payload->field),'null') not in ('string','number','null') then
      raise exception 'INVALID_INPUT';
    end if;
    raw:=nullif(trim(payload->>field),'');
    if raw is not null and raw !~ '^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$' then
      raise exception 'INVALID_INPUT';
    end if;
    amount:=raw::numeric;
    if amount is not null and (not(amount between 0 and 10000)
      or (field='count' and amount<>trunc(amount))) then raise exception 'INVALID_INPUT';end if;
    output_key:=case field when 'weight' then 'weight_kg' when 'length' then 'length_cm' else 'count' end;
    result:=result||jsonb_build_object(output_key,amount);
  end loop;
  return result;
end $$;
revoke all on function fishing_private.post_catch_fields(jsonb) from public,anon,authenticated,service_role;

-- Keep existing authentication, ownership, revision/idempotency and moderation gates intact.
-- Exact anchors fail closed if an earlier migration changed a protected command.
do $$
declare patch record; source text;
begin
  for patch in select * from (values
    ('fishing_private.validate_composition(text,jsonb)',
      $old$  foreach field in array array['title','body'] loop$old$,
      $new$  if content_type='post' then perform fishing_private.post_catch_fields(payload);end if;
  foreach field in array array['title','body'] loop$new$),
    ('fishing_private.write_api(text,jsonb)',
      $old$insert into public.posts(id,author_id,title,body,kind,species,method,bait,weight_kg,occurred_on,location_label,audience,status)$old$,
      $new$insert into public.posts(id,author_id,title,body,kind,species,method,bait,count,length_cm,weight_kg,occurred_on,location_label,audience,status)$new$),
    ('fishing_private.write_api(text,jsonb)',
      $old$coalesce(payload->>'bait',''),nullif(payload->>'weight','')::numeric,(payload->>'occurred_on')::date,coalesce(payload->>'location_label','')$old$,
      $new$coalesce(payload->>'bait',''),(fishing_private.post_catch_fields(payload)->>'count')::numeric::integer,(fishing_private.post_catch_fields(payload)->>'length_cm')::numeric,(fishing_private.post_catch_fields(payload)->>'weight_kg')::numeric,(payload->>'occurred_on')::date,coalesce(payload->>'location_label','')$new$),
    ('fishing_private.author_write(text,jsonb)',
      $old$bait = coalesce(payload->>'bait',''), weight_kg = nullif(payload->>'weight','')::numeric,$old$,
      $new$bait = coalesce(payload->>'bait',''), weight_kg = (fishing_private.post_catch_fields(payload)->>'weight_kg')::numeric,
          count = case when payload ? 'count' then (fishing_private.post_catch_fields(payload)->>'count')::numeric::integer else count end,
          length_cm = case when payload ? 'length' then (fishing_private.post_catch_fields(payload)->>'length_cm')::numeric else length_cm end,$new$),
    ('fishing_private.content_update_fields(text,jsonb)',
      $old$weight numeric(10,3);$old$,$new$weight numeric;$new$),
    ('fishing_private.content_update_fields(text,jsonb)',
      $old$weight:=nullif(payload->>'weight','')::numeric;$old$,
      $new$weight:=(fishing_private.post_catch_fields(payload)->>'weight_kg')::numeric;$new$),
    ('fishing_private.content_update_fields(text,jsonb)',
      $old$    for key,max_length in select * from (values('species',60),('method',40)$old$,
      $new$    fields:=fields||fishing_private.post_catch_fields(payload);
    for key,max_length in select * from (values('species',60),('method',40)$new$),
    ('fishing_private.install_content_update(text,uuid,jsonb)',
      $old$bait=fields->>'bait',weight_kg=(fields->>'weight_kg')::numeric,$old$,
      $new$bait=fields->>'bait',weight_kg=(fields->>'weight_kg')::numeric,
      count=case when fields ? 'count' then (fields->>'count')::numeric::integer else count end,
      length_cm=case when fields ? 'length_cm' then (fields->>'length_cm')::numeric else length_cm end,$new$),
    ('fishing_private.review_item(text,uuid)',
      $old$'details',jsonb_build_object('鱼种',p.species,'钓法',p.method,$old$,
      $new$'details',jsonb_build_object('尾数',p.count::text,'总重量（kg）',p.weight_kg::text,'鱼长（cm）',p.length_cm::text,'鱼种',p.species,'钓法',p.method,$new$),
    ('fishing_private.content_update_review(text,uuid)',
      $old$'details',jsonb_build_object('鱼种',fields->>'species','钓法',fields->>'method',$old$,
      $new$'details',jsonb_build_object(
        '尾数',case when fields ? 'count' then fields->>'count' else current_item->'details'->>'尾数' end,
        '鱼长（cm）',case when fields ? 'length_cm' then fields->>'length_cm' else current_item->'details'->>'鱼长（cm）' end,
        '总重量（kg）',fields->>'weight_kg','鱼种',fields->>'species','钓法',fields->>'method',$new$)
  ) changes(function_name,old_text,new_text) loop
    source:=pg_get_functiondef(patch.function_name::regprocedure);
    if strpos(source,patch.old_text)=0 or
      (length(source)-length(replace(source,patch.old_text,'')))/length(patch.old_text)<>1 then
      raise exception 'CATCH_MEASUREMENTS_ANCHOR: %',patch.function_name;
    end if;
    execute replace(source,patch.old_text,patch.new_text);
  end loop;
end $$;
