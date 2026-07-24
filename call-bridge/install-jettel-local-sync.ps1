param(
  [string]$JettelBaseUrl = 'https://vip.jettel.com.tr',
  [string]$JettelUsername,
  [string]$JettelPassword,
  [string]$JettelToken,
  [string]$JettelApicode,
  [string]$IngestEndpoint = 'https://aeaetnpeyksfvlhiijil.supabase.co/functions/v1/jettel-bridge-ingest',
  [string]$BridgeSecret,
  [int]$IntervalSeconds = 30,
  [switch]$NoScheduledTask
)

$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$installRoot = Join-Path $env:LOCALAPPDATA 'OSSCallBridge'
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null

function Read-SecretText([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

if (-not $JettelUsername) { $JettelUsername = Read-Host 'JETTEL_USERNAME' }
if (-not $JettelPassword) { $JettelPassword = Read-SecretText 'JETTEL_PASSWORD' }
if (-not $JettelToken) { $JettelToken = Read-Host 'JETTEL_TOKEN' }
if (-not $JettelApicode) { $JettelApicode = Read-Host 'JETTEL_APICODE' }
if (-not $BridgeSecret) { $BridgeSecret = Read-SecretText 'CALL_BRIDGE_SECRET' }

Copy-Item -LiteralPath (Join-Path $sourceRoot 'jettel-local-sync.ps1') -Destination $installRoot -Force

[ordered]@{
  jettelBaseUrl = $JettelBaseUrl.TrimEnd('/')
  jettelUsername = $JettelUsername
  jettelPassword = $JettelPassword
  jettelToken = $JettelToken
  jettelApicode = $JettelApicode
  ingestEndpoint = $IngestEndpoint.TrimEnd('/')
  bridgeSecret = $BridgeSecret
  intervalSeconds = $IntervalSeconds
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installRoot 'jettel-sync-config.json') -Encoding UTF8

$syncScript = Join-Path $installRoot 'jettel-local-sync.ps1'
Write-Host "Jettel local sync kuruldu: $installRoot" -ForegroundColor Green

Write-Host ''
Write-Host 'Tek seferlik test calisiyor...' -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript
Write-Host 'Test tamam. CRM Dahili Yonetimi ekraninda durumlar guncellenmis olmali.' -ForegroundColor Green

if (-not $NoScheduledTask) {
  $taskName = 'OSS Jettel Local Sync'
  $action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$syncScript`" -Loop -IntervalSeconds $IntervalSeconds"
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)

  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName
  Write-Host "Windows gorev zamanlayici aktif: $taskName" -ForegroundColor Green
  Write-Host "Bu PC acikken Jettel durumlari $IntervalSeconds saniyede bir Supabase'e aktarilir." -ForegroundColor Green
}

Write-Host ''
Write-Host 'Log dosyasi:' -ForegroundColor Cyan
Write-Host (Join-Path $installRoot 'jettel-sync.log')
