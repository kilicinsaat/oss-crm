param(
  [Parameter(Mandatory = $true)][ValidateSet('incoming', 'answer', 'start', 'end')][string]$EventType,
  [Parameter(Mandatory = $true)][string]$Phone
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $root 'bridge-config.json'
$queuePath = Join-Path $root 'queue'
$logPath = Join-Path $root 'bridge.log'

function Write-BridgeLog([string]$Message) {
  Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) $Message" -Encoding UTF8
}

if (-not (Test-Path -LiteralPath $configPath)) {
  Write-BridgeLog 'bridge-config.json bulunamadı.'
  exit 1
}

$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $config.endpoint -or -not $config.secret -or -not $config.profileId -or -not $config.deviceId) {
  Write-BridgeLog 'Yapılandırma eksik.'
  exit 1
}

New-Item -ItemType Directory -Path $queuePath -Force | Out-Null
$digits = ($Phone -replace '\D', '')
if ($digits.StartsWith('0090')) { $digits = $digits.Substring(4) }
if ($digits.StartsWith('90') -and $digits.Length -eq 12) { $digits = $digits.Substring(2) }
if ($digits.StartsWith('0') -and $digits.Length -eq 11) { $digits = $digits.Substring(1) }
if ($digits -notmatch '^5\d{9}$') {
  Write-BridgeLog "Geçersiz telefon atlandı: $Phone"
  exit 0
}

$payload = [ordered]@{
  eventType = $EventType
  phone = $digits
  profileId = [string]$config.profileId
  deviceId = [string]$config.deviceId
  occurredAt = (Get-Date).ToUniversalTime().ToString('o')
}
$eventFile = Join-Path $queuePath "$([guid]::NewGuid().ToString('N')).json"
$payload | ConvertTo-Json -Compress | Set-Content -LiteralPath $eventFile -Encoding UTF8

Get-ChildItem -LiteralPath $queuePath -Filter '*.json' | Sort-Object CreationTime | Select-Object -First 25 | ForEach-Object {
  try {
    $body = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8
    Invoke-RestMethod -Uri $config.endpoint -Method Post -Headers @{ Authorization = "Bearer $($config.secret)" } -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 12 | Out-Null
    Remove-Item -LiteralPath $_.FullName -Force
  } catch {
    Write-BridgeLog "Gönderim beklemeye alındı: $($_.Exception.Message)"
    break
  }
}

