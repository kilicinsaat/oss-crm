param(
  [Parameter(Mandatory = $true)][string]$Endpoint,
  [Parameter(Mandatory = $true)][string]$Secret,
  [Parameter(Mandatory = $true)][string]$ProfileId,
  [string]$MicroSipIni = "$env:APPDATA\MicroSIP\microsip.ini"
)

$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$installRoot = Join-Path $env:LOCALAPPDATA 'OSSCallBridge'
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot 'oss-call-bridge.ps1') -Destination $installRoot -Force

$deviceId = "$(($env:COMPUTERNAME -replace '[^a-zA-Z0-9_-]', '-').ToLower())-$($ProfileId.Substring(0, 8))"
[ordered]@{
  endpoint = $Endpoint.TrimEnd('/')
  secret = $Secret
  profileId = $ProfileId
  deviceId = $deviceId
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installRoot 'bridge-config.json') -Encoding UTF8

if (-not (Test-Path -LiteralPath $MicroSipIni)) {
  throw "MicroSIP ayar dosyası bulunamadı: $MicroSipIni"
}

$backup = "$MicroSipIni.oss-backup-$(Get-Date -Format yyyyMMddHHmmss)"
Copy-Item -LiteralPath $MicroSipIni -Destination $backup
$content = Get-Content -LiteralPath $MicroSipIni -Raw -Encoding UTF8
$bridge = Join-Path $installRoot 'oss-call-bridge.ps1'
$commands = [ordered]@{
  cmdIncomingCall = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $bridge incoming"
  cmdCallAnswer = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $bridge answer"
  cmdCallStart = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $bridge start"
  cmdCallEnd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $bridge end"
}

foreach ($entry in $commands.GetEnumerator()) {
  $line = "$($entry.Key)=$($entry.Value)"
  if ($content -match "(?m)^$([regex]::Escape($entry.Key))=.*$") {
    $content = [regex]::Replace($content, "(?m)^$([regex]::Escape($entry.Key))=.*$", $line)
  } else {
    $content = $content.TrimEnd() + "`r`n$line`r`n"
  }
}
$content | Set-Content -LiteralPath $MicroSipIni -Encoding UTF8

Write-Host "OSS Call Bridge kuruldu: $installRoot"
Write-Host "MicroSIP yedeği: $backup"
Write-Host 'MicroSIP uygulamasını tamamen kapatıp yeniden açın.'
