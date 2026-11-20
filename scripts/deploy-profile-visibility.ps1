# Confirmed-project, ordered avatar visibility migration. No credentials printed.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'private-supabase-cli.ps1')
$projectRoot=Split-Path -Parent $PSScriptRoot
if(([IO.File]::ReadAllText((Join-Path $projectRoot 'supabase/.temp/project-ref'))).Trim() -ne 'tlfmfokyhahlpzmpliad'){throw 'Unexpected project'}
$version='20261120102600';$name='fishing_avatar_visibility'
$history=Invoke-FishingPrivateCli -Arguments @('db','query','--linked','--output','json',"select version from supabase_migrations.schema_migrations where version='$version';") | ConvertFrom-Json
if(@($history.rows).Count -gt 0){Write-Output 'Avatar visibility migration already applied';exit 0}
$source=[IO.File]::ReadAllText((Join-Path $projectRoot "supabase/migrations/${version}_${name}.sql"))
$tag='$avatar_visibility_source$'
if($source.Contains($tag)){throw 'Delimiter collision'}
$sql="begin;`n$source`ninsert into supabase_migrations.schema_migrations(version,name,statements) values('$version','$name',array[$tag$source$tag]);`ncommit;"
$dir=Join-Path $projectRoot 'artifacts/database-deployment'
$null=New-Item -ItemType Directory -Path $dir -Force
$path=Join-Path $dir "${version}_${name}.sql"
[IO.File]::WriteAllText($path,$sql,[Text.UTF8Encoding]::new($false))
$null=Invoke-FishingPrivateCli -Arguments @('db','query','--linked','--file',$path,'--output','json')
Write-Output 'Applied ordered avatar visibility migration to confirmed project'
