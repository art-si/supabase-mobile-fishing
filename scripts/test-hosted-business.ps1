# Isolated acceptance on the confirmed project. No SMS, email, public posts or authority delivery.
# Admin credentials stay in this PowerShell process; business requests use real user tokens.
# The ignored journal records only exact test identities, never credentials or private bodies.
[CmdletBinding()]
param([ValidateSet('h5-amap','avatar','spot-discussion','h5-spot-photos','video','all','core','private-core','social','report','orientation','photo-capacity','photo-guard','h5-large-photo','h5-media','h5-social','h5-chat-attachments','h5-realtime','h5-zones','h5-trip-catches','h5-comments','h5-comment-moderation','h5-notifications','h5-composition','h5-content-updates','h5-report','h5-report-manual')][string]$Suite='all', [string]$CleanupRun, [switch]$SessionsRevoked)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$fishingRoot = Split-Path -Parent $PSScriptRoot
$projectRef = 'jupuypvmgjpnpntfetqv'
$projectUrl = "https://$projectRef.supabase.co"
$config = @{}
Get-Content -LiteralPath (Join-Path $fishingRoot '.env.local') | ForEach-Object {
  if ($_ -match '^([A-Z_]+)=(.*)$') { $config[$matches[1]] = $matches[2].Trim() }
}
if ($config.VITE_SUPABASE_URL -ne $projectUrl -or !$config.VITE_SUPABASE_KEY.StartsWith('sb_publishable_')) {
  throw 'Unconfirmed project or non-public client credential'
}
$cli = [Diagnostics.Process]::new()
$cli.StartInfo.FileName = (Get-Command supabase -CommandType Application).Source
$cli.StartInfo.UseShellExecute = $false
$cli.StartInfo.CreateNoWindow = $true
$cli.StartInfo.RedirectStandardOutput = $true
$cli.StartInfo.RedirectStandardError = $true
# Match PowerShell's configured system proxy for this child only. Go's CLI does not
# automatically use Windows proxy settings; never change global network settings.
if (!$env:HTTPS_PROXY) {
  $managementUri=[uri]'https://api.supabase.com'
  $managementProxy=[Net.WebRequest]::GetSystemWebProxy().GetProxy($managementUri)
  if ($managementProxy -ne $managementUri) { $cli.StartInfo.Environment['HTTPS_PROXY']=$managementProxy.AbsoluteUri }
}
@('projects','api-keys','--project-ref',$projectRef,'--output','json','--dns-resolver','https') | ForEach-Object { $cli.StartInfo.ArgumentList.Add($_) }
try {
  $null = $cli.Start()
  $stdout = $cli.StandardOutput.ReadToEndAsync()
  $stderr = $cli.StandardError.ReadToEndAsync()
  if (!$cli.WaitForExit(30000)) { $cli.Kill($true); throw 'Credential lookup timed out; no remote writes started' }
  if ($cli.ExitCode -ne 0) { throw 'Cannot obtain server credential; output withheld' }
  $serverKey = (($stdout.GetAwaiter().GetResult() | ConvertFrom-Json) | Where-Object name -eq 'service_role').api_key
} finally { $cli.Dispose(); $stdout=$null; $stderr=$null }
if (!$serverKey) { throw 'No server-only service role credential available' }
$runId = [guid]::NewGuid().ToString()
$artifactDir = Join-Path $fishingRoot 'artifacts/hosted-business'
$null = New-Item -ItemType Directory -Path $artifactDir -Force
if (!$CleanupRun) {
  foreach ($existingJournal in Get-ChildItem -LiteralPath $artifactDir -File -Filter '*.json') {
    if ($existingJournal.BaseName -notmatch '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') { continue }
    $pending=Get-Content -LiteralPath $existingJournal.FullName -Raw | ConvertFrom-Json
    if ($pending.project -eq $projectRef -and ($pending.state -eq 'cleanup-required' -or $pending.needs_audit_readback)) {
      throw "Complete exact-run cleanup before starting another acceptance batch: $($existingJournal.BaseName)"
    }
  }
}
$journalPath = Join-Path $artifactDir "$runId.json"
$accounts = @('a', 'b', 'outsider') | ForEach-Object {
  @{ label=$_; email="dyj-accept-$runId-$_@example.invalid"; id=$null; password=([guid]::NewGuid().ToString('N') + 'aA!9'); token=$null; cleaned=$false }
}
$checks = [System.Collections.Generic.List[string]]::new()
if ($CleanupRun) {
  if (!$SessionsRevoked -or $CleanupRun -notmatch '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') {
    throw 'Recovery requires an exact run UUID and prior verified server-side session revocation'
  }
  $runId=$CleanupRun
  $journalPath=Join-Path $artifactDir "$runId.json"
  $previous=Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json
  if ($previous.project -ne $projectRef -or $previous.run -ne $runId -or $previous.state -ne 'cleanup-required') { throw 'Journal is not a pending cleanup for this project/run' }
  if ($previous.suite) { $Suite=$previous.suite }
  if ($previous.fixture) { $commentFixture=$previous.fixture }
  $accounts=@($previous.identities | ForEach-Object {
    if ($_.label -notin @('a','b','outsider') -or $_.email -ne "dyj-accept-$runId-$($_.label)@example.invalid") { throw 'Unexpected journal identity' }
    @{label=$_.label;email=$_.email;id=$_.id;cleaned=$_.cleaned;password=$null;token=$null}
  })
  foreach($label in $previous.checked) { $checks.Add($label) }
}
function Save-Journal([string]$State) {
  # Runtime evidence, not source. Explicit fields prevent accidental credential serialization.
  $journal=@{ project=$projectRef; run=$runId; suite=$Suite; state=$State; checked=@($checks.ToArray()); identities=@($accounts | ForEach-Object {
      @{ label=$_.label; email=$_.email; id=$_.id; cleaned=$_.cleaned }
    }) }
  if ($Suite -in @('h5-spot-photos','h5-comment-moderation','h5-notifications','h5-content-updates') -and $commentFixture) {
    $journal.fixture=@{post=$commentFixture.post;root=$commentFixture.root;reply=$commentFixture.reply;spot=$commentFixture.spot}
    $journal.needs_audit_readback=$true
  }
  $journal | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $journalPath -Encoding utf8
}
function Check([bool]$Condition, [string]$Label) {
  if (!$Condition) { throw "CHECK FAILED: $Label" }
  $checks.Add($Label)
  Save-Journal 'running'
  Write-Host "PASS $Label"
}
function Call-Api([string]$Method, [string]$Path, $Body=$null, [string]$Token='', [switch]$Admin, [string]$ContentType='application/json', [ValidateRange(1,60)][int]$TimeoutSec=20) {
  if (!$Path.StartsWith('/') -or $Path.StartsWith('//')) { throw 'Invalid local API path' }
  # Do not reuse a WebRequestSession across actors: it persists explicit headers.
  # A fresh request also avoids reusing a connection closed by the network gateway.
  $headers = @{ apikey=$config.VITE_SUPABASE_KEY }
  if ($Admin) { $headers.apikey=$serverKey; $headers.Authorization="Bearer $serverKey" }
  elseif ($Token) { $headers.Authorization="Bearer $Token" }
  $requestOptions = @{ Uri=$projectUrl+$Path; Method=$Method; Headers=$headers; SkipHttpErrorCheck=$true; TimeoutSec=$TimeoutSec; MaximumRedirection=0 }
  if ($null -ne $Body) {
    [byte[]]$wireBytes = if ($Body -is [byte[]]) { $Body } else { [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 12 -Compress)) }
    $requestOptions.Body = $wireBytes
    $requestOptions.ContentType = $ContentType
  }
  # Never blindly replay writes after an ambiguous network outcome.
  for($attempt=1; $attempt -le 2; $attempt++) {
    try { $reply = Invoke-WebRequest @requestOptions; break }
    catch {
      if ($Method -eq 'GET' -and $attempt -eq 1) { Start-Sleep -Milliseconds 250; continue }
      $reason=$_.Exception.GetType().Name
      throw "Transport failure ($Method, $reason); credential-bearing path/body withheld"
    }
  }
  $json = $null
  if ($reply.Headers['Content-Type'] -match 'json') {
    try { $json = $reply.Content | ConvertFrom-Json -Depth 20 -NoEnumerate } catch { throw 'Invalid API JSON; content withheld' }
  }
  return @{ status=[int]$reply.StatusCode; json=$json; bytes=$reply.RawContentStream.ToArray(); mime=[string]($reply.Headers['Content-Type'] -join ';') }
}
function Require-Ok($Reply, [string]$Label) {
  if ($Reply.status -lt 200 -or $Reply.status -ge 300) {
    $code = $Reply.json.error_code
    if (!$code) { $code = $Reply.json.code }
    # Codes only, never full Auth error bodies/tokens.
    if ($code -notmatch '^[A-Za-z_0-9]{1,60}$') { $code='withheld' }
    throw "$Label failed: HTTP $($Reply.status), code $code"
  }
  return ,$Reply.json
}
function Rpc($Account, [string]$Kind, [string]$Action, $Payload=@{}) {
  $token = if ($Account) { $Account.token } else { '' }
  return Call-Api POST "/rest/v1/rpc/fishing_$Kind" @{action=$Action;payload=$Payload} $token
}
function Success($Account, [string]$Kind, [string]$Action, $Payload=@{}) {
  return Require-Ok (Rpc $Account $Kind $Action $Payload) $Action
}
function Denied($Account, [string]$Kind, [string]$Action, $Payload, [string]$Code, [string]$Label) {
  $reply = Rpc $Account $Kind $Action $Payload
  Check ($reply.status -in @(400,401,403,404) -and $reply.json.message -eq $Code) $Label
}
function New-Photo([bool]$Oriented, [int]$Width=96, [int]$Height=64) {
  Add-Type -AssemblyName System.Drawing
  $bitmap = [Drawing.Bitmap]::new($Width,$Height)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $stream = [IO.MemoryStream]::new()
  try {
    $graphics.Clear([Drawing.Color]::SeaGreen)
    $graphics.FillRectangle([Drawing.Brushes]::Orange,0,0,[int]($Width/2),[int]($Height/2))
    $format = if ($Oriented) { [Drawing.Imaging.ImageFormat]::Jpeg } else { [Drawing.Imaging.ImageFormat]::Png }
    $bitmap.Save($stream,$format)
    $bytes = $stream.ToArray()
    if ($Oriented) {
      # APP1/Exif, little-endian TIFF, one SHORT orientation=6 (90deg clockwise).
      [byte[]]$exif = @(255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0)
      $withExif=[IO.MemoryStream]::new()
      try {
        $withExif.Write($bytes,0,2);$withExif.Write($exif,0,$exif.Length);$withExif.Write($bytes,2,$bytes.Length-2)
        $bytes=$withExif.ToArray()
      } finally { $withExif.Dispose() }
    }
    return ,$bytes
  } finally { $graphics.Dispose(); $bitmap.Dispose(); $stream.Dispose() }
}
function Upload($Account, [byte[]]$Bytes, [string]$Mime, [switch]$Raw, [switch]$Video) {
  $boundary = 'dyj-' + [guid]::NewGuid().ToString('N')
  $kindPart = if ($Video) { "--$boundary`r`nContent-Disposition: form-data; name=`"kind`"`r`n`r`nvideo`r`n" } else { '' }
  $prefix = [Text.Encoding]::ASCII.GetBytes("$kindPart--$boundary`r`nContent-Disposition: form-data; name=`"file`"; filename=`"acceptance`"`r`nContent-Type: $Mime`r`n`r`n")
  $suffix = [Text.Encoding]::ASCII.GetBytes("`r`n--$boundary--`r`n")
  [byte[]]$multipart = $prefix + $Bytes + $suffix
  $reply=Call-Api POST '/functions/v1/media-upload' $multipart $Account.token -ContentType "multipart/form-data; boundary=$boundary" -TimeoutSec 45
  if ($Raw) { return $reply }
  return Require-Ok $reply 'media upload'
}
function New-CapacityPhoto([int]$Width, [int]$Height) {
  # Synthetic textured photo: no personal photo, EXIF or location. Limited to the
  # three explicit cases below; this is functional acceptance, not a load test.
  Add-Type -AssemblyName System.Drawing
  $bitmap=[Drawing.Bitmap]::new($Width,$Height,[Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $stream=[IO.MemoryStream]::new()
  $rect=[Drawing.Rectangle]::new(0,0,$Width,$Height)
  $locked=$bitmap.LockBits($rect,[Drawing.Imaging.ImageLockMode]::WriteOnly,[Drawing.Imaging.PixelFormat]::Format24bppRgb)
  try {
    $stride=$locked.Stride
    $buffer=[byte[]]::new($stride*$Height)
    # Fill a reusable deterministic texture. RGB variation exercises real codec
    # work; a huge single-color PNG would not resemble a normal upload workload.
    $random=[Random]::new(173)
    $random.NextBytes($buffer)
    [Runtime.InteropServices.Marshal]::Copy($buffer,0,$locked.Scan0,$buffer.Length)
    $bitmap.UnlockBits($locked)
    $locked=$null
    $bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Jpeg)
    return ,$stream.ToArray()
  } finally {
    if($locked) { $bitmap.UnlockBits($locked) }
    $bitmap.Dispose();$stream.Dispose()
  }
}
function Sign-Photo($Account, [string]$Path) {
  return Call-Api POST "/storage/v1/object/sign/fishing-media/$Path" @{expiresIn=60} $Account.token
}
function Publish-IsolatedCardFixture($Account, [ValidateSet('posts','fishing_spots')][string]$Table, [string]$Id) {
  # Fixture setup only, not moderation acceptance. Do not grant anyone a moderator
  # role or publish to the public audience. Both owner and exact row are checked.
  if ($Suite -notin @('h5-chat-attachments','h5-comment-moderation','h5-notifications','h5-content-updates') -or ($Suite -in @('h5-comment-moderation','h5-notifications','h5-content-updates') -and $Table -ne 'posts') -or $Id -notmatch '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') { throw 'Invalid card fixture scope' }
  $owner=Require-Ok (Call-Api GET "/auth/v1/admin/users/$($Account.id)" -Admin) 'card fixture ownership'
  if ($owner.email -ne $Account.email -or $owner.app_metadata.fishing_acceptance_run -ne $runId) { throw 'Card fixture ownership mismatch' }
  $target="/rest/v1/$($Table)?id=eq.$Id&author_id=eq.$($Account.id)&audience=eq.friends"
  $before=@(Require-Ok (Call-Api GET ($target+'&select=id,status,audience') -Admin) 'card fixture read')
  if ($before.Count -ne 1 -or $before[0].status -ne 'pending') { throw 'Card fixture is not the expected pending friends-only row' }
  $null=Require-Ok (Call-Api PATCH ($target+'&status=eq.pending') @{status='published'} -Admin) 'card fixture status setup'
  $after=@(Require-Ok (Call-Api GET ($target+'&select=id,status,audience') -Admin) 'card fixture status readback')
  Check ($after.Count -eq 1 -and $after[0].status -eq 'published' -and $after[0].audience -eq 'friends') "isolated friends-only $Table card fixture prepared"
}
Save-Journal 'planned'
$failure = $null
try {
  if ($CleanupRun) { throw 'RECOVERY_ONLY_PREVIOUS_RUN_INCOMPLETE' }
  foreach ($account in $accounts) {
    $created = Require-Ok (Call-Api POST '/auth/v1/admin/users' @{
      email=$account.email; password=$account.password; email_confirm=$true
      app_metadata=@{fishing_acceptance_run=$runId}
    } -Admin) 'create isolated test user'
    $account.id = $created.id
    Save-Journal 'running'
    $session = Require-Ok (Call-Api POST '/auth/v1/token?grant_type=password' @{email=$account.email;password=$account.password}) 'test user session'
    $account.token = $session.access_token
    # Only ordinary temporary-user credentials may be passed to a browser test.
    # Keep them in memory, never in journals, command arguments, or environment files.
    $account.session = @{access_token=$session.access_token;refresh_token=$session.refresh_token;expires_at=$session.expires_at;user=@{id=$account.id}}
    Check ($session.user.id -eq $account.id -and [bool]$account.token) "real user session: $($account.label)"
  }
  $a,$b,$outsider = $accounts
  if ($Suite -eq 'spot-discussion') {
    # The reserved city has no coordinates and cannot appear in any real city's results.
    $city='QA'+$runId.Substring(0,8)
    $name='discussion-'+$runId
    $target='lead:'+$city+'|'+$name
    $null=Require-Ok (Call-Api POST '/rest/v1/fishing_spot_leads' @{
      city=$city; name=$name; card=@{city=$city;name=$name;labels=@{};source=@{}}
    } -Admin) 'create isolated discussion target'
    $first=[guid]::NewGuid().ToString()
    $second=[guid]::NewGuid().ToString()
    $photo=Upload $a (New-Photo $false) 'image/png'
    $null=Success $b spot_community react @{target=$target;kind='like';enabled=$true}
    $likers=Success $outsider read discussion_likes @{target=$target;cursor=$null}
    Check ($likers.items.Count -eq 1 -and $likers.items[0].id -eq $b.id) 'actual like is returned to an authorized reader'
    $null=Success $b spot_community react @{target=$target;kind='like';enabled=$false}
    $likers=Success $outsider read discussion_likes @{target=$target;cursor=$null}
    Check (@($likers.items).Count -eq 0) 'undoing the like also removes the actor from the preview'
    $null=Success $a spot_community comment @{target=$target;id=$first;body='';media=@(@{id=$photo.id})}
    $reply=@{target=$target;id=$second;body='收到图片';reply_to_id=$first}
    $null=Success $b spot_community comment $reply
    $null=Success $b spot_community comment $reply
    $discussion=Success $outsider spot_community comments @{target=$target;cursor=$null}
    $quoted=@($discussion.items | Where-Object id -eq $second)[0]
    $parent=@($discussion.items | Where-Object id -eq $first)[0]
    Check ($discussion.summary.comments -eq 2 -and $quoted.reply_to.id -eq $first -and $quoted.reply_to.body -eq '[图片]' -and $parent.media[0].id -eq $photo.id) 'two accounts persist an image-only comment, reply and duplicate retry'
    $signed=Require-Ok (Sign-Photo $b $photo.path) 'sign the other account photo'
    $download=Call-Api GET ('/storage/v1'+$signed.signedURL)
    Check ($download.status -eq 200 -and $download.bytes.Length -gt 0 -and $download.mime -match 'image/') 'another reader opens the real sanitized image'
    $null=Success $a spot_community delete_comment @{target=$target;id=$first}
    $remainingDiscussion=Success $b spot_community comments @{target=$target;cursor=$null}
    Check ($remainingDiscussion.summary.comments -eq 1 -and $remainingDiscussion.items[0].id -eq $second -and $remainingDiscussion.items[0].reply_to_id -eq $first -and !$remainingDiscussion.items[0].reply_to) 'deleting the original keeps the reply and removes the quote'
    Check ((Sign-Photo $b $photo.path).status -ne 200) 'deleted comment photo cannot receive a new signature'
  }
  if ($Suite -eq 'avatar') {
    $first=Upload $a (New-Photo $false) 'image/png'
    Check ((Sign-Photo $null $first.path).status -ne 200) 'unsaved avatar candidate stays private'
    $saved=Success $a write update_profile @{nickname='头像自动验收';avatar_id=$first.id;city='苏州市';method='台钓、路亚'}
    Check ($saved.avatar.id -eq $first.id -and $saved.method -eq '台钓、路亚') 'real profile transaction saves avatar, city and multiple methods'
    $profile=Success $null read profile @{id=$a.id}
    Check ($profile.profile.avatar.id -eq $first.id) 'fresh visitor profile receives current avatar metadata'
    $signature=Require-Ok (Sign-Photo $null $first.path) 'public avatar signature'
    $image=Call-Api GET ('/storage/v1'+$signature.signedURL)
    Check ($image.status -eq 200 -and $image.mime -match 'image/jpeg' -and $image.bytes[0] -eq 255 -and $image.bytes[1] -eq 216) 'public avatar signs and downloads sanitized real JPEG bytes'
    Denied $b write update_profile @{avatar_id=$first.id} 'AVATAR_UNAVAILABLE' 'another account cannot assign the public image as its own avatar'
    $null=Success $b write block @{id=$a.id;enabled=$true}
    Check ((Sign-Photo $b $first.path).status -ne 200) 'blocked viewer cannot create a new avatar signature'
    $null=Success $b write block @{id=$a.id;enabled=$false}
    $preserved=Success $a write update_profile @{bio='临时自动验收，随后清理'}
    Check ($preserved.avatar.id -eq $first.id) 'profile writes omitting avatar preserve the existing image'
    $second=Upload $a (New-Photo $false) 'image/png'
    $replaced=Success $a write update_profile @{avatar_id=$second.id}
    Check ($replaced.avatar.id -eq $second.id -and (Sign-Photo $null $first.path).status -ne 200 -and (Sign-Photo $null $second.path).status -eq 200) 'replacement switches public avatar and denies new signing for the old image'
    $removed=Success $a write update_profile @{avatar_id=$null}
    Check ($null -eq $removed.avatar -and (Sign-Photo $null $second.path).status -ne 200) 'restore default removes current public avatar access'
    return
  }
  $anonymous = Call-Api GET '/auth/v1/user'
  Check ($anonymous.status -eq 401) 'anonymous request does not inherit a previous actor token'
  $profile = Success $a write update_profile @{nickname='系统验收·随后清理';city='苏州';bio='自动验收临时账号';method='台钓'}
  Check ($profile.nickname -eq '系统验收·随后清理') 'profile persists through user RPC'
  $base = @{id=[guid]::NewGuid().ToString();title='系统验收·随后清理';body='私密自动验收，不是真实鱼情';kind='catch';species='鲫鱼';method='台钓';bait='';weight='0';count='0';occurred_on=(Get-Date -Format 'yyyy-MM-dd');audience='private';location_label='系统验收测试水域';location_longitude=120.62;location_latitude=31.32;media=@()}
  if ($Suite -eq 'video') {
    [byte[]]$clip=[IO.File]::ReadAllBytes((Join-Path $fishingRoot 'tests/fixtures/flower-cc0.mp4'))
    $video=Upload $a $clip 'video/mp4' -Video
    Check ($video.kind -eq 'video' -and $video.width -eq 960 -and $video.height -eq 540 -and $video.size -eq $clip.Length -and $video.duration -eq 5.005) 'real MP4 passes validation, private upload and metadata storage'
    $draft=$base.Clone();$draft.media=@(@{id=$video.id});$draft.additives='果酸、虾油';$draft.occurred_at=$base.occurred_on+'T08:35:00+08:00'
    $post=Success $a write save_post $draft
    Check ($post.media[0].kind -eq 'video' -and $post.additives -eq '果酸、虾油' -and $post.location_longitude -eq 120.62) 'real private post persists video, selected time, location and multiple additives'
    Denied $b read post @{id=$post.id} 'NOT_FOUND' 'another real user cannot read the private video post'
    $denied=Sign-Photo $b $video.path
    Check ($denied.status -ne 200) 'another real user cannot obtain a private video signature'
    $signed=Require-Ok (Sign-Photo $a $video.path) 'owner video signature'
    $download=Call-Api GET ('/storage/v1'+$signed.signedURL)
    Check ($download.status -eq 200 -and $download.bytes.Length -eq $clip.Length -and $download.mime -match 'video/mp4') 'signed video downloads from real private storage with correct MIME and bytes'
    $photo=Upload $a (New-Photo $false) 'image/png'
    Check ($photo.kind -eq 'image' -and $photo.path.EndsWith('.jpg')) 'existing photo sanitization remains compatible'
    $snapshot=Success $a read edit_content @{type='post';id=$post.id}
    $mixed=$draft.Clone();$mixed.media=@(@{id=$video.id},@{id=$photo.id});$mixed.type='post';$mixed.revision=$snapshot.revision;$mixed.request_id=[guid]::NewGuid().ToString()
    $null=Success $a write update_content $mixed
    $mixedResult=Success $a read post @{id=$post.id}
    Check ($mixedResult.post.media.Count -eq 2 -and $mixedResult.post.media[0].kind -eq 'video' -and $mixedResult.post.media[1].kind -eq 'image') 'real API preserves video and image together in selection order'
    return
  }
  if ($Suite -in @('photo-capacity','photo-guard')) {
    foreach($size in @(@(1600,1200),@(3000,2000),@(4000,2500))) {
      $width,$height=$size
      if ($Suite -eq 'photo-guard' -and $width -ne 4000) { continue }
      # Decoder allocation depends on dimensions, not JPEG byte size. A compact
      # color-pattern JPEG isolates this guard from large-upload network failures.
      $bytes=if ($Suite -eq 'photo-guard') { New-Photo $true $width $height } else { New-CapacityPhoto $width $height }
      Check ($bytes.Length -lt 8*1024*1024) "synthetic $($width)x$height JPEG fits advertised upload byte limit"
      $timer=[Diagnostics.Stopwatch]::StartNew()
      $reply=Upload $a $bytes 'image/jpeg' -Raw
      $timer.Stop()
      if ($width -eq 4000) {
        Check ($reply.status -eq 413 -and $reply.json.error -eq 'IMAGE_DIMENSIONS_TOO_LARGE') 'raw 10MP JPEG receives explicit dimension limit instead of generic processing failure'
        continue
      }
      $photo=Require-Ok $reply 'capacity photo upload'
      Check ($photo.width -eq $width -and $photo.height -eq $height) "hosted $($width)x$height JPEG preserves dimensions"
      Write-Host "TIMING $($width)x$height upload wall time $($timer.ElapsedMilliseconds)ms (includes network, not CPU)"
      $signed=Require-Ok (Sign-Photo $a $photo.path) 'capacity photo signature'
      $download=Call-Api GET ('/storage/v1'+$signed.signedURL)
      Check ($download.status -eq 200 -and $download.bytes[0] -eq 255 -and $download.bytes[1] -eq 216) "hosted $($width)x$height JPEG is actually stored and downloadable"
    }
  }
  if ($Suite -in @('h5-amap','h5-spot-photos','h5-large-photo','h5-media','h5-social','h5-chat-attachments','h5-realtime','h5-zones','h5-trip-catches','h5-comments','h5-comment-moderation','h5-notifications','h5-composition','h5-content-updates','h5-report','h5-report-manual')) {
    if ($Suite -eq 'h5-amap') {
      # Reuse the same proxy-aware transport as hosted acceptance. Playwright's
      # standalone APIRequestContext does not inherit the browser's Windows proxy.
      $mapAnonymous = Call-Api POST '/functions/v1/amap' @{action='search';query='苏州金鸡湖';city='苏州';page=1}
      Check ($mapAnonymous.status -eq 401) 'Web Service proxy rejects requests without an authenticated session'
      $riverShore = Require-Ok (Call-Api POST '/functions/v1/amap' @{action='shoreline';longitude=114.146146;latitude=30.447590;crs='WGS84'} $a.token) 'named river shoreline'
      Check ($riverShore.crs -eq 'WGS84' -and $riverShore.water.distance -eq 0 -and $riverShore.water.polygon.Count -gt 0 -and $riverShore.water.name -match '通顺河|东荆河') 'Static picker reads the named river and its real geometry at the reported point'
      $riverNames = Require-Ok (Call-Api POST '/functions/v1/amap' @{action='water-places';longitude=114.151786;latitude=30.445221;radius=2000} $a.token) 'named river places'
      Check (@($riverNames.items | Where-Object { $_.name -eq '东荆河' -and $_.flowing }).Count -gt 0) 'Real AMap water lookup returns the on-map river name'
      $pinPreview = Require-Ok (Call-Api POST '/functions/v1/amap' @{action='preview';longitude=114.151786;latitude=30.445221;hideMarker=$true} $a.token) 'map image for a prohibition pin'
      Check ($pinPreview.precision -eq 'exact' -and $pinPreview.width -eq 640 -and $pinPreview.image -match '^data:image/') 'The hosted map returns an exact base image for the shared pin'
    }
    $conversationId=$null
    $cardFixtures=$null
    if ($Suite -in @('h5-spot-photos','h5-social','h5-chat-attachments','h5-realtime','h5-comment-moderation','h5-notifications','h5-content-updates')) {
      $null=Success $b write update_profile @{nickname='界面验收钓友B';city='苏州';bio='临时测试账号';method='台钓'}
      $null=Success $a write friend_request @{id=$b.id;note='临时界面验收'}
      $social=Success $b read social
      $invitation=@($social.requests | Where-Object { $_.sender.id -eq $a.id })
      if ($invitation.Count -ne 1) { throw 'Isolated friendship setup failed' }
      $null=Success $b write friend_respond @{id=$invitation[0].id;accept=$true}
      $conversationId=Success $a write conversation @{id=$b.id}
    }
    if ($Suite -in @('h5-comment-moderation','h5-notifications','h5-content-updates')) {
      $postId=[guid]::NewGuid().ToString(); $rootComment=[guid]::NewGuid().ToString(); $replyComment=[guid]::NewGuid().ToString()
      $postPayload=$base.Clone(); $postPayload.id=$postId; $postPayload.title='评论举报隔离验收'; $postPayload.audience='friends'
      $null=Success $a write save_post $postPayload
      Publish-IsolatedCardFixture $a posts $postId
      $commentBody='隔离验收：需要核实的评论内容。'; $replyBody='隔离验收：保留的正常回复。'
      $null=Success $a write comment @{id=$rootComment;post_id=$postId;body=$commentBody}
      $null=Success $b write comment @{id=$replyComment;post_id=$postId;body=$replyBody;reply_to_id=$rootComment}
      $commentFixture=@{post=$postId;root=$rootComment;reply=$replyComment;body=$commentBody;replyBody=$replyBody}
      if ($Suite -eq 'h5-content-updates') { $commentFixture.spot=[guid]::NewGuid().ToString() }
      Save-Journal 'awaiting-review-fixture'
      # No production grant endpoint is added for acceptance. A project maintainer must
      # verify this exact server-marked temporary actor before granting via project MCP.
      # Auth-user deletion below cascades this membership. Audit rows need exact-ID readback.
      Write-Host "WAIT isolated review fixture: run=$runId; temporaryUser=$($outsider.id)"
      $ready=$false
      for($attempt=0;$attempt -lt 45;$attempt++) {
        if ((Success $outsider moderation access).allowed) { $ready=$true; break }
        Start-Sleep -Milliseconds 2000
      }
      if (!$ready) { throw 'Temporary reviewer fixture was not prepared; exact-user cleanup follows' }
      Check $true 'isolated temporary reviewer capability verified through real session'
    }
    if ($Suite -eq 'h5-spot-photos') {
      $commentFixture=@{spot=[guid]::NewGuid().ToString()}
      Save-Journal 'awaiting-review-fixture'
      Write-Host "WAIT isolated review fixture: run=$runId; temporaryUser=$($outsider.id)"
      $ready=$false
      for($attempt=0; $attempt -lt 45; $attempt++) {
        if ((Success $outsider moderation access).allowed) { $ready=$true; break }
        Start-Sleep -Milliseconds 2000
      }
      if (!$ready) { throw 'Temporary reviewer fixture was not prepared; exact-user cleanup follows' }
      Check $true 'isolated temporary reviewer capability verified through real session'
    }
    if ($Suite -eq 'h5-chat-attachments') {
      $postId=[guid]::NewGuid().ToString()
      $spotId=[guid]::NewGuid().ToString()
      $postTitle='隔离验收鱼情（随后清理）'
      $spotTitle='隔离验收水域（非真实钓位）'
      $postPayload=$base.Clone()
      $postPayload.id=$postId; $postPayload.title=$postTitle; $postPayload.audience='friends'
      $null=Success $a write save_post $postPayload
      $null=Success $a write save_spot @{id=$spotId;name=$spotTitle;city='苏州';water_type='其他';species='';description='隔离自动验收，非真实钓位';fee_note='未核实';observed_on=(Get-Date -Format 'yyyy-MM-dd');audience='friends';precision='area';longitude=120.51234;latitude=31.25678;access_note='隔离测试到达说明，不应出现在卡片'}
      foreach($fixture in @(@{type='post';id=$postId},@{type='spot';id=$spotId})) {
        Denied $a write send_message @{conversation_id=$conversationId;client_id=[guid]::NewGuid().ToString();kind=$fixture.type;reference_id=$fixture.id} 'CHAT_CONTENT_UNAVAILABLE' "pending $($fixture.type) cannot be shared in real chat"
      }
      Publish-IsolatedCardFixture $a posts $postId
      Publish-IsolatedCardFixture $a fishing_spots $spotId
      $cardFixtures=@{post=@{id=$postId;title=$postTitle};spot=@{id=$spotId;title=$spotTitle}}
    }
    $browserTest=[Diagnostics.Process]::new()
    $browserTest.StartInfo.FileName=(Get-Command node -CommandType Application | Select-Object -First 1).Source
    $browserTest.StartInfo.WorkingDirectory=$fishingRoot
    $browserTest.StartInfo.UseShellExecute=$false
    $browserTest.StartInfo.CreateNoWindow=$true
    $browserTest.StartInfo.RedirectStandardInput=$true
    $browserTest.StartInfo.RedirectStandardOutput=$true
    $browserTest.StartInfo.RedirectStandardError=$true
    # Windows can default redirected stdin to GB2312. Node consumes UTF-8; keep
    # Chinese fixture titles byte-identical without changing the user's console.
    $browserTest.StartInfo.StandardInputEncoding=[Text.UTF8Encoding]::new($false)
    $browserTest.StartInfo.StandardOutputEncoding=[Text.UTF8Encoding]::new($false)
    $browserTest.StartInfo.StandardErrorEncoding=[Text.UTF8Encoding]::new($false)
    $browserTest.StartInfo.ArgumentList.Add('scripts/hosted-h5.mjs')
    try {
      $null=$browserTest.Start()
      $browserOut=$browserTest.StandardOutput.ReadToEndAsync()
      $browserErr=$browserTest.StandardError.ReadToEndAsync()
      $browserInput=@{run=$runId;suite=$Suite;accounts=@($accounts | ForEach-Object { @{label=$_.label;session=$_.session} });conversation=$conversationId;photo=[Convert]::ToBase64String((New-Photo $false))}
      if ($cardFixtures) { $browserInput.cards=$cardFixtures }
      if ($commentFixture) { $browserInput.commentFixture=$commentFixture }
      if ($Suite -eq 'h5-large-photo') {
        $largePhoto=New-CapacityPhoto 4000 3000
        Check ($largePhoto.Length -lt 8*1024*1024) '12MP textured source fits the original file byte limit'
        $browserInput.largePhoto=[Convert]::ToBase64String($largePhoto)
        $browserInput.portraitPhoto=[Convert]::ToBase64String((New-Photo $true 4000 3000))
      }
      $browserTest.StandardInput.Write(($browserInput | ConvertTo-Json -Depth 8 -Compress))
      $browserTest.StandardInput.Close()
      if (!$browserTest.WaitForExit(240000)) { $browserTest.Kill($true); $browserTest.WaitForExit(); throw 'H5 acceptance timed out; temporary-user cleanup follows' }
      # Child prints only fixed check labels and a phase, never browser exceptions,
      # network headers, signed query strings, tokens, or arbitrary page contents.
      $browserResult=$browserOut.GetAwaiter().GetResult() | ConvertFrom-Json
      foreach($label in $browserResult.checks) {
        if ($label -notmatch '^[a-zA-Z0-9 :().-]{1,160}$') { throw 'Invalid browser result label' }
        Check $true $label
      }
      if ($browserTest.ExitCode -ne 0 -or !$browserResult.passed) {
        $phase=if($browserResult.phase -match '^[a-z0-9-]{1,60}$') { $browserResult.phase } else { 'withheld' }
        throw "H5 acceptance failed at $phase; sanitized evidence is under artifacts/hosted-business/$runId"
      }
    } finally { $browserTest.Dispose(); $browserInput=$null; $browserOut=$null; $browserErr=$null }
  }
  if ($Suite -in @('all','core','private-core')) {
  $photo = Upload $a (New-Photo $false) 'image/png'
  Check ($photo.width -eq 96 -and $photo.height -eq 64 -and $photo.path.StartsWith($a.id+'/')) 'real PNG upload and metadata persisted'
  $signed = Require-Ok (Sign-Photo $a $photo.path) 'owner photo signature'
  Check ($signed.signedURL.StartsWith('/object/sign/fishing-media/')) 'owner can sign private photo'
  $download = Call-Api GET ('/storage/v1'+$signed.signedURL)
  Check ($download.status -eq 200 -and $download.bytes[0] -eq 255 -and $download.bytes[1] -eq 216) 'signed URL downloads re-encoded JPEG'
  $deny = Sign-Photo $b $photo.path
  Check ($deny.status -in @(400,403,404) -and !$deny.json.signedURL) 'other user cannot sign unattached photo'
  $base.media=@(@{id=$photo.id})
  $post = Success $a write save_post $base
  Check ($post.id -eq $base.id -and $post.media.Count -eq 1) 'private post attaches owned uploaded photo'
  Denied $b read post @{id=$base.id} 'NOT_FOUND' 'other user cannot read private post'
  $rows = Require-Ok (Call-Api GET "/rest/v1/posts?id=eq.$($base.id)&select=id" -Token $b.token) 'private table check'
  Check (@($rows).Count -eq 0) 'direct REST table read also enforces private post RLS'
  Denied $b write save_post $base 'FORBIDDEN' 'other user cannot reuse owner post ID'
  if ($Suite -ne 'private-core') {
    # Historical moderation acceptance is separate from the release batch. The
    # private-core batch never creates a publicly visible synthetic post.
    $pending = $base.Clone(); $pending.id=[guid]::NewGuid().ToString();$pending.audience='public';$pending.media=@()
    $saved = Success $a write save_post $pending
    Check ($saved.status -eq 'pending') 'shared post requires moderation'
    Denied $null read post @{id=$pending.id} 'NOT_FOUND' 'pending post is hidden from anonymous visitors'
  }
  }
  if ($Suite -in @('all','social')) {
  Denied $a write conversation @{id=$b.id} 'NOT_FRIENDS' 'chat cannot start before friendship'
  $null = Success $a write friend_request @{id=$b.id;note='系统验收'}
  $social = Success $b read social
  $request = @($social.requests | Where-Object { $_.sender.id -eq $a.id })
  Check ($request.Count -eq 1) 'friend request arrives at intended recipient'
  Denied $outsider write friend_respond @{id=$request[0].id;accept=$true} 'FORBIDDEN' 'third party cannot accept friendship'
  $null = Success $b write friend_respond @{id=$request[0].id;accept=$true}
  $conversation = Success $a write conversation @{id=$b.id}
  Check ($conversation -eq (Success $b write conversation @{id=$a.id})) 'friends share one canonical conversation'
  $message = @{conversation_id=$conversation;client_id=[guid]::NewGuid().ToString();body='系统验收消息，仅临时账号可见'}
  $first = Success $a write send_message $message
  $again = Success $a write send_message $message
  Check ($first.id -eq $again.id -and $first.sequence -eq 1) 'message retry creates exactly one message'
  $history = Success $b read messages @{id=$conversation}
  Check (@($history).Count -eq 1 -and $history[0].body -eq $message.body) 'recipient reads persisted chat history'
  Denied $outsider read messages @{id=$conversation} 'FORBIDDEN' 'nonmember cannot read conversation RPC'
  $rows = Require-Ok (Call-Api GET "/rest/v1/messages?conversation_id=eq.$conversation&select=id" -Token $outsider.token) 'message table check'
  Check (@($rows).Count -eq 0) 'nonmember cannot bypass chat RLS with REST'
  $null = Success $b write read_conversation @{id=$conversation;sequence=9999}
  $social = Success $b read social
  Check ($social.conversations[0].unread -eq 0) 'read cursor clears unread count'
  $null = Success $a write block @{id=$b.id;enabled=$true}
  $message.client_id=[guid]::NewGuid().ToString()
  Denied $b write send_message $message 'NOT_FRIENDS' 'blocking immediately stops new chat messages'
  $history = Success $b read messages @{id=$conversation}
  Check (@($history).Count -eq 1) 'existing participant retains chat history after block'
  }
  if ($Suite -in @('all','report')) {
  $reportPhoto = Upload $a (New-Photo $false) 'image/png'
  $report = @{id=[guid]::NewGuid().ToString();category='electric';province='江苏省';city='苏州市';district='';location_label='系统验收虚构地点';longitude=120.123456;latitude=31.123456;observed_at=[DateTime]::UtcNow.AddHours(-1).ToString('o');description='自动验收测试，不是真实举报，不发送';media=@(@{id=$reportPhoto.id});consent_version='2026-11-19-water-v1'}
  $saved = Success $a write save_water_report $report
  Check ($saved.status -eq 'saved') 'report is privately saved, never marked delivered'
  Denied $outsider read water_reports @{id=$report.id} 'NOT_FOUND' 'other user cannot read report location or evidence'
  $deny = Sign-Photo $outsider $reportPhoto.path
  Check ($deny.status -in @(400,403,404) -and !$deny.json.signedURL) 'other user cannot sign report evidence'
  $steal = $base.Clone();$steal.id=[guid]::NewGuid().ToString();$steal.media=@(@{id=$reportPhoto.id})
  Denied $a write save_post $steal 'FORBIDDEN' 'report evidence cannot be republished through a post'
  $null = Success $a write delete_water_report @{id=$report.id}
  $deny = Sign-Photo $a $reportPhoto.path
  Check ($deny.status -in @(400,403,404) -and !$deny.json.signedURL) 'report deletion revokes new evidence signatures'
  }
  if ($Suite -in @('all','orientation')) {
  $deletion = Call-Api POST '/functions/v1/account-delete' @{confirmation='DELETE_MY_ACCOUNT'} $a.token
  Check ($deletion.status -eq 403 -and $deletion.json.error -eq 'RECENT_PHONE_VERIFICATION_REQUIRED') 'password test session cannot bypass recent phone verification for account deletion'
  $rotated = Upload $a (New-Photo $true) 'image/jpeg'
  Check ($rotated.width -eq 64 -and $rotated.height -eq 96) 'EXIF orientation applied before metadata removal'
  $signed = Require-Ok (Sign-Photo $a $rotated.path) 'upright photo signature'
  $download = Call-Api GET ('/storage/v1'+$signed.signedURL)
  Check ($download.status -eq 200) 'upright photo can be downloaded by its owner'
  $imageStream=[IO.MemoryStream]::new($download.bytes)
  $uprightImage=[Drawing.Bitmap]::new($imageStream)
  try {
    Check ($uprightImage.Width -eq 64 -and $uprightImage.Height -eq 96 -and $uprightImage.GetPixel(56,8).R -gt 200 -and $uprightImage.GetPixel(56,88).R -lt 100) 'stored JPEG pixels and dimensions are genuinely rotated'
    Check (![Text.Encoding]::ASCII.GetString($download.bytes).Contains("Exif`0`0")) 'stored JPEG no longer contains original EXIF'
  } finally { $uprightImage.Dispose(); $imageStream.Dispose() }
  }
  Save-Journal 'checks-passed'
} catch {
  $failure = $_.Exception.Message
  # Call-Api and Require-Ok already redact credential-bearing bodies. Preserve
  # the failure before recovery so a cleanup transport error cannot hide it.
  Write-Host "CHECKS FAILED: $failure"
  Save-Journal 'checks-failed'
} finally {
  if ($Suite -eq 'spot-discussion') {
    $fixturePath='/rest/v1/fishing_spot_leads?city=eq.QA'+$runId.Substring(0,8)+'&name=eq.discussion-'+$runId
    try {
      $null=Require-Ok (Call-Api DELETE $fixturePath -Admin) 'remove exact isolated discussion target'
      $left=Require-Ok (Call-Api GET ($fixturePath+'&select=name') -Admin) 'verify isolated target removal'
      Check (@($left).Count -eq 0) 'isolated target removed'
    } catch { $failure=$_.Exception.Message }
  }
  # Only accounts bearing BOTH this run's immutable server marker AND exact planned email.
  foreach ($account in $accounts) {
    try {
      if ($account.cleaned) { continue }
      if (!$account.id) {
        for ($page=1; $page -le 100; $page++) {
          $list = Require-Ok (Call-Api GET "/auth/v1/admin/users?page=$page&per_page=100" -Admin) 'recover create outcome'
          $match = @($list.users | Where-Object { $_.email -eq $account.email -and $_.app_metadata.fishing_acceptance_run -eq $runId })
          if ($match.Count -eq 1) { $account.id=$match[0].id; break }
          if (@($list.users).Count -lt 100) { break }
          if ($page -eq 100) { throw 'Recovery pagination limit reached' }
        }
        if (!$account.id) { $account.cleaned=$true; continue }
      }
      if ($account.id -notmatch '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') { throw 'Invalid test account identifier' }
      $ownership = Call-Api GET "/auth/v1/admin/users/$($account.id)" -Admin
      if ($ownership.status -eq 404) {
        # A prior DELETE may have succeeded before its response was lost. Only read
        # this exact journal prefix; do not delete anything whose owner is now absent.
        $leftover = Require-Ok (Call-Api POST '/storage/v1/object/list/fishing-media' @{prefix=($account.id+'/');limit=1;offset=0} -Admin) 'verify absent test user has no objects'
        if (@($leftover).Count) { throw 'Absent user still has objects; manual ownership review required' }
        $account.cleaned=$true
        continue
      }
      $owner = Require-Ok $ownership 'cleanup ownership check'
      if ($owner.email -ne $account.email -or $owner.app_metadata.fishing_acceptance_run -ne $runId) { throw 'Cleanup ownership mismatch' }
      if (!$account.token -and !$CleanupRun) {
        $session = Require-Ok (Call-Api POST '/auth/v1/token?grant_type=password' @{email=$account.email;password=$account.password}) 'cleanup session recovery'
        $account.token=$session.access_token
      }
      if (!$CleanupRun) { $null = Require-Ok (Call-Api POST '/auth/v1/logout?scope=global' @{} $account.token) 'revoke test refresh sessions' }
      for ($batch=0; $batch -lt 10; $batch++) {
        $files = Require-Ok (Call-Api POST '/storage/v1/object/list/fishing-media' @{prefix=($account.id+'/');limit=100;offset=0} -Admin) 'list test-only objects'
        $paths = @($files | Where-Object id | ForEach-Object {
          if ($_.name -notmatch '^[0-9a-f-]{36}\.(jpg|mp4)$') { throw 'Unexpected file in test prefix; refusing broad cleanup' }
          $account.id+'/'+$_.name
        })
        if (!$paths.Count) { break }
        $null = Require-Ok (Call-Api DELETE '/storage/v1/object/fishing-media' @{prefixes=$paths} -Admin) 'delete exact test photos'
        if ($batch -eq 9) { throw 'Cleanup batch limit reached' }
      }
      $null = Require-Ok (Call-Api DELETE "/auth/v1/admin/users/$($account.id)" @{should_soft_delete=$false} -Admin) 'delete isolated test user'
      $gone = Call-Api GET "/auth/v1/admin/users/$($account.id)" -Admin
      if ($gone.status -ne 404) { throw 'Test user deletion not confirmed' }
      $account.cleaned=$true
      Write-Host "CLEANED temporary account and owned objects: $($account.label)"
    } catch {
      Write-Host "CLEANUP PENDING: $($account.label); $($_.Exception.Message)"
    }
    Save-Journal 'cleaning'
  }
  $remaining = @($accounts | Where-Object { !$_.cleaned })
  Save-Journal $(if ($remaining.Count) { 'cleanup-required' } elseif ($failure) { 'failed-cleaned' } else { 'passed-cleaned' })
  $serverKey=$null
  $accounts | ForEach-Object { $_.password=$null; $_.token=$null; $_.session=$null }
}
if ($remaining.Count) { throw "Cleanup incomplete. Use exact identities in $journalPath; do not delete unrelated data." }
if ($failure -and !$CleanupRun) { throw $failure }
if ($CleanupRun) { Write-Host 'Recovery cleanup complete; the interrupted acceptance run did not pass.'; exit 0 }
if ($Suite -in @('h5-spot-photos','h5-comment-moderation','h5-notifications','h5-content-updates')) {
  Write-Host "Hosted business acceptance passed: $($checks.Count) checks; temporary accounts removed; exact moderator/audit cleanup readback still required. Journal: $journalPath"
} else {
  Write-Host "Hosted business acceptance passed: $($checks.Count) checks; temporary data removed. Journal: $journalPath"
}
