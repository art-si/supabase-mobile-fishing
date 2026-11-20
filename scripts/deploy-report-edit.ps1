$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'private-supabase-cli.ps1')
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = '20261120102700'
$name = 'fishing_water_report_edit'
$directory = Join-Path $projectRoot 'artifacts/report-edit-deployment'
$null = New-Item -ItemType Directory -Path $directory -Force
$history = Invoke-FishingPrivateCli -Arguments @('db','query','--linked','--output','json',"select version from supabase_migrations.schema_migrations where version >= '20261120102600' order by version;") | ConvertFrom-Json
if ($version -notin @($history.rows | ForEach-Object { $_.version })) {
  if ('20261120102600' -notin @($history.rows | ForEach-Object { $_.version })) { throw 'Required avatar parent-ownership migration is missing' }
  $sql = [IO.File]::ReadAllText((Join-Path $projectRoot "supabase/migrations/${version}_${name}.sql"))
  $delimiter = '$report_edit_migration$'
  if ($sql.Contains($delimiter)) { throw 'Migration quote delimiter collision' }
  $transaction = "begin;`n$sql`ninsert into supabase_migrations.schema_migrations(version,name,statements) values('$version','$name',array[$delimiter$sql$delimiter]);`ncommit;"
  $queryPath = Join-Path $directory 'apply.sql'
  [IO.File]::WriteAllText($queryPath, $transaction, [Text.UTF8Encoding]::new($false))
  $null = Invoke-FishingPrivateCli -Arguments @('db','query','--linked','--file',$queryPath,'--output','json')
  Write-Output 'Applied private report editing migration'
} else { Write-Output 'Private report editing migration already applied' }
$query = @'
select
 exists(select 1 from information_schema.columns where table_schema='public' and table_name='water_reports' and column_name='revision') as revision_ready,
 position('update_water_report' in pg_get_functiondef('fishing_private.write_api(text,jsonb)'::regprocedure))>0 as edit_dispatch_ready,
 position('expected_revision' in pg_get_functiondef('fishing_private.update_water_report(jsonb)'::regprocedure))>0 as concurrency_guard_ready,
 position('owner_id=uid' in pg_get_functiondef('fishing_private.update_water_report(jsonb)'::regprocedure))>0 as owner_guard_ready,
 (select relrowsecurity from pg_class where oid='fishing_private.water_report_edit_receipts'::regclass) as receipt_rls_enabled,
 not has_function_privilege('anon','fishing_private.update_water_report(jsonb)','execute') as anonymous_private_function_denied,
 not has_function_privilege('authenticated','fishing_private.update_water_report(jsonb)','execute') as direct_private_function_denied,
 (select max(version) from supabase_migrations.schema_migrations) as latest_migration;
'@
$result = Invoke-FishingPrivateCli -Arguments @('db','query','--linked','--output','json',$query)
[IO.File]::WriteAllText((Join-Path $directory 'readback.json'),$result,[Text.UTF8Encoding]::new($false))
$result
