-- Qualify the rate-event column: the write API also has an `action` parameter.
-- Preserve the existing user lock, caller checks, quotas and all other actions.
do $$
declare
  definition text := pg_get_functiondef('fishing_private.write_api(text,jsonb)'::regprocedure);
  original text := 'from fishing_private.rate_events where user_id=uid and action=''upload_ticket'' and created_at>now()-interval ''1 day''';
  corrected text := 'from fishing_private.rate_events re where re.user_id=uid and re.action=''upload_ticket'' and re.created_at>now()-interval ''1 day''';
begin
  if position(original in definition) = 0 then
    raise exception 'Unexpected upload-ticket definition; inspect before migrating';
  end if;
  execute replace(definition, original, corrected);
end;
$$;
