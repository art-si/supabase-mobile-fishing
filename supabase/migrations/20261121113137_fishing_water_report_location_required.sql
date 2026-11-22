-- Earlier clients supplied this value only after their separate confirmation.
-- Direct saves omit it. Retain the existing value on historical records.
alter table public.water_reports
  alter column consent_version drop not null,
  add constraint water_reports_saved_coordinates_required
    check (status <> 'saved' or (longitude is not null and latitude is not null))
    not valid;

-- Existing reports without a point stay readable. New writes must satisfy this
-- check and the existing longitude/latitude range checks. Deletion clears both.
do $migration$
declare
  routine regprocedure;
  original text;
  revised text;
begin
  foreach routine in array array[
    'fishing_private.water_report_write(text,jsonb)'::regprocedure,
    'fishing_private.update_water_report(jsonb)'::regprocedure
  ] loop
    original := pg_get_functiondef(routine);
    revised := regexp_replace(original,
      $pattern$  if payload->>'consent_version' is distinct from '2026-11-19-water-v1' then raise exception 'REPORT_CONSENT_REQUIRED';[[:blank:]]*end if;[[:space:]]*$pattern$,
      '');
    if original = revised then
      raise exception 'Could not locate previous consent check in %', routine;
    end if;
    execute revised;
  end loop;
end
$migration$;
