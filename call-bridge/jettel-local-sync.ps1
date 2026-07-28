param(
  [switch]$Loop,
  [int]$IntervalSeconds = 30,
  [switch]$DisableActiveCallsSync,
  [switch]$SyncCallReport,
  [int]$CallReportLookbackDays = 2,
  [string]$Extensions = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $root 'jettel-sync-config.json'
$logPath = Join-Path $root 'jettel-sync.log'

function Write-SyncLog([string]$Message) {
  Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) $Message" -Encoding UTF8
}

function Clean-ConfigText([object]$Value) {
  return ([string]$Value -replace '[\x00-\x1F\x7F]', '').Trim()
}

function Read-Config {
  if (-not (Test-Path -LiteralPath $configPath)) {
    throw "jettel-sync-config.json bulunamadi: $configPath"
  }
  $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $required = @('jettelBaseUrl', 'jettelUsername', 'jettelPassword', 'jettelToken', 'jettelApicode', 'ingestEndpoint', 'bridgeSecret')
  foreach ($key in $required) {
    if (-not $config.$key) { throw "Jettel sync config eksik: $key" }
    $config.$key = Clean-ConfigText $config.$key
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

function Send-ToSupabase([object]$Config, [string]$EventType, [object]$RawResponse, [hashtable]$Meta = @{}) {
  $payload = [ordered]@{
    eventType = $EventType
    sourceDevice = $env:COMPUTERNAME
    occurredAt = (Get-Date).ToUniversalTime().ToString('o')
    meta = $Meta
    raw = $RawResponse
  }
  $json = $payload | ConvertTo-Json -Depth 40 -Compress

  try {
    Invoke-RestMethod `
      -Uri ([string]$Config.ingestEndpoint) `
      -Method Post `
      -Headers @{ 'X-Bridge-Secret' = "$(Clean-ConfigText $Config.bridgeSecret)" } `
      -ContentType 'application/json; charset=utf-8' `
      -Body $json `
      -TimeoutSec 20 | Out-Null
  } catch {
    $detail = $_.Exception.Message
    if ($_.Exception.Response) {
      try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $responseText = $reader.ReadToEnd()
        if ($responseText) { $detail = "$detail :: $responseText" }
      } catch {}
    }
    throw $detail
  }
}

function Get-ConfiguredExtensions([object]$Config, [string]$OverrideExtensions) {
  $raw = $OverrideExtensions
  if (-not $raw -and $Config.extensions) {
    $raw = [string]$Config.extensions
  }
  if (-not $raw) {
    $raw = '101,102,103,104,105,106,107,108,109,110'
  }
  return @($raw -split '[,;\s]+' | ForEach-Object { "$_".Trim() } | Where-Object { $_ -match '^\d{2,6}$' } | Select-Object -Unique)
}

function Get-ExtId([object]$Config, [string]$Extension) {
  $suffix = if ($Config.jettelPbxSuffix) { [string]$Config.jettelPbxSuffix } else { 'pbx349' }
  return "$Extension-$suffix"
}

function Sync-ExtensionStatus([object]$Config) {
  $extensionsToSync = Get-ConfiguredExtensions -Config $Config -OverrideExtensions $Extensions
  $rows = @()
  foreach ($extension in $extensionsToSync) {
    try {
      $response = Invoke-JettelPost -Config $Config -Mode 'ExtensionStatus' -Fields @{ ext_id = (Get-ExtId -Config $Config -Extension $extension) }
      $rows += [ordered]@{
        extension = $extension
        ext_id = (Get-ExtId -Config $Config -Extension $extension)
        response = $response
      }
      Start-Sleep -Milliseconds 1200
    } catch {
      $rows += [ordered]@{
        extension = $extension
        ext_id = (Get-ExtId -Config $Config -Extension $extension)
        error = $_.Exception.Message
      }
      Start-Sleep -Milliseconds 1200
    }
  }
  return @{ rows = $rows }
}

function Sync-Once {
  $config = Read-Config
  $response = Sync-ExtensionStatus -Config $config
  Send-ToSupabase -Config $config -EventType 'extension-status' -RawResponse $response
  Write-SyncLog 'ExtensionStatus Supabase aktarimi basarili.'

  $shouldSyncActiveCalls = -not $DisableActiveCallsSync
  if ($null -ne $config.syncActiveCalls) {
    $shouldSyncActiveCalls = [bool]($config.syncActiveCalls)
  }
  if ($shouldSyncActiveCalls) {
    Start-Sleep -Milliseconds 1500
    try {
      $activeResponse = Invoke-JettelPost -Config $config -Mode 'ActiveCalls' -Fields @{}
    } catch {
      $activeResponse = @{
        rows = @(@{
          error = $_.Exception.Message
          mode = 'ActiveCalls'
        })
      }
    }
    Send-ToSupabase -Config $config -EventType 'active-calls' -RawResponse $activeResponse
    Write-SyncLog 'ActiveCalls Supabase aktarimi basarili.'
  }

  $shouldSyncCallReport = $SyncCallReport -or [bool]($config.syncCallReport)
  if ($shouldSyncCallReport) {
    Start-Sleep -Milliseconds 1500
    $lookbackDays = if ($config.callReportLookbackDays) { [int]$config.callReportLookbackDays } else { $CallReportLookbackDays }
    $startDate = (Get-Date).Date.AddDays(-[Math]::Max(0, $lookbackDays)).ToString('yyyy-MM-dd')
    $endDate = (Get-Date).Date.ToString('yyyy-MM-dd')
    $fields = @{
      first_day = $startDate
      last_day = $endDate
    }
    $reportResponse = Invoke-JettelPost -Config $config -Mode 'CallReport' -Fields $fields
    Send-ToSupabase -Config $config -EventType 'call-report' -RawResponse $reportResponse -Meta $fields
    Write-SyncLog "CallReport Supabase aktarimi basarili. first_day=$startDate last_day=$endDate"
  }
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
