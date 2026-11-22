# Copies the existing project-scoped Vault secret into Edge secrets without displaying it.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'private-supabase-cli.ps1')
$projectRef = 'jupuypvmgjpnpntfetqv'
$secretName = 'MEDIA_CLEANUP_HMAC_KEY'
$setupDirectory = Join-Path $PSScriptRoot 'media-cleanup-secret-setup'
$secretValue = $null
$privateRead = $null
$childSecrets = @{}
$stage = 'read-vault'
try {
  $privateRead = Invoke-FishingPrivateCli -Arguments @('db','query','--linked','--output','json','select decrypted_secret as value from vault.decrypted_secrets where name=''fishing_media_cleanup_hmac''')
  try { $parsed = $privateRead | ConvertFrom-Json } catch { throw 'Private query response could not be parsed' }
  $rows = if ($parsed.PSObject.Properties['rows']) { @($parsed.rows) } else { @($parsed) }
  if ($rows.Count -ne 1 -or $rows[0].value -cnotmatch '^[a-f0-9]{64}$') { throw 'Expected one project cleanup signing key' }
  $secretValue = [string]$rows[0].value
  $stage = 'set-edge-secret'
  $childSecrets['DYJ_SETUP_MEDIA_CLEANUP_KEY'] = $secretValue
  $null = Invoke-FishingPrivateCli -Arguments @('secrets','set','--project-ref',$projectRef,'--workdir',$setupDirectory) -ChildEnvironment $childSecrets
  $stage = 'read-digest'
  $storedOutput = Invoke-FishingPrivateCli -Arguments @('secrets','list','--project-ref',$projectRef,'--output','json','--workdir',$setupDirectory)
  try { $stored = $storedOutput | ConvertFrom-Json } catch { throw 'Secret digest response could not be parsed' }
  $storedRows = if ($stored.PSObject.Properties['rows']) { @($stored.rows) } else { @($stored) }
  $stage = 'compare-digest'
  $expectedDigest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($secretValue))).ToLowerInvariant()
  $entry = @($storedRows | Where-Object { $_.name -eq $secretName })
  if ($entry.Count -ne 1 -or $entry[0].value -cne $expectedDigest) { throw 'Secret digest readback did not match' }
  @{ project = $projectRef; secret = $secretName; digestVerified = $true; schedulerEnabled = $false } | ConvertTo-Json -Compress
} catch {
  # Neither provider diagnostics nor a malformed secret response may enter logs.
  Write-Output "Cleanup secret configuration did not finish verification at $stage; private diagnostics withheld."
  exit 1
} finally {
  $secretValue = $null
  $privateRead = $null
  $parsed = $null
  $rows = $null
  $childSecrets.Clear()
}
