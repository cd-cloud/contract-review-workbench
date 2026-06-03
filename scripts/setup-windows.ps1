param(
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$SkipSmoke,
  [switch]$Launch
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $env:ELECTRON_MIRROR) {
  $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
}
if (-not $env:npm_config_electron_mirror) {
  $env:npm_config_electron_mirror = $env:ELECTRON_MIRROR
}
$unpackedDir = Join-Path $root "dist\win-unpacked"

function Step($message) {
  Write-Host ""
  Write-Host "==> $message" -ForegroundColor Cyan
}

function Fail($message) {
  Write-Host ""
  Write-Host "[ERROR] $message" -ForegroundColor Red
  exit 1
}

function Find-UnpackedExe {
  if (-not (Test-Path $unpackedDir)) { return $null }
  $exe = Get-ChildItem -Path $unpackedDir -Filter "*.exe" -File | Select-Object -First 1
  if ($exe) { return $exe.FullName }
  return $null
}

Set-Location $root

Step "Checking Node.js"
try {
  $nodeVersion = (& node --version)
  Write-Host "Node: $nodeVersion"
} catch {
  Fail "Node.js is not available. Install Node.js 20 LTS or another supported Node version first."
}

Step "Using Electron mirror"
Write-Host "ELECTRON_MIRROR=$env:ELECTRON_MIRROR"

if (-not $SkipInstall) {
  Step "Installing dependencies"
  & npm.cmd install
  if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }
}

Step "Checking Electron binary"
$electronExe = Join-Path $root "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electronExe)) {
  Step "Repairing Electron binary"
  & node "node_modules\electron\install.js"
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $electronExe)) {
    Fail "Electron binary is missing. Try rerunning this script with network access."
  }
}
Write-Host "Electron: $electronExe"

if (-not $SkipSmoke) {
  Step "Running desktop smoke test"
  & npm.cmd run electron:smoke
  if ($LASTEXITCODE -ne 0) { Fail "Electron smoke test failed." }
}

$appExe = Find-UnpackedExe
if (-not $SkipBuild -and -not $appExe) {
  Step "Building win-unpacked desktop app"
  & npm.cmd run build:win
  if ($LASTEXITCODE -ne 0) { Fail "Windows build failed." }
  $appExe = Find-UnpackedExe
}

if (-not $appExe -or -not (Test-Path $appExe)) {
  Fail "win-unpacked app was not found under: $unpackedDir"
}

Write-Host ""
Write-Host "Ready for daily use:" -ForegroundColor Green
Write-Host $appExe

if ($Launch) {
  Step "Launching win-unpacked app"
  Start-Process -FilePath $appExe -WorkingDirectory (Split-Path $appExe)
}
