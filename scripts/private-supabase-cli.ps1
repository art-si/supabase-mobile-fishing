# For project maintenance scripts only. CLI credentials and raw output remain in this process.
function Invoke-FishingPrivateCli {
  param([string[]]$Arguments, [hashtable]$ChildEnvironment = @{})
  $projectRoot = Split-Path -Parent $PSScriptRoot
  $linked = Join-Path $projectRoot 'supabase/.temp/project-ref'
  if (!(Test-Path -LiteralPath $linked) -or (Get-Content -LiteralPath $linked -Raw).Trim() -ne 'jupuypvmgjpnpntfetqv') {
    throw 'Refusing an unconfirmed linked Supabase project'
  }
  $cliProcess = [Diagnostics.Process]::new()
  $cliProcess.StartInfo.FileName = (Get-Command supabase -CommandType Application).Source
  $cliProcess.StartInfo.WorkingDirectory = $projectRoot
  $cliProcess.StartInfo.UseShellExecute = $false
  $cliProcess.StartInfo.CreateNoWindow = $true
  $cliProcess.StartInfo.RedirectStandardOutput = $true
  $cliProcess.StartInfo.RedirectStandardError = $true
  if (!$env:HTTPS_PROXY) {
    $managementUri = [uri]'https://api.supabase.com'
    $proxyUri = [Net.WebRequest]::GetSystemWebProxy().GetProxy($managementUri)
    if ($proxyUri -ne $managementUri) { $cliProcess.StartInfo.Environment['HTTPS_PROXY'] = $proxyUri.AbsoluteUri }
  }
  foreach ($key in $ChildEnvironment.Keys) { $cliProcess.StartInfo.Environment[$key] = $ChildEnvironment[$key] }
  foreach ($argument in $Arguments) { $cliProcess.StartInfo.ArgumentList.Add($argument) }
  try {
    $null = $cliProcess.Start()
    $outputTask = $cliProcess.StandardOutput.ReadToEndAsync()
    $errorTask = $cliProcess.StandardError.ReadToEndAsync()
    if (!$cliProcess.WaitForExit(45000)) {
      $cliProcess.Kill($true)
      throw 'Supabase CLI timed out; private diagnostics withheld'
    }
    if ($cliProcess.ExitCode -ne 0) {
      $privateDiagnostics = $errorTask.GetAwaiter().GetResult()
      $safeCodes = [regex]::Matches($privateDiagnostics, 'SQLSTATE [A-Z0-9]{5}|HTTP [0-9]{3}|status code [0-9]{3}|violates check constraint "[A-Za-z0-9_]+"') | ForEach-Object { $_.Value }
      $safeKinds = @('TLS handshake timeout','connection refused','context deadline exceeded','unexpected EOF','i/o timeout','No such host','Access token not provided','Unauthorized','Forbidden') | Where-Object { $privateDiagnostics.Contains($_, [StringComparison]::OrdinalIgnoreCase) }
      $privateDiagnostics = $null
      throw ('Supabase CLI failed; private diagnostics withheld' + $(if ($safeCodes -or $safeKinds) { ': ' + ((@($safeCodes) + @($safeKinds)) -join ', ') } else { '' }))
    }
    return $outputTask.GetAwaiter().GetResult()
  } finally {
    $cliProcess.Dispose()
    $outputTask = $null
    $errorTask = $null
  }
}
