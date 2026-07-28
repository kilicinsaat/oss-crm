param(
  [string]$JettelBaseUrl = 'https://vip.jettel.com.tr',
  [string]$JettelUsername,
  [string]$JettelPassword,
  [string]$JettelToken,
  [string]$JettelApicode,
  [string]$IngestEndpoint = 'https://aeaetnpeyksfvlhiijil.supabase.co/functions/v1/jettel-bridge-ingest',
  [string]$BridgeSecret,
  [int]$IntervalSeconds = 30,
  [string]$Extensions = '101,102,103,104,105,106,107,108,109,110',
  [string]$JettelPbxSuffix = 'pbx349',
  [switch]$DisableActiveCallsSync,
  [switch]$DisableCallReportSync,
  [int]$CallReportLookbackDays = 2,
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
    ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) -replace '[\x00-\x1F\x7F]', '').Trim()
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Clean-ConfigText([object]$Value) {
  return ([string]$Value -replace '[\x00-\x1F\x7F]', '').Trim()
}

if (-not $JettelUsername) { $JettelUsername = Read-Host 'JETTEL_USERNAME' }
if (-not $JettelPassword) { $JettelPassword = Read-SecretText 'JETTEL_PASSWORD' }
if (-not $JettelToken) { $JettelToken = Read-Host 'JETTEL_TOKEN' }
if (-not $JettelApicode) { $JettelApicode = Read-Host 'JETTEL_APICODE' }
if (-not $BridgeSecret) { $BridgeSecret = Read-SecretText 'CALL_BRIDGE_SECRET' }

$JettelUsername = Clean-ConfigText $JettelUsername
$JettelPassword = Clean-ConfigText $JettelPassword
$JettelToken = Clean-ConfigText $JettelToken
$JettelApicode = Clean-ConfigText $JettelApicode
$BridgeSecret = Clean-ConfigText $BridgeSecret

$missingConfig = @()
if (-not $JettelUsername) { $missingConfig += 'JETTEL_USERNAME' }
if (-not $JettelPassword) { $missingConfig += 'JETTEL_PASSWORD' }
if (-not $JettelToken) { $missingConfig += 'JETTEL_TOKEN' }
if (-not $JettelApicode) { $missingConfig += 'JETTEL_APICODE' }
if (-not $BridgeSecret) { $missingConfig += 'CALL_BRIDGE_SECRET' }
if ($missingConfig.Count -gt 0) {
  throw "Eksik bilgi girildi: $($missingConfig -join ', '). Kurulumu tekrar calistirip bu alanlari bos birakmadan gir."
}

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
  extensions = $Extensions
  jettelPbxSuffix = $JettelPbxSuffix
  syncActiveCalls = -not [bool]$DisableActiveCallsSync
  syncCallReport = -not [bool]$DisableCallReportSync
  callReportLookbackDays = $CallReportLookbackDays
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installRoot 'jettel-sync-config.json') -Encoding UTF8

$syncScript = Join-Path $installRoot 'jettel-local-sync.ps1'
Write-Host "Jettel local sync kuruldu: $installRoot" -ForegroundColor Green

Write-Host ''
Write-Host 'Tek seferlik test calisiyor...' -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $syncScript -CallReportLookbackDays $CallReportLookbackDays -Extensions $Extensions
if ($LASTEXITCODE -ne 0) {
  throw "Tek seferlik test basarisiz oldu. Yukaridaki hata mesajini kontrol et."
}
Write-Host 'Test tamam. CRM Dahili Yonetimi ekraninda durumlar guncellenmis olmali.' -ForegroundColor Green

if (-not $NoScheduledTask) {
  $taskName = 'OSS Jettel Local Sync'
  $taskArgument = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$syncScript`" -Loop -IntervalSeconds $IntervalSeconds -CallReportLookbackDays $CallReportLookbackDays -Extensions `"$Extensions`""
  $action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument $taskArgument
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)

  try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName
    Write-Host "Windows gorev zamanlayici aktif: $taskName" -ForegroundColor Green
  } catch {
    Write-Host "Gorev zamanlayici izni alinamadi. Startup klasoru ile otomatik baslatma kuruluyor..." -ForegroundColor Yellow
    $startupPath = [Environment]::GetFolderPath('Startup')
    $startupCmd = Join-Path $startupPath 'OSS-Jettel-Local-Sync.cmd'
    "@echo off`r`nstart `"OSS Jettel Local Sync`" /min powershell.exe $taskArgument`r`n" | Set-Content -LiteralPath $startupCmd -Encoding ASCII
    Start-Process -FilePath 'powershell.exe' -ArgumentList $taskArgument -WindowStyle Hidden
    Write-Host "Startup otomatik baslatma aktif: $startupCmd" -ForegroundColor Green
  }
  Write-Host "Bu PC acikken Jettel durumlari ve aktif cagri bilgisi $IntervalSeconds saniyede bir Supabase'e aktarilir." -ForegroundColor Green
}

Write-Host ''
Write-Host 'Log dosyasi:' -ForegroundColor Cyan
Write-Host (Join-Path $installRoot 'jettel-sync.log')
