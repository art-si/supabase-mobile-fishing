#requires -Version 7.0
# Uses only the existing Supabase CLI default credential, never enumerates credentials.
# Default: read-only status. -Prepare: prebind the hook with all sending disabled.
# -EnableLogin: enable phone + hook routing, requiring delivery to remain disabled.
# -EnableDelivery / -DisableDelivery: toggle SMS delivery for mainland numbers.
param([switch]$Prepare, [switch]$EnableLogin, [switch]$ConfigurePassword,
  [switch]$EnableDelivery, [Alias('DisableTestDelivery')][switch]$DisableDelivery)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRef = 'jupuypvmgjpnpntfetqv'
$apiRoot = "https://api.supabase.com/v1/projects/$projectRef"
$hookUri = "https://$projectRef.supabase.co/functions/v1/send-sms-hook"
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class FishingSupabaseCredential {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  private struct Credential {
    public UInt32 Flags; public UInt32 Type; public IntPtr TargetName; public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist;
    public UInt32 AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern bool Read(string target, UInt32 type, UInt32 flags, out IntPtr value);
  [DllImport("advapi32.dll")] private static extern void CredFree(IntPtr value);
  public static string ReadCliDefault() {
    IntPtr value;
    if (!Read("Supabase CLI:supabase", 1, 0, out value)) return null;
    try {
      var cred = Marshal.PtrToStructure<Credential>(value);
      var bytes = new byte[cred.CredentialBlobSize];
      Marshal.Copy(cred.CredentialBlob, bytes, 0, bytes.Length);
      try { return Encoding.UTF8.GetString(bytes); } finally { Array.Clear(bytes, 0, bytes.Length); }
    } finally { CredFree(value); }
  }
}
'@
$token = $null
$headers = $null
$authConfig = $null
$hookSecret = $null
$idempotencySecret = $null
$newSecrets = @()
function Invoke-ProjectApi([string]$Path, [string]$Method = 'GET', [object]$Body = $null) {
  $requestOptions = @{ Uri = "$apiRoot$Path"; Method = $Method; Headers = $headers; TimeoutSec = 25; MaximumRedirection = 0 }
  if ($null -ne $Body) {
    $requestOptions.ContentType = 'application/json'
    $requestOptions.Body = ConvertTo-Json -InputObject $Body -Depth 8 -Compress
  }
  try {
    $result = Invoke-RestMethod @requestOptions
    return $result
  } catch {
    # Upstream bodies or request dumps can contain secrets: never emit them.
    $responseProperty = $_.Exception.PSObject.Properties['Response']
    $status = if ($responseProperty -and $responseProperty.Value) { [int]$responseProperty.Value.StatusCode } else { 0 }
    throw "Project configuration request failed (HTTP $status). Sensitive diagnostics withheld."
  }
}
function Secret-Digest([string]$Value) {
  [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Value))).ToLowerInvariant()
}
function Auth-SecretDigest([string]$Value) {
  # Management API Auth config returns HMAC-SHA256 keyed by the project reference.
  $hmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($projectRef))
  try { [Convert]::ToHexString($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))).ToLowerInvariant() }
  finally { $hmac.Dispose() }
}
try {
  if (@(@($Prepare, $EnableLogin, $ConfigurePassword, $EnableDelivery, $DisableDelivery) | Where-Object { $_ }).Count -gt 1) { throw 'Configuration operations must be separate.' }
  $token = [FishingSupabaseCredential]::ReadCliDefault()
  if ($token -notmatch '^sbp_(oauth_)?[a-f0-9]{40}$') { throw 'Supabase CLI default login not available. No changes made.' }
  $headers = @{ Authorization = "Bearer $token" }
  $authConfig = Invoke-ProjectApi '/config/auth'
  $stored = @(Invoke-ProjectApi '/secrets')
  if ($DisableDelivery) {
    $null = Invoke-ProjectApi '/secrets' 'POST' @(@{ name = 'SMS_DELIVERY_ENABLED'; value = 'false' })
    $stored = @(Invoke-ProjectApi '/secrets')
    if (@($stored | Where-Object { $_.name -eq 'SMS_DELIVERY_ENABLED' -and $_.value -eq (Secret-Digest 'false') }).Count -ne 1) {
      throw 'Could not confirm SMS delivery is disabled. Do not make further OTP requests.'
    }
  }
  if ($EnableDelivery) {
    if (-not $authConfig.external_phone_enabled -or -not $authConfig.hook_send_sms_enabled -or
        $authConfig.hook_send_sms_uri -ne $hookUri -or $authConfig.sms_autoconfirm -or
        [string]::IsNullOrEmpty($authConfig.hook_send_sms_secrets) -or
        $authConfig.sms_otp_length -ne 6 -or $authConfig.sms_otp_exp -ne 300 -or
        $authConfig.sms_max_frequency -lt 60) { throw 'Auth configuration is not ready for SMS delivery.' }
    foreach ($required in @('SEND_SMS_HOOK_SECRET', 'SMS_IDEMPOTENCY_SECRET', 'ALIYUN_PNVS_ACCESS_KEY_ID',
        'ALIYUN_PNVS_ACCESS_KEY_SECRET', 'ALIYUN_PNVS_SIGN_NAME', 'ALIYUN_PNVS_TEMPLATE_CODE',
        'ALIYUN_PNVS_SCHEME_NAME', 'SMS_OTP_EXPIRY_SECONDS', 'SMS_MIN_INTERVAL_SECONDS')) {
      if (@($stored | Where-Object name -eq $required).Count -ne 1) { throw 'Required server configuration is missing. Delivery remains unchanged.' }
    }
    $null = Invoke-ProjectApi '/secrets' 'POST' @(@{ name = 'SMS_DELIVERY_ENABLED'; value = 'true' })
    $stored = @(Invoke-ProjectApi '/secrets')
    if (@($stored | Where-Object { $_.name -eq 'SMS_DELIVERY_ENABLED' -and $_.value -eq (Secret-Digest 'true') }).Count -ne 1) {
      # Fail closed if activation cannot be confirmed.
      $null = Invoke-ProjectApi '/secrets' 'POST' @(@{ name = 'SMS_DELIVERY_ENABLED'; value = 'false' })
      throw 'Could not confirm delivery activation. Sending disabled again.'
    }
  }
  if ($ConfigurePassword) {
    if (@($stored | Where-Object { $_.name -eq 'SMS_DELIVERY_ENABLED' -and $_.value -eq (Secret-Digest 'false') }).Count -ne 1) {
      throw 'Password preparation requires SMS delivery to remain disabled.'
    }
    $null = Invoke-ProjectApi '/config/auth' 'PATCH' @{
      password_min_length = 8
      password_required_characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789'
      security_update_password_require_reauthentication = $true
      # A freshly verified SMS session can recover a forgotten password.
      security_update_password_require_current_password = $false
      refresh_token_rotation_enabled = $true
    }
    $authConfig = Invoke-ProjectApi '/config/auth'
    if ($authConfig.password_min_length -ne 8 -or
        $authConfig.password_required_characters -ne 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789' -or
        -not $authConfig.security_update_password_require_reauthentication -or
        $authConfig.security_update_password_require_current_password -or
        -not $authConfig.refresh_token_rotation_enabled) { throw 'Password configuration readback mismatch.' }
    $stored = @(Invoke-ProjectApi '/secrets')
  }
  if ($Prepare) {
    if ($authConfig.external_phone_enabled -or $authConfig.hook_send_sms_enabled) {
      throw 'Phone or SMS hook already enabled. Refusing to overwrite active configuration.'
    }
    $existingAuthDigest = [string]$authConfig.hook_send_sms_secrets
    $hookEntries = @($stored | Where-Object name -eq 'SEND_SMS_HOOK_SECRET')
    if (-not [string]::IsNullOrEmpty($existingAuthDigest) -or $hookEntries.Count -gt 0) {
      throw 'Existing hook secret found. Refusing automatic rotation; inspect the existing setup instead.'
    }
    $hookSecret = 'v1,whsec_' + [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    $newSecrets += @{ name = 'SEND_SMS_HOOK_SECRET'; value = $hookSecret }
    $newSecrets += @{ name = 'SMS_DELIVERY_ENABLED'; value = 'false' }
    if (@($stored | Where-Object name -eq 'SMS_IDEMPOTENCY_SECRET').Count -eq 0) {
      $idempotencySecret = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
      $newSecrets += @{ name = 'SMS_IDEMPOTENCY_SECRET'; value = $idempotencySecret }
    }
    $null = Invoke-ProjectApi '/secrets' 'POST' $newSecrets
    $stored = @(Invoke-ProjectApi '/secrets')
    foreach ($entry in $newSecrets) {
      $verified = @($stored | Where-Object name -eq $entry.name)
      if ($verified.Count -ne 1 -or $verified[0].value -ne (Secret-Digest $entry.value)) {
        throw 'Edge secret digest verification failed. Auth remains unchanged; do not enable sending.'
      }
    }
    $null = Invoke-ProjectApi '/config/auth' 'PATCH' @{
      external_phone_enabled = $false
      sms_autoconfirm = $false
      hook_send_sms_enabled = $false
      hook_send_sms_uri = $hookUri
      hook_send_sms_secrets = $hookSecret
    }
    $authConfig = Invoke-ProjectApi '/config/auth'
    if ($authConfig.hook_send_sms_uri -ne $hookUri -or
        $authConfig.hook_send_sms_secrets -ne (Auth-SecretDigest $hookSecret) -or
        $authConfig.external_phone_enabled -or $authConfig.sms_autoconfirm -or $authConfig.hook_send_sms_enabled) {
      throw 'Auth readback did not match the disabled prepared configuration. Do not enable sending.'
    }
  }
  if ($EnableLogin) {
    $requiredSecrets = @('SEND_SMS_HOOK_SECRET', 'SMS_IDEMPOTENCY_SECRET', 'ALIYUN_PNVS_ACCESS_KEY_ID', 'ALIYUN_PNVS_ACCESS_KEY_SECRET', 'ALIYUN_PNVS_SIGN_NAME', 'ALIYUN_PNVS_TEMPLATE_CODE')
    foreach ($required in $requiredSecrets) {
      if (@($stored | Where-Object name -eq $required).Count -ne 1) { throw 'Required server configuration missing. Login was not enabled.' }
    }
    $delivery = @($stored | Where-Object name -eq 'SMS_DELIVERY_ENABLED')
    if ($delivery.Count -ne 1 -or $delivery[0].value -ne (Secret-Digest 'false')) {
      throw 'This preparation requires SMS delivery to remain disabled.'
    }
    if ($authConfig.hook_send_sms_uri -ne $hookUri -or [string]::IsNullOrEmpty($authConfig.hook_send_sms_secrets)) { throw 'Hook binding missing. Login was not enabled.' }
    $null = Invoke-ProjectApi '/config/auth' 'PATCH' @{
      external_phone_enabled = $true
      sms_autoconfirm = $false
      hook_send_sms_enabled = $true
      sms_otp_exp = 300
      sms_otp_length = 6
      sms_max_frequency = 60
    }
    $authConfig = Invoke-ProjectApi '/config/auth'
    if (-not $authConfig.external_phone_enabled -or -not $authConfig.hook_send_sms_enabled -or $authConfig.sms_autoconfirm -or $authConfig.sms_otp_exp -ne 300 -or $authConfig.sms_otp_length -ne 6) { throw 'Login configuration readback mismatch; inspect before proceeding.' }
  }
  $secretNames = @($stored | ForEach-Object { $_ } | ForEach-Object { $_.name })
  [pscustomobject]@{
    Project = $projectRef
    Prepared = [bool]$Prepare
    PhoneEnabled = [bool]$authConfig.external_phone_enabled
    AutoConfirm = [bool]$authConfig.sms_autoconfirm
    HookEnabled = [bool]$authConfig.hook_send_sms_enabled
    HookUriMatches = $authConfig.hook_send_sms_uri -eq $hookUri
    HookSecretConfigured = -not [string]::IsNullOrEmpty($authConfig.hook_send_sms_secrets)
    SmsDeliveryDisabled = @($stored | Where-Object { $_.name -eq 'SMS_DELIVERY_ENABLED' -and $_.value -eq (Secret-Digest 'false') }).Count -eq 1
    OtpLength = $authConfig.sms_otp_length
    OtpExpirySeconds = $authConfig.sms_otp_exp
    MinimumIntervalSeconds = $authConfig.sms_max_frequency
    CaptchaEnabled = [bool]$authConfig.security_captcha_enabled
    SignupDisabled = [bool]$authConfig.disable_signup
    PasswordMinimumLength = $authConfig.password_min_length
    PasswordLettersAndDigits = $authConfig.password_required_characters -eq 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789'
    PasswordReauthentication = [bool]$authConfig.security_update_password_require_reauthentication
    PasswordRecoveryViaFreshSms = -not [bool]$authConfig.security_update_password_require_current_password
    RefreshTokenRotation = [bool]$authConfig.refresh_token_rotation_enabled
    SignNameMatches = @($stored | Where-Object { $_.name -eq 'ALIYUN_PNVS_SIGN_NAME' -and $_.value -eq (Secret-Digest '恒创联众') }).Count -eq 1
    TemplateMatches = @($stored | Where-Object { $_.name -eq 'ALIYUN_PNVS_TEMPLATE_CODE' -and $_.value -eq (Secret-Digest '100001') }).Count -eq 1
    EdgeHookSecretConfigured = $secretNames -contains 'SEND_SMS_HOOK_SECRET'
    IdempotencySecretConfigured = $secretNames -contains 'SMS_IDEMPOTENCY_SECRET'
    AliyunIdConfigured = $secretNames -contains 'ALIYUN_PNVS_ACCESS_KEY_ID'
    AliyunSecretConfigured = $secretNames -contains 'ALIYUN_PNVS_ACCESS_KEY_SECRET'
    SmsDispatchRequestsFromHelper = 0
  } | ConvertTo-Json -Compress
} finally {
  $token = $null; $headers = $null; $authConfig = $null; $hookSecret = $null; $idempotencySecret = $null; $newSecrets = @(); $stored = $null
}
