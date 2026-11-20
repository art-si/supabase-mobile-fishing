$ErrorActionPreference = 'Stop'
$fishingRoot = Split-Path -Parent $PSScriptRoot
$mapEnv = @{}
Get-Content -LiteralPath (Join-Path $fishingRoot '.env.local') | ForEach-Object {
  if ($_ -match '^([A-Z_]+)=(.*)$') { $mapEnv[$matches[1]] = $matches[2].Trim() }
}
$projectUrl = 'https://tlfmfokyhahlpzmpliad.supabase.co'
if ($mapEnv.VITE_SUPABASE_URL -ne $projectUrl -or !$mapEnv.VITE_SUPABASE_KEY.StartsWith('sb_publishable_')) {
  throw 'Refusing unconfirmed project or non-public frontend credential'
}
$proxyUrl = "$projectUrl/functions/v1/amap-js/_AMapService"
$publicMapKey = [Uri]::EscapeDataString($mapEnv.VITE_AMAP_KEY)
$allowedOrigin = 'http://127.0.0.1:5181'
# All cases fail before upstream calls. Never print credential-bearing URLs or bodies.
$cases = @(
  @{ Label='unlisted origin'; Path="/v3/place/text?key=$publicMapKey"; Headers=@{Origin='https://example.invalid'}; Method='GET'; Status=403 },
  @{ Label='missing provenance'; Path="/v3/place/text?key=$publicMapKey"; Headers=@{}; Method='GET'; Status=403 },
  @{ Label='wrong key'; Path='/v3/place/text?key=not-the-configured-key'; Headers=@{Origin=$allowedOrigin}; Method='GET'; Status=400 },
  @{ Label='client code injection'; Path="/v3/place/text?key=$publicMapKey&jscode=not-a-secret"; Headers=@{Origin=$allowedOrigin}; Method='GET'; Status=400 },
  @{ Label='static map not exposed by JS proxy'; Path="/v3/staticmap?key=$publicMapKey"; Headers=@{Origin=$allowedOrigin}; Method='GET'; Status=404 },
  @{ Label='autocomplete wrong key'; Path='/v3/assistant/inputtips?key=not-the-configured-key'; Headers=@{Origin=$allowedOrigin}; Method='GET'; Status=400 },
  @{ Label='weather invalid region'; Path="/v3/weather/weatherInfo?key=$publicMapKey&city=000000"; Headers=@{Origin=$allowedOrigin}; Method='GET'; Status=400 },
  @{ Label='weather duplicate region'; Path="/v3/weather/weatherInfo?key=$publicMapKey&city=320506&city=110101"; Headers=@{Origin=$allowedOrigin}; Method='GET'; Status=400 },
  @{ Label='weather unsupported mode'; Path="/v3/weather/weatherInfo?key=$publicMapKey&city=320506&extensions=full"; Headers=@{Origin=$allowedOrigin}; Method='GET'; Status=400 },
  @{ Label='write method denied'; Path="/v3/place/text?key=$publicMapKey"; Headers=@{Origin=$allowedOrigin}; Method='POST'; Status=405 }
)
foreach ($case in $cases) {
  try {
    $reply = Invoke-WebRequest -Uri ($proxyUrl + $case.Path) -Method $case.Method -Headers $case.Headers -SkipHttpErrorCheck -TimeoutSec 20
  } catch { throw "Map transport failed: $($case.Label); URL and credentials withheld" }
  if ($reply.StatusCode -ne $case.Status) { throw "$($case.Label): expected $($case.Status), got $($reply.StatusCode)" }
  Write-Output "PASS hosted JS proxy: $($case.Label)"
}
$publicHeaders = @{ apikey=$mapEnv.VITE_SUPABASE_KEY }
try {
  $quota = Invoke-WebRequest -Uri "$projectUrl/rest/v1/rpc/fishing_js_map_ticket" -Method POST -Headers $publicHeaders -ContentType 'application/json' -Body '{}' -SkipHttpErrorCheck -TimeoutSec 20
  $mini = Invoke-WebRequest -Uri "$projectUrl/functions/v1/amap" -Method POST -Headers $publicHeaders -ContentType 'application/json' -Body '{"action":"weather","adcode":"320506"}' -SkipHttpErrorCheck -TimeoutSec 20
} catch { throw 'Quota/auth probe transport failed; credentials withheld' }
if ($quota.StatusCode -notin @(401,403) -or $mini.StatusCode -ne 401) { throw 'Anonymous quota/miniapp protection regression' }
Write-Output 'PASS hosted server quota and personal-miniapp proxy remain inaccessible anonymously'
# Positive coverage uses the real JS SDK protocol in a browser. A hand-built REST
# request with a JS-platform key is rejected by AMap (10009), even when the real
# AutoComplete plugin succeeds. No Web-Service key is substituted into this proxy.
$previousCloudMode = $env:FISHING_AMAP_CLOUD
try {
  $env:FISHING_AMAP_CLOUD = '1'
  node (Join-Path $PSScriptRoot 'test-amap-live.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Real SDK hosted autocomplete/geocoding check failed' }
} finally { $env:FISHING_AMAP_CLOUD = $previousCloudMode }
