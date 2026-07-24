param(
  [switch]$Loop,
  [int]$IntervalSeconds = 30
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $root 'jettel-sync-config.json'
$logPath = Join-Path $root 'jettel-sync.log'

function Write-SyncLog([string]$Message) {
  Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) $Message" -Encoding UTF8
}

function Read-Config {
  if (-not (Test-Path -LiteralPath $configPath)) {
    throw "jettel-sync-config.json bulunamadi: $configPath"
  }
  $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $required = @('jettelBaseUrl', 'jettelUsername', 'jettelPassword', 'jettelToken', 'jettelApicode', 'ingestEndpoint', 'bridgeSecret')
  foreach ($key in $required) {
    if (-not $config.$key) { throw "Jettel sync config eksik: $key" }
  }
  return $config
}

function Invoke-JettelPost([object]$Config, [string]$Mode, [hashtable]$Fields) {
  $baseUrl = ([string]$Config.jettelBaseUrl).TrimEnd('/')
  if ($baseUrl -match '/api/v1\.php$') {
    $url = "$baseUrl?mode=$([uri]::EscapeDataString($Mode))"
  } else {
    $url = "$baseUrl/api/v1.php?mode=$([uri]::EscapeDataString($Mode))"
  }

  $body = @{
    token = [string]$Config.jettelToken
    apicode = [string]$Config.jettelApicode
    username = [string]$Config.jettelUsername
    password = [string]$Config.jettelPassword
  }
  foreach ($entry in $Fields.GetEnumerator()) {
    if ($null -ne $entry.Value -and "$($entry.Value)".Trim()) {
      $body[$entry.Key] = [string]$entry.Value
    }
  }

  Invoke-RestMethod `
    -Uri $url `
    -Method Post `
    -Body $body `
    -ContentType 'application/x-www-form-urlencoded; charset=utf-8' `
    -Headers @{ Accept = 'application/json, text/plain, */*'; 'User-Agent' = 'OSS-CRM-Jettel-LocalSync/1.0' } `
    -TimeoutSec 30
}

function Send-ToSupabase([object]$Config, [object]$RawResponse) {
  $payload = [ordered]@{
    eventType = 'extension-status'
    sourceDevice = $env:COMPUTERNAME
    occurredAt = (Get-Date).ToUniversalTime().ToString('o')
    raw = $RawResponse
  }
  $json = $payload | ConvertTo-Json -Depth 40 -Compress

  Invoke-RestMethod `
    -Uri ([string]$Config.ingestEndpoint) `
    -Method Post `
    -Headers @{ Authorization = "Bearer $($Config.bridgeSecret)" } `
    -ContentType 'application/json; charset=utf-8' `
    -Body $json `
    -TimeoutSec 20 | Out-Null
}

function Sync-Once {
  $config = Read-Config
  $response = Invoke-JettelPost -Config $config -Mode 'ExtensionStatus' -Fields @{}
  Send-ToSupabase -Config $config -RawResponse $response
  Write-SyncLog 'ExtensionStatus Supabase aktarimi basarili.'
}

if ($Loop) {
  Write-SyncLog "Jettel local sync loop basladi. Interval=${IntervalSeconds}s"
  while ($true) {
    try {
      Sync-Once
    } catch {
      Write-SyncLog "HATA: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds ([Math]::Max(10, $IntervalSeconds))
  }
}

try {
  Sync-Once
} catch {
  Write-SyncLog "HATA: $($_.Exception.Message)"
  throw
}
