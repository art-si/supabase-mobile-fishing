#requires -Version 7.0
# Default: validate the owner's ignored input file without contacting any service.
# -Apply writes exactly one secret to the confirmed fishing project and verifies its digest.
[CmdletBinding()]
param([switch]$Apply)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'private-supabase-cli.ps1')
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$projectRef = 'jupuypvmgjpnpntfetqv'
$secretName = 'AMAP_WEB_SERVICE_KEY'
$inputPath = Join-Path $projectRoot '.env.amap-web-service.local'
$temporaryPath = $null
$temporaryCreated = $false
$key = $null
$content = $null
$stored = $null

try {
  $linked = Join-Path $projectRoot 'supabase/.temp/project-ref'
  if (!(Test-Path -LiteralPath $linked) -or [IO.File]::ReadAllText($linked).Trim() -ne $projectRef) {
    throw 'Refusing an unconfirmed linked Supabase project.'
  }
  if (!(Test-Path -LiteralPath $inputPath -PathType Leaf)) {
    throw 'The local AMap Web Service input file is missing. No remote change was made.'
  }
  if ((Get-Item -LiteralPath $inputPath).Length -gt 4096) {
    throw 'Unexpected input file size. No remote change was made.'
  }
  $content = [IO.File]::ReadAllText($inputPath)
  $entries = @($content -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ -and !$_.StartsWith('#') })
  if ($entries.Count -ne 1 -or $entries[0] -cnotmatch '^AMAP_WEB_SERVICE_KEY=([a-fA-F0-9]{32})?$') {
    throw 'Use only AMAP_WEB_SERVICE_KEY= followed by the Web Service key; values withheld.'
  }
  $key = $entries[0].Substring($secretName.Length + 1)
  if (!$key) {
    if ($Apply) { throw 'The Web Service key has not been supplied. No remote change was made.' }
    [pscustomobject]@{ project=$projectRef; ready=$false; applied=$false; reason='awaiting_web_service_key' } | ConvertTo-Json -Compress
    return
  }
  if (!$Apply) {
    [pscustomobject]@{ project=$projectRef; ready=$true; applied=$false } | ConvertTo-Json -Compress
    return
  }

  # Freeze only the validated key. Do not forward unrelated env settings or put the key in argv.
  $temporaryPath = [IO.Path]::GetFullPath((Join-Path $projectRoot ('.env.amap-web-service-upload.' + [guid]::NewGuid().ToString('N') + '.local')))
  if ([IO.Path]::GetDirectoryName($temporaryPath) -ne $projectRoot) { throw 'Invalid temporary target.' }
  $stream = [IO.File]::Open($temporaryPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  $temporaryCreated = $true
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($secretName + '=' + $key + "`n")
    $stream.Write($bytes, 0, $bytes.Length)
  } finally {
    $stream.Dispose()
    if ($bytes) { [Array]::Clear($bytes) }
  }
  $null = Invoke-FishingPrivateCli -Arguments @('secrets','set','--env-file',$temporaryPath,'--project-ref',$projectRef)
  $readback = Invoke-FishingPrivateCli -Arguments @('secrets','list','--project-ref',$projectRef,'--output','json')
  try { $stored = $readback | ConvertFrom-Json } catch { throw 'Secret write submitted; digest readback could not be parsed. Values withheld.' }
  $entry = @($stored | Where-Object { $_.name -eq $secretName })
  $expectedDigest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($key))).ToLowerInvariant()
  if ($entry.Count -ne 1 -or $entry[0].value -ne $expectedDigest) {
    throw 'Secret write submitted; stored digest did not match. Values withheld; verify before retrying.'
  }
  [pscustomobject]@{ project=$projectRef; ready=$true; applied=$true; digestVerified=$true; secret=$secretName } | ConvertTo-Json -Compress
} finally {
  if ($temporaryCreated -and [IO.Path]::GetDirectoryName($temporaryPath) -eq $projectRoot) {
    Remove-Item -LiteralPath $temporaryPath -Force
  }
  $key = $null
  $content = $null
  $entries = $null
  $stored = $null
  $readback = $null
  $expectedDigest = $null
}
