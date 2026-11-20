$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'private-supabase-cli.ps1')
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = '20261120102800'
$name = 'fishing_comment_media'
$directory = Join-Path $projectRoot 'artifacts/comment-media-deployment'
$null = New-Item -ItemType Directory -Path $directory -Force
$history = Invoke-FishingPrivateCli -Arguments @('db','query','--linked','--output','json',"select version from supabase_migrations.schema_migrations where version >= '20261120102700' order by version;") | ConvertFrom-Json
if ($version -notin @($history.rows | ForEach-Object { $_.version })) {
  if ('20261120102700' -notin @($history.rows | ForEach-Object { $_.version })) { throw 'Required report editing migration is missing' }
  $sql = [IO.File]::ReadAllText((Join-Path $projectRoot "supabase/migrations/${version}_${name}.sql"))
  $delimiter = '$comment_media_migration$'
  if ($sql.Contains($delimiter)) { throw 'Migration quote delimiter collision' }
  $transaction = "begin;`n$sql`ninsert into supabase_migrations.schema_migrations(version,name,statements) values('$version','$name',array[$delimiter$sql$delimiter]);`ncommit;"
  $queryPath = Join-Path $directory 'apply.sql'
  [IO.File]::WriteAllText($queryPath, $transaction, [Text.UTF8Encoding]::new($false))
  $null = Invoke-FishingPrivateCli -Arguments @('db','query','--linked','--file',$queryPath,'--output','json')
  Write-Output 'Applied comment media migration'
} else { Write-Output 'Comment media migration already applied' }
$query = @'
select
 exists(select 1 from information_schema.columns where table_schema='public' and table_name='media_assets' and column_name='comment_id') as attachment_parent_ready,
 position('comment_id' in pg_get_constraintdef((select oid from pg_constraint where conrelid='public.media_assets'::regclass and conname='media_single_parent')))>0 as exclusive_parent_ready,
 position('COMMENT_REQUEST_REUSED' in pg_get_functiondef('fishing_private.comment_write(text,jsonb)'::regprocedure))>0 as idempotent_write_ready,
 position('can_view_comment_media' in pg_get_functiondef('fishing_private.can_view_media(uuid)'::regprocedure))>0 as media_visibility_ready,
 position('comment_media' in pg_get_functiondef('fishing_private.comment_json(uuid)'::regprocedure))>0 as comment_projection_ready,
 exists(select 1 from pg_trigger where tgrelid='public.comments'::regclass and tgname='comments_cleanup_media' and tgenabled='O') as comment_cleanup_ready,
 exists(select 1 from pg_trigger where tgrelid='public.posts'::regclass and tgname='posts_cleanup_comment_media' and tgenabled='O') as post_cleanup_ready,
 not has_function_privilege('anon','fishing_private.comment_write(text,jsonb)','execute') as anonymous_private_write_denied,
 not has_function_privilege('authenticated','fishing_private.comment_media(uuid)','execute') as direct_private_media_denied,
 (select max(version) from supabase_migrations.schema_migrations) as latest_migration;
'@
$result = Invoke-FishingPrivateCli -Arguments @('db','query','--linked','--output','json',$query)
[IO.File]::WriteAllText((Join-Path $directory 'readback.json'),$result,[Text.UTF8Encoding]::new($false))
$result
