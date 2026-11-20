-- City pickers store official names; legacy profiles may omit the trailing 市.
-- This affects the existing resident-city filter only, never content permissions.
do $migration$
declare source text; needle text;
begin
  source:=pg_get_functiondef('fishing_private.read_api(text,jsonb)'::regprocedure);
  needle:='author.city=coalesce(payload->>''city'','''')';
  if position(needle in source)=0 then raise exception 'CITY_FILTER_PATCH_MISMATCH';end if;
  execute replace(source,needle,$patch$regexp_replace(trim(author.city),'市$','')=regexp_replace(trim(coalesce(payload->>'city','')),'市$','')$patch$);
end $migration$;
