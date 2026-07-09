param()

$ErrorActionPreference = 'Stop'

$endpoint = 'https://aeaetnpeyksfvlhiijil.supabase.co/functions/v1/call-event'
$secretPath = Join-Path $PSScriptRoot 'secret.txt'
if (Test-Path -LiteralPath $secretPath) {
  $secret = (Get-Content -LiteralPath $secretPath -Raw -Encoding UTF8).Trim()
} else {
  $secureSecret = Read-Host "CALL_BRIDGE_SECRET" -AsSecureString
  $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
  try {
    $secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  }
}

if (-not $secret) {
  throw "CALL_BRIDGE_SECRET bos olamaz."
}

$profilesPath = Join-Path $PSScriptRoot 'repler.csv'
if (-not (Test-Path -LiteralPath $profilesPath)) {
  throw "repler.csv bulunamadi. Kurulum klasorunde olmali."
}

$profiles = @(Import-Csv -LiteralPath $profilesPath -Encoding UTF8 | Where-Object { $_.Name -and $_.Name.Trim() })
if ($profiles.Count -eq 0) {
  throw "repler.csv bos gorunuyor."
}

function Write-Step([string]$Text) {
  Write-Host ""
  Write-Host "==> $Text" -ForegroundColor Cyan
}

function Find-MicroSipIni {
  $candidates = @(
    (Join-Path $env:APPDATA 'MicroSIP\MicroSIP.ini'),
    (Join-Path $env:APPDATA 'MicroSIP\microsip.ini')
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }

  $found = Get-ChildItem -Path $env:APPDATA -Recurse -Filter 'MicroSIP.ini' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { return $found.FullName }
  return $null
}

function Restart-MicroSip {
  $process = Get-Process | Where-Object { $_.ProcessName -like '*MicroSIP*' } | Select-Object -First 1
  $path = $null
  if ($process -and $process.Path) { $path = $process.Path }
  if (-not $path) {
    $defaultPath = Join-Path $env:LOCALAPPDATA 'MicroSIP\MicroSIP.exe'
    if (Test-Path -LiteralPath $defaultPath) { $path = $defaultPath }
  }

  if ($process) {
    Stop-Process -Id $process.Id -Force
    Start-Sleep -Seconds 2
  }

  if ($path) {
    Start-Process -FilePath $path
    Write-Host "MicroSIP yeniden acildi." -ForegroundColor Green
  } else {
    Write-Host "MicroSIP kapatildi ama exe yolu bulunamadi. Elle acman yeterli." -ForegroundColor Yellow
  }
}

Clear-Host
Write-Host "OSS Call Bridge Kurulum" -ForegroundColor Green
Write-Host "Bu kurulum MicroSIP arama olaylarini OSS Center'a baglar."
Write-Host ""
Write-Host "ONEMLI: Bu bilgisayar hangi temsilciye aitse onu sec."
Write-Host ""

for ($index = 0; $index -lt $profiles.Count; $index += 1) {
  $profile = $profiles[$index]
  $number = $index + 1
  $email = if ($profile.Email) { " - $($profile.Email)" } else { "" }
  $idStatus = if ($profile.ProfileId -match '^[0-9a-fA-F-]{36}$') { "" } else { " (ID soracak)" }
  Write-Host "$number) $($profile.Name)$email$idStatus"
}
Write-Host "M) Listede yok / ID'yi elle girecegim"
Write-Host ""

$choice = Read-Host "Secim"
$selected = $null
if ($choice -match '^\d+$') {
  $selectedIndex = [int]$choice - 1
  if ($selectedIndex -ge 0 -and $selectedIndex -lt $profiles.Count) {
    $selected = $profiles[$selectedIndex]
  }
}

if ($choice.ToUpperInvariant() -eq 'M') {
  $manualId = Read-Host "CRM profile ID yapistir"
  if ($manualId -notmatch '^[0-9a-fA-F-]{36}$') {
    throw "Profile ID hatali gorunuyor."
  }
  $selected = [pscustomobject]@{ Name = 'Elle girilen kullanici'; Email = ''; ProfileId = $manualId }
}

if (-not $selected) {
  throw "Gecersiz secim."
}

if ($selected.ProfileId -notmatch '^[0-9a-fA-F-]{36}$') {
  Write-Host ""
  Write-Host "$($selected.Name) icin repler.csv dosyasinda ProfileId bos." -ForegroundColor Yellow
  Write-Host "CRM/Supabase'den bu kisinin profile id bilgisini kopyalayip buraya yapistir." -ForegroundColor Yellow
  $manualId = Read-Host "CRM profile ID"
  if ($manualId -notmatch '^[0-9a-fA-F-]{36}$') {
    throw "Profile ID hatali gorunuyor."
  }
  $selected.ProfileId = $manualId
}

Write-Step "Secilen kullanici: $($selected.Name)"

$microSipIni = Find-MicroSipIni
if (-not $microSipIni) {
  throw "MicroSIP ayar dosyasi bulunamadi. Bu bilgisayarda MicroSIP kurulu/acilmis olmali."
}
Write-Host "MicroSIP ayar dosyasi: $microSipIni"

$installer = Join-Path $PSScriptRoot 'install-oss-call-bridge.ps1'
if (-not (Test-Path -LiteralPath $installer)) {
  throw "install-oss-call-bridge.ps1 bu klasorde bulunamadi."
}

Write-Step "Bridge kuruluyor"
& $installer -Endpoint $endpoint -Secret $secret -ProfileId $selected.ProfileId -MicroSipIni $microSipIni

Write-Step "Test gonderimi yapiliyor"
$bridge = Join-Path $env:LOCALAPPDATA 'OSSCallBridge\oss-call-bridge.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bridge incoming 05421261356
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bridge end 05421261356

$queue = Join-Path $env:LOCALAPPDATA 'OSSCallBridge\queue'
$queued = 0
if (Test-Path -LiteralPath $queue) {
  $queued = @(Get-ChildItem -LiteralPath $queue -Filter '*.json' -ErrorAction SilentlyContinue).Count
}

if ($queued -gt 0) {
  Write-Host "Test olayi kuyrukta kaldi. Internet veya secret/endpoint kontrol edilmeli." -ForegroundColor Yellow
} else {
  Write-Host "Test basarili. Kuyruk bos." -ForegroundColor Green
}

Write-Step "MicroSIP yeniden baslatiliyor"
Restart-MicroSip

Write-Host ""
Write-Host "KURULUM BITTI." -ForegroundColor Green
Write-Host "Bundan sonraki aramalar OSS Center'a dusmeye baslar."
