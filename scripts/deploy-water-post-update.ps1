# Confirmed-project maintenance only. No credentials or content are printed.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'private-supabase-cli.ps1')
$projectRoot = Split-Path -Parent $PSScriptRoot
$migrationNames = @(
  '20261120102000_fishing_water_fences.sql',
  '20261120102100_fishing_verified_official_fences.sql',
  '20261120102200_fishing_posts_direct_publish.sql',
  '20261120102300_fishing_profile_avatar.sql',
  '20261120102400_fishing_report_mixed_media.sql',
  '20261120102500_fishing_city_names.sql',
  '20261120102600_fishing_avatar_visibility.sql'
)
$deployDirectory = Join-Path $projectRoot 'artifacts/database-deployment'
$null = New-Item -ItemType Directory -Path $deployDirectory -Force
$history = Invoke-FishingPrivateCli -Arguments @('db','query','--linked','--output','json',"select version from supabase_migrations.schema_migrations where version between '20261120102000' and '20261120102600';") | ConvertFrom-Json
$appliedVersions = @($history.rows | ForEach-Object { $_.version })
foreach ($migrationName in $migrationNames) {
  $migrationPath = Join-Path $projectRoot "supabase/migrations/$migrationName"
  $migrationSql = [IO.File]::ReadAllText($migrationPath)
  if ($migrationName -notmatch '^(\d+)_(.+)\.sql$') { throw 'Invalid migration filename' }
  $version = $matches[1]
  $name = $matches[2]
  if ($version -in $appliedVersions) { Write-Output "Already applied $migrationName"; continue }
  $historyTag = '$migration_source_' + $version + '$'
  if ($migrationSql.Contains($historyTag)) { throw 'Migration quote delimiter collision' }
  $transaction = "begin;`n$migrationSql`ninsert into supabase_migrations.schema_migrations(version,name,statements) values('$version','$name',array[$historyTag$migrationSql$historyTag]);`ncommit;"
  $queryPath = Join-Path $deployDirectory $migrationName
  [IO.File]::WriteAllText($queryPath, $transaction, [Text.UTF8Encoding]::new($false))
  $null = Invoke-FishingPrivateCli -Arguments @('db','query','--linked','--file',$queryPath,'--output','json')
  Write-Output "Applied $migrationName"
}
