param([switch]$ReportsOnly, [switch]$ChatOnly)
$ErrorActionPreference = 'Stop'
$fishingRoot = Split-Path -Parent $PSScriptRoot
$fishingEnv = @{}
Get-Content -LiteralPath (Join-Path $fishingRoot '.env.local') | ForEach-Object {
  if ($_ -match '^([A-Z_]+)=(.*)$') { $fishingEnv[$matches[1]] = $matches[2] }
}
if ($fishingEnv.VITE_SUPABASE_URL -ne 'https://jupuypvmgjpnpntfetqv.supabase.co') {
  throw 'Refusing to test an unconfirmed project'
}
if (!$fishingEnv.VITE_SUPABASE_KEY.StartsWith('sb_publishable_')) {
  throw 'This check requires only a publishable key, never a service credential'
}
function Invoke-FishingProbe($Path, $Body, $Bearer) {
  $params = @{
    Uri = $fishingEnv.VITE_SUPABASE_URL + $Path
    Headers = @{ apikey = $fishingEnv.VITE_SUPABASE_KEY }
    TimeoutSec = 20
    SkipHttpErrorCheck = $true
  }
  if ($null -ne $Body) {
    $params.Method = 'POST'
    $params.Body = $Body | ConvertTo-Json -Compress -Depth 5
    $params.ContentType = 'application/json'
  }
  if ($Bearer) { $params.Headers.Authorization = "Bearer $Bearer" }
  Invoke-WebRequest @params
}
if ($ChatOnly) {
  foreach ($chatAction in @('messages','message_content')) {
    $reply = Invoke-FishingProbe '/rest/v1/rpc/fishing_read' @{action=$chatAction;payload=@{id='00000000-0000-0000-0000-000000000000';ids=@()}} $null
    $failure = $reply.Content | ConvertFrom-Json
    if ($reply.StatusCode -ne 400 -or $failure.message -ne 'NOT_AUTHENTICATED') { throw 'Anonymous chat projection was not rejected' }
    Write-Output "PASS anonymous $chatAction denied"
  }
  $reply = Invoke-FishingProbe '/rest/v1/rpc/fishing_write' @{action='send_message';payload=@{}} $null
  if ($reply.StatusCode -notin @(401,403) -or ($reply.Content | ConvertFrom-Json).code -ne '42501') { throw 'Anonymous chat write permission gate failed' }
  Write-Output 'PASS anonymous chat write denied by database grant'
  $reply = Invoke-FishingProbe '/rest/v1/messages?select=id&limit=1' $null $null
  if ($reply.StatusCode -notin @(401,403)) { throw 'Anonymous raw messages were not rejected' }
  Write-Output 'PASS anonymous raw message read denied'
  $reply = Invoke-FishingProbe '/rest/v1/media_assets?select=id&message_id=not.is.null&limit=1' $null $null
  if ($reply.StatusCode -ne 200 -or @(($reply.Content | ConvertFrom-Json)).Count -ne 0) { throw 'Anonymous chat media RLS failed' }
  Write-Output 'PASS anonymous chat media projection is empty'
  Write-Output 'Chat permission checks passed. No Auth, SMS, message or object writes.'
  exit 0
}
if ($ReportsOnly) {
  foreach ($reportAction in @('mine','queue')) {
    $reply = Invoke-FishingProbe '/rest/v1/rpc/fishing_reports' @{action=$reportAction;payload=@{}} $null
    if ($reply.StatusCode -notin @(401,403) -or ($reply.Content | ConvertFrom-Json).code -ne '42501') { throw 'Anonymous report API permission gate failed' }
    Write-Output "PASS anonymous report $reportAction denied by database grant"
  }
  $reply = Invoke-FishingProbe '/rest/v1/content_reports?select=id&limit=1' $null $null
  if ($reply.StatusCode -notin @(401,403)) { throw 'Anonymous raw reports read not rejected' }
  Write-Output 'PASS anonymous raw report read rejected; no report contents logged'
  Write-Output 'Report permission checks passed. No Auth, SMS, writes or moderator grants.'
  exit 0
}
foreach ($action in @('feed', 'spots')) {
  $reply = Invoke-FishingProbe '/rest/v1/rpc/fishing_read' @{action=$action;payload=@{}} $null
  if ($reply.StatusCode -ne 200) { throw "${action}: hosted read failed ($($reply.StatusCode))" }
  $body = $reply.Content | ConvertFrom-Json
  if ($null -eq $body.items) { throw "$action response is not a page" }
  Write-Output "PASS hosted $action read (items: $($body.items.Count)); contents not logged"
}
$zoneMap = Invoke-FishingProbe '/rest/v1/rpc/fishing_zones_read' @{action='nearby';payload=@{west=120;east=121;south=31;north=32}} $null
if ($zoneMap.StatusCode -ne 200 -or $null -eq ($zoneMap.Content | ConvertFrom-Json).items) { throw 'Hosted zone viewport read failed' }
Write-Output 'PASS hosted zone viewport is readable; contents not logged'
$spotMap = Invoke-FishingProbe '/rest/v1/rpc/fishing_map_spots' @{payload=@{west=120;east=121;south=31;north=32}} $null
if ($spotMap.StatusCode -ne 200) { throw "Hosted spot viewport failed ($($spotMap.StatusCode))" }
$spotMapBody = $spotMap.Content | ConvertFrom-Json
if ($null -eq $spotMapBody.items -or $null -eq $spotMapBody.truncated -or $null -eq $spotMapBody.zoom_in) { throw 'Hosted spot viewport contract mismatch' }
foreach ($pin in $spotMapBody.items) {
  if ($pin.PSObject.Properties.Name -contains 'access_note' -or $pin.PSObject.Properties.Name -contains 'author_id') { throw 'Hosted spot map exposes disallowed fields' }
  if ($pin.longitude -lt 120 -or $pin.longitude -gt 121 -or $pin.latitude -lt 31 -or $pin.latitude -gt 32) { throw 'Hosted map pin outside requested bounds' }
}
Write-Output 'PASS hosted spot viewport returns bounded safe pins; contents not logged'
$wideMap = Invoke-FishingProbe '/rest/v1/rpc/fishing_map_spots' @{payload=@{west=70;east=140;south=0;north=60}} $null
if ($wideMap.StatusCode -ne 200 -or !($wideMap.Content | ConvertFrom-Json).zoom_in -or ($wideMap.Content | ConvertFrom-Json).items.Count -ne 0) { throw 'Hosted spot viewport must bound nationwide queries' }
$badMap = Invoke-FishingProbe '/rest/v1/rpc/fishing_map_spots' @{payload=@{west=121;east=120;south=31;north=32}} $null
if ($badMap.StatusCode -ne 400 -or ($badMap.Content | ConvertFrom-Json).message -ne 'INVALID_INPUT') { throw 'Hosted spot viewport accepts inverted bounds' }
Write-Output 'PASS hosted spot viewport rejects invalid bounds and guides zooming for large regions'
foreach ($zoneAction in @('mine','review')) {
  $zonePrivate = Invoke-FishingProbe '/rest/v1/rpc/fishing_zones_read' @{action=$zoneAction;payload=@{}} $null
  if ($zonePrivate.StatusCode -notin @(400,401,403) -or ($zonePrivate.Content | ConvertFrom-Json).message -ne 'NOT_AUTHENTICATED') { throw 'Private zone list is not protected' }
  Write-Output "PASS anonymous zone $zoneAction denied"
}
$settings = Invoke-FishingProbe '/auth/v1/settings' $null $null
if ($settings.StatusCode -ne 200) { throw 'Auth settings unavailable' }
$phone = ($settings.Content | ConvertFrom-Json).external.phone
Write-Output "INFO hosted phone provider enabled: $phone (this does not verify SMS delivery)"
foreach ($path in @('/rest/v1/spot_locations?select=spot_id&limit=1', '/rest/v1/messages?select=id&limit=1', '/rest/v1/water_reports?select=id&limit=1', '/rest/v1/fishing_zone_reports?select=id&limit=1')) {
  $reply = Invoke-FishingProbe $path $null $null
  if ($reply.StatusCode -notin @(401,403)) { throw "Private read not rejected: $path ($($reply.StatusCode))" }
  Write-Output "PASS anonymous private-table read rejected ($($reply.StatusCode))"
}
foreach ($action in @('edit_content', 'water_reports')) {
  $reply = Invoke-FishingProbe '/rest/v1/rpc/fishing_read' @{action=$action;payload=@{type='post';id='00000000-0000-4000-8000-000000000000'}} $null
  $failure = $reply.Content | ConvertFrom-Json
  if ($reply.StatusCode -notin @(400,401,403) -or $failure.message -ne 'AUTH_REQUIRED') { throw "Anonymous private RPC not rejected: $action ($($reply.StatusCode))" }
  Write-Output "PASS anonymous private $action rejected; no content read"
}
# The invalid action is intentionally non-mutating even if an authorization regression occurs.
foreach ($rpc in @('fishing_write','fishing_moderation','fishing_reports','fishing_map_ticket','fishing_zones_write')) {
  $body = if ($rpc -ne 'fishing_map_ticket') { @{action='__readonly_permission_probe__';payload=@{}} } else { @{} }
  $reply = Invoke-FishingProbe "/rest/v1/rpc/$rpc" $body $null
  if ($reply.StatusCode -notin @(401,403)) { throw "Anonymous RPC not rejected: $rpc ($($reply.StatusCode))" }
  Write-Output "PASS anonymous $rpc rejected ($($reply.StatusCode))"
}
foreach ($name in @('amap','media-upload','account-delete')) {
  foreach ($token in @('', 'invalid-test-token')) {
    # No real user token, file, location or deletion confirmation is sent.
    $reply = Invoke-FishingProbe "/functions/v1/$name" @{} $token
    if ($reply.StatusCode -ne 401) { throw "$name auth check failed ($($reply.StatusCode))" }
  }
  Write-Output "PASS $name rejects missing and invalid user tokens"
}
Write-Output 'Hosted read-only checks passed. No SMS, account creation, data changes or AMap requests were made.'
