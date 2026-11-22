#requires -Version 7.0
# Run manually after creating a dedicated least-privilege RAM AccessKey.
# This script writes only Edge Function Secrets. It NEVER sends an SMS or enables Auth.
param(
  [string]$CliPath = 'D:/supabase/supabase.exe',
  [Security.SecureString]$AccessKeyId,
  [Security.SecureString]$AccessKeySecret
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRef = 'jupuypvmgjpnpntfetqv'
$setupDirectory = Join-Path $PSScriptRoot 'pnvs-secret-setup'
if (-not (Test-Path -LiteralPath $CliPath -PathType Leaf)) { throw 'Supabase CLI not found.' }

$secureValues = @()
$plainValues = @{}
$originalValues = @{}
$writeResult = $null
$readResult = $null
$stored = $null
try {
  Write-Host "Target: $projectRef. Use a RAM key restricted to dypns:SendSmsVerifyCode."
  Write-Host 'Both inputs are hidden. Delivery stays OFF. No SMS will be sent.'
  $idSecure = if ($AccessKeyId) { $AccessKeyId } else { Read-Host 'Aliyun RAM AccessKey ID' -AsSecureString }
  $secureValues += $idSecure
  $keySecure = if ($AccessKeySecret) { $AccessKeySecret } else { Read-Host 'Aliyun RAM AccessKey Secret' -AsSecureString }
  $secureValues += $keySecure
  $plainValues['ALIYUN_PNVS_ACCESS_KEY_ID'] = [System.Net.NetworkCredential]::new('', $idSecure).Password
  $plainValues['ALIYUN_PNVS_ACCESS_KEY_SECRET'] = [System.Net.NetworkCredential]::new('', $keySecure).Password
  if ($plainValues['ALIYUN_PNVS_ACCESS_KEY_ID'] -notmatch '^LTAI[A-Za-z0-9]{12,124}$' -or
      $plainValues['ALIYUN_PNVS_ACCESS_KEY_SECRET'] -notmatch '^[A-Za-z0-9]{16,128}$') {
    throw 'RAM key format is invalid. No remote changes were made.'
  }

  $plainValues['ALIYUN_PNVS_SIGN_NAME'] = '恒创联众'
  $plainValues['ALIYUN_PNVS_TEMPLATE_CODE'] = '100001'
  $plainValues['ALIYUN_PNVS_SCHEME_NAME'] = '钓友集登录'
  $plainValues['SMS_OTP_EXPIRY_SECONDS'] = '300'
  $plainValues['SMS_MIN_INTERVAL_SECONDS'] = '60'
  $plainValues['SMS_DELIVERY_ENABLED'] = 'false'
  $environmentMap = @{
    ALIYUN_PNVS_ACCESS_KEY_ID = 'DYJ_SETUP_PNVS_KEY_ID'
    ALIYUN_PNVS_ACCESS_KEY_SECRET = 'DYJ_SETUP_PNVS_KEY_SECRET'
    ALIYUN_PNVS_SIGN_NAME = 'DYJ_SETUP_PNVS_SIGN'
    ALIYUN_PNVS_TEMPLATE_CODE = 'DYJ_SETUP_PNVS_TEMPLATE'
    ALIYUN_PNVS_SCHEME_NAME = 'DYJ_SETUP_PNVS_SCHEME'
    SMS_OTP_EXPIRY_SECONDS = 'DYJ_SETUP_SMS_EXPIRY'
    SMS_MIN_INTERVAL_SECONDS = 'DYJ_SETUP_SMS_INTERVAL'
    SMS_DELIVERY_ENABLED = 'DYJ_SETUP_SMS_ENABLED'
  }
  foreach ($name in @($environmentMap.Values) + @('HTTP_PROXY', 'HTTPS_PROXY')) {
    $originalValues[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  }
  foreach ($secretName in $environmentMap.Keys) {
    [Environment]::SetEnvironmentVariable($environmentMap[$secretName], $plainValues[$secretName], 'Process')
  }
  $proxyUri = [System.Net.WebRequest]::GetSystemWebProxy().GetProxy([uri]'https://api.supabase.com')
  if ($proxyUri.Host -ne 'api.supabase.com') {
    $env:HTTPS_PROXY = $proxyUri.AbsoluteUri
    $env:HTTP_PROXY = $proxyUri.AbsoluteUri
  }

  # No credential values in arguments, files, transcripts or printed diagnostics.
  $writeResult = & $CliPath secrets set --project-ref $projectRef --workdir $setupDirectory 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'Secret write failed. Upstream diagnostics withheld; do not paste secrets into chat.' }
  $readResult = & $CliPath secrets list --project-ref $projectRef --output json --workdir $setupDirectory 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'Write submitted, but digest readback failed. Verify before retrying.' }
  $stored = $readResult | ConvertFrom-Json
  foreach ($name in $plainValues.Keys) {
    $digest = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData(
      [Text.Encoding]::UTF8.GetBytes($plainValues[$name])
    )).ToLowerInvariant()
    $entry = @($stored | Where-Object { $_.name -eq $name })
    if ($entry.Count -ne 1 -or $entry[0].value -ne $digest) {
      throw 'Stored digest did not match. Values withheld; verify before retrying.'
    }
  }
  [pscustomobject]@{
    Project = $projectRef
    SavedAndVerified = @($plainValues.Keys | Sort-Object)
    SmsDelivery = 'disabled'
    SmsSent = 0
  } | ConvertTo-Json -Compress
} finally {
  foreach ($name in $originalValues.Keys) {
    [Environment]::SetEnvironmentVariable($name, $originalValues[$name], 'Process')
  }
  foreach ($secureValue in $secureValues) { $secureValue.Dispose() }
  $plainValues.Clear()
  $writeResult = $null
  $readResult = $null
  $stored = $null
}
