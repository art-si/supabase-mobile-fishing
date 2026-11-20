# Real project acceptance with one temporary identity and two synthetic photos.
# Never sends SMS, email, public content, or a report to an authority.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
. (Join-Path $PSScriptRoot 'private-supabase-cli.ps1')
$root = Split-Path -Parent $PSScriptRoot
$project = 'tlfmfokyhahlpzmpliad'
$origin = "https://$project.supabase.co"
$runId = [guid]::NewGuid().ToString()
$email = "dyj-cleanup-$runId@example.invalid"
$password = [guid]::NewGuid().ToString('N')+'aA!9'
$userId = $null; $token = $null; $serverKey = $null; $finished = $false; $cleaned = $false
$stage = 'credentials'
$checks = [Collections.Generic.List[string]]::new()
$artifact = Join-Path $root 'artifacts/media-cleanup-live'
$null = New-Item -ItemType Directory -Path $artifact -Force
$journal = Join-Path $artifact "$runId.json"
function Journal([string]$State) {
  @{project=$project;run=$runId;email=$email;user_id=$userId;state=$State;stage=$stage;checks=@($checks)} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $journal -Encoding utf8
}
function Check([bool]$Valid,[string]$Name) { if(!$Valid){throw 'Acceptance assertion failed'}; $checks.Add($Name); Write-Output "PASS $Name" }
function Sql([string]$Query) {
  $private = Invoke-FishingPrivateCli -Arguments @('db','query','--linked','--output','json',$Query)
  try { $data = $private | ConvertFrom-Json } catch { throw 'Private SQL result invalid' }
  if ($data.PSObject.Properties['rows']) { return @($data.rows) }
  return @($data)
}
function Api([string]$Method,[string]$Path,$Body=$null,[switch]$Admin,[string]$ContentType='application/json') {
  if(!$Path.StartsWith('/') -or $Path.StartsWith('//')){throw 'Invalid API path'}
  $headers = @{apikey=$publicKey}
  if($Admin){$headers.apikey=$serverKey;$headers.Authorization="Bearer $serverKey"}elseif($token){$headers.Authorization="Bearer $token"}
  $requestOptions=@{Uri=$origin+$Path;Method=$Method;Headers=$headers;SkipHttpErrorCheck=$true;TimeoutSec=35;MaximumRedirection=0}
  if($null -ne $Body){
    [byte[]]$wireBytes=if($Body -is [byte[]]){$Body}else{[Text.Encoding]::UTF8.GetBytes(($Body|ConvertTo-Json -Depth 8 -Compress))}
    $requestOptions.Body=$wireBytes
    $requestOptions.ContentType=$ContentType
  }
  try {$response=Invoke-WebRequest @requestOptions}catch{throw 'Remote request did not finish; private diagnostics withheld'}
  if([int]$response.StatusCode -lt 200 -or [int]$response.StatusCode -ge 300){throw "Remote request returned HTTP $([int]$response.StatusCode)"}
  if($response.Content){try{return ($response.Content|ConvertFrom-Json)}catch{throw 'Remote response invalid'}}
}
function UploadSynthetic {
  Add-Type -AssemblyName System.Drawing
  $bitmap=[Drawing.Bitmap]::new(64,48);$graphics=[Drawing.Graphics]::FromImage($bitmap);$stream=[IO.MemoryStream]::new()
  try{$graphics.Clear([Drawing.Color]::SeaGreen);$bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png);$bytes=$stream.ToArray()}finally{$graphics.Dispose();$bitmap.Dispose();$stream.Dispose()}
  $boundary='cleanup-'+[guid]::NewGuid().ToString('N')
  $prefix=[Text.Encoding]::ASCII.GetBytes("--$boundary`r`nContent-Disposition: form-data; name=`"file`"; filename=`"synthetic.png`"`r`nContent-Type: image/png`r`n`r`n")
  $suffix=[Text.Encoding]::ASCII.GetBytes("`r`n--$boundary--`r`n")
  return Api POST '/functions/v1/media-upload' ([byte[]]($prefix+$bytes+$suffix)) -ContentType "multipart/form-data; boundary=$boundary"
}
function AwaitDone([string]$AssetId) {
  for($attempt=0;$attempt -lt 12;$attempt++){
    $state=@(Sql "select state,owner_id is null and path is null as scrubbed from fishing_private.media_deletions where id='$AssetId'::uuid")
    if($state.Count -eq 1 -and $state[0].state -eq 'done'){return $state[0].scrubbed}
    Start-Sleep -Milliseconds 1000
  }
  throw 'Worker did not acknowledge deletion'
}
Journal 'starting'
try {
  $environment=@{};Get-Content -LiteralPath (Join-Path $root '.env.local')|ForEach-Object{if($_ -match '^([A-Z_]+)=(.*)$'){$environment[$matches[1]]=$matches[2].Trim()}}
  if($environment.VITE_SUPABASE_URL -ne $origin){throw 'Unconfirmed frontend project'}
  $publicKey=$environment.VITE_SUPABASE_KEY
  $keyOutput=Invoke-FishingPrivateCli -Arguments @('projects','api-keys','--project-ref',$project,'--output','json')
  try{$keyRows=$keyOutput|ConvertFrom-Json}catch{throw 'Private key lookup invalid'}
  $serverKey=($keyRows|Where-Object name -eq 'service_role').api_key
  if(!$serverKey){throw 'Missing server credential'}
  $stage='create-test-identity'
  $created=Api POST '/auth/v1/admin/users' @{email=$email;password=$password;email_confirm=$true;app_metadata=@{fishing_cleanup_run=$runId}} -Admin
  $userId=[string]$created.id
  if($userId -notmatch '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'){throw 'Invalid test identity'}
  Journal 'running'
  $session=Api POST '/auth/v1/token?grant_type=password' @{email=$email;password=$password}
  $token=$session.access_token
  $stage='upload-synthetic-photos'
  $evidence=UploadSynthetic
  $draft=UploadSynthetic
  foreach($media in @($evidence,$draft)){if($media.id -notmatch '^[a-f0-9-]{36}$' -or $media.path -ne "$userId/$($media.id).jpg"){throw 'Unexpected upload identity'}}
  $reportId=[guid]::NewGuid().ToString()
  $stage='save-private-report'
  $report=@{id=$reportId;category='electric';province='江苏省';city='苏州市';district='';location_label='清理验收虚构地点';observed_at=[DateTime]::UtcNow.AddMinutes(-10).ToString('o');description='系统私密清理验收，不是真实线索，不发送';media=@(@{id=$evidence.id});consent_version='2026-11-19-water-v1'}
  $null=Api POST '/rest/v1/rpc/fishing_write' @{action='save_water_report';payload=$report}
  $before=@(Sql "select count(*)::int as n from storage.objects where bucket_id='fishing-media' and name in ('$($evidence.path)','$($draft.path)')")
  Check ($before[0].n -eq 2) 'two real private Storage objects exist'
  $stage='delete-private-report'
  $null=Api POST '/rest/v1/rpc/fishing_write' @{action='delete_water_report';payload=@{id=$reportId}}
  $queued=@(Sql "select (select count(*) from public.media_assets where id='$($evidence.id)')::int as live,(select state from fishing_private.media_deletions where id='$($evidence.id)') as state,(select count(*) from storage.objects where bucket_id='fishing-media' and name='$($evidence.path)')::int as physical")
  Check ($queued[0].live -eq 0 -and $queued[0].state -eq 'pending' -and $queued[0].physical -eq 1) 'committed user deletion enqueues the still-present blob'
  $stage='dispatch-worker'
  $null=Sql 'select fishing_private.dispatch_media_cleanup() as request_id'
  Check (AwaitDone $evidence.id) 'authenticated worker acknowledges Storage deletion and scrubs private queue fields'
  $after=@(Sql "select (select count(*) from storage.objects where bucket_id='fishing-media' and name='$($evidence.path)')::int as deleted,(select count(*) from storage.objects where bucket_id='fishing-media' and name='$($draft.path)')::int as draft_blob,(select count(*) from public.media_assets where id='$($draft.id)' and post_id is null and report_id is null)::int as draft_index")
  Check ($after[0].deleted -eq 0 -and $after[0].draft_blob -eq 1 -and $after[0].draft_index -eq 1) 'deleted evidence is physically gone; unsubmitted upload is preserved'
  $finished=$true
} catch {
  Write-Output "Media cleanup acceptance stopped at $stage; private diagnostics withheld."
  if ($_.Exception.Message -match '^Remote request returned HTTP \d{3}$') { Write-Output $_.Exception.Message }
  else { Write-Output ("Exception category: " + $_.Exception.GetType().Name) }
} finally {
  if($userId -and $serverKey){
    try {
      $stage='clean-test-identity'
      $identity=Api GET "/auth/v1/admin/users/$userId" -Admin
      if($identity.email -ne $email -or $identity.app_metadata.fishing_cleanup_run -ne $runId){throw 'Test ownership mismatch'}
      if(!$token){$session=Api POST '/auth/v1/token?grant_type=password' @{email=$email;password=$password};$token=$session.access_token}
      $null=Api POST '/auth/v1/logout?scope=global' @{}
      $objects=@(Api POST '/storage/v1/object/list/fishing-media' @{prefix="$userId/";limit=20;offset=0} -Admin)
      $paths=@($objects|Where-Object id|ForEach-Object{if($_.name -notmatch '^[a-f0-9-]{36}\.(jpg|mp4)$'){throw 'Unexpected object name'};"$userId/$($_.name)"})
      if($paths.Count){$null=Api DELETE '/storage/v1/object/fishing-media' @{prefixes=$paths} -Admin}
      $null=Api DELETE "/auth/v1/admin/users/$userId" @{should_soft_delete=$false} -Admin
      $null=Sql 'select fishing_private.dispatch_media_cleanup() as request_id'
      if($draft){$null=AwaitDone $draft.id}
      $remaining=@(Sql "select (select count(*) from auth.users where id='$userId')::int as users,(select count(*) from storage.objects where bucket_id='fishing-media' and name like '$userId/%')::int as objects,(select count(*) from public.media_assets where owner_id='$userId')::int as media")
      $cleaned=$remaining[0].users -eq 0 -and $remaining[0].objects -eq 0 -and $remaining[0].media -eq 0
      if(!$cleaned){throw 'Test cleanup readback incomplete'}
      Write-Output 'PASS temporary identity, sessions and exact test files removed'
    }catch{Write-Output 'Exact test cleanup needs follow-up; see the identity-only journal.'}
  }
  Journal $(if(!$cleaned){'cleanup-required'}elseif($finished){'passed-cleaned'}else{'failed-cleaned'})
  $token=$null;$serverKey=$null;$password=$null;$keyOutput=$null;$keyRows=$null;$session=$null
}
if(!$finished -or !$cleaned){exit 1}
