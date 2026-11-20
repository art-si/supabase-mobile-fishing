# Offline acceptance: copies the installer into an isolated fixture and replaces only its CLI transport.
# Never loads the user's key, calls Supabase, or touches the real input/config files.
#requires -Version 7.0
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$fixture = Join-Path $repository ('artifacts/amap-secret-setup/' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path (Join-Path $fixture 'scripts'),(Join-Path $fixture 'supabase/.temp') -Force
$scriptPath = Join-Path $fixture 'scripts/configure-amap-web-service.ps1'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'configure-amap-web-service.ps1') -Destination $scriptPath
$inputPath = Join-Path $fixture '.env.amap-web-service.local'
$linkedPath = Join-Path $fixture 'supabase/.temp/project-ref'
$callsPath = Join-Path $fixture 'calls.jsonl'
$fakeKey = '0123456789abcdef0123456789abcdef'
[IO.File]::WriteAllText($linkedPath, 'tlfmfokyhahlpzmpliad')
$mock = @'
function Invoke-FishingPrivateCli {
  param([string[]]$Arguments)
  $root = Split-Path -Parent $PSScriptRoot
  if ($Arguments[-1] -ne 'tlfmfokyhahlpzmpliad' -and $Arguments[-3] -ne 'tlfmfokyhahlpzmpliad') { throw 'Wrong fixture project' }
  $operation = $Arguments[1]
  if ($operation -eq 'set') {
    $file = $Arguments[3]
    $lines = [IO.File]::ReadAllLines($file)
    if ($lines.Count -ne 1 -or $lines[0] -notmatch '^AMAP_WEB_SERVICE_KEY=([a-f0-9]{32})$') { throw 'Unexpected fixture payload' }
    $digest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Matches[1]))).ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $root 'digest.txt'), $digest)
  } elseif ($operation -ne 'list') { throw 'Unexpected fixture operation' }
  @{operation=$operation;arguments=@($Arguments)} | ConvertTo-Json -Compress | Add-Content -LiteralPath (Join-Path $root 'calls.jsonl')
  if ($operation -eq 'list') {
    $digest = if (Test-Path -LiteralPath (Join-Path $root 'mismatch')) { 'wrong-digest' } else { [IO.File]::ReadAllText((Join-Path $root 'digest.txt')) }
    return (@(@{name='AMAP_WEB_SERVICE_KEY';value=$digest}) | ConvertTo-Json -AsArray -Compress)
  }
  return 'fixture CLI response intentionally withheld'
}
'@
[IO.File]::WriteAllText((Join-Path $fixture 'scripts/private-supabase-cli.ps1'), $mock)
$checks = [Collections.Generic.List[string]]::new()
function Check([bool]$condition,[string]$message) {
  if (!$condition) { throw ('CHECK FAILED: ' + $message) }
  $checks.Add($message)
  Write-Output ('PASS ' + $message)
}
function Run([bool]$apply) {
  $child = [Diagnostics.Process]::new()
  $child.StartInfo.FileName = (Get-Command pwsh -CommandType Application).Source
  $child.StartInfo.UseShellExecute = $false
  $child.StartInfo.CreateNoWindow = $true
  $child.StartInfo.RedirectStandardOutput = $true
  $child.StartInfo.RedirectStandardError = $true
  foreach ($argument in @('-NoProfile','-File',$scriptPath)) { $child.StartInfo.ArgumentList.Add($argument) }
  if ($apply) { $child.StartInfo.ArgumentList.Add('-Apply') }
  try {
    $null = $child.Start()
    $stdout = $child.StandardOutput.ReadToEndAsync()
    $stderr = $child.StandardError.ReadToEndAsync()
    if (!$child.WaitForExit(20000)) { $child.Kill($true); throw 'Offline fixture timed out' }
    return @{code=$child.ExitCode;out=$stdout.GetAwaiter().GetResult();err=$stderr.GetAwaiter().GetResult()}
  } finally { $child.Dispose() }
}
[IO.File]::WriteAllText($inputPath, "# ignored input`nAMAP_WEB_SERVICE_KEY=`n")
$result = Run $false
Check ($result.code -eq 0 -and !($result.out | ConvertFrom-Json).ready -and !(Test-Path -LiteralPath $callsPath)) 'empty key reports awaiting input without contacting CLI'
$result = Run $true
Check ($result.code -ne 0 -and !(Test-Path -LiteralPath $callsPath)) 'apply with empty key cannot write any remote secret'
[IO.File]::WriteAllText($inputPath, "AMAP_WEB_SERVICE_KEY=$fakeKey`n")
$result = Run $false
Check ($result.code -eq 0 -and ($result.out | ConvertFrom-Json).ready -and !(Test-Path -LiteralPath $callsPath)) 'filled key still requires explicit apply'
$result = Run $true
$calls = @([IO.File]::ReadAllLines($callsPath) | ForEach-Object { $_ | ConvertFrom-Json })
Check ($result.code -eq 0 -and ($result.out | ConvertFrom-Json).digestVerified -and ($calls.operation -join ',') -eq 'set,list') 'apply writes only the intended key and verifies the exact stored digest'
Check (!(($result.out + $result.err + [IO.File]::ReadAllText($callsPath)).Contains($fakeKey))) 'key is absent from child arguments and visible diagnostics'
Check (@(Get-ChildItem -LiteralPath $fixture -File -Filter '.env.amap-web-service-upload.*.local').Count -eq 0) 'successful apply removes only its temporary upload file'
$beforeCalls = [IO.File]::ReadAllLines($callsPath).Count
foreach ($invalid in @("AMAP_WEB_SERVICE_KEY=$fakeKey`nOTHER_SETTING=unexpected",'AMAP_WEB_SERVICE_KEY=malformed')) {
  [IO.File]::WriteAllText($inputPath, $invalid)
  $result = Run $true
  Check ($result.code -ne 0 -and [IO.File]::ReadAllLines($callsPath).Count -eq $beforeCalls) 'malformed or additional config is rejected before transport'
}
[IO.File]::WriteAllText($inputPath, "AMAP_WEB_SERVICE_KEY=$fakeKey`n")
[IO.File]::WriteAllText($linkedPath, 'another-project')
$result = Run $true
Check ($result.code -ne 0 -and [IO.File]::ReadAllLines($callsPath).Count -eq $beforeCalls) 'wrong project is rejected before transport'
[IO.File]::WriteAllText($linkedPath, 'tlfmfokyhahlpzmpliad')
[IO.File]::WriteAllText((Join-Path $fixture 'mismatch'), '')
$result = Run $true
Check ($result.code -ne 0 -and [IO.File]::ReadAllLines($callsPath).Count -eq $beforeCalls + 2 -and !(($result.out + $result.err).Contains($fakeKey))) 'digest mismatch fails safely without repeating the write or exposing the key'
Check (@(Get-ChildItem -LiteralPath $fixture -File -Filter '.env.amap-web-service-upload.*.local').Count -eq 0) 'failed readback also removes the temporary upload file'
@{passed=$true;checks=@($checks);boundary='Offline fake key and stub CLI only; no hosted secrets read or written.'} | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $fixture 'result.json')
Write-Output ('Offline AMap secret setup checks passed: ' + $checks.Count)
