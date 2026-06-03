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

function Stop-StaleAppProcesses($expectedExe) {
  $expectedPath = [System.IO.Path]::GetFullPath($expectedExe)
  $expectedName = [System.IO.Path]::GetFileName($expectedPath)

  Get-Process | ForEach-Object {
    $path = $null
    try {
      $path = $_.Path
    } catch {
      $path = $null
    }

    if ($path) {
      $processPath = [System.IO.Path]::GetFullPath($path)
      $processName = [System.IO.Path]::GetFileName($processPath)
      if ($processName -eq $expectedName -and $processPath -ne $expectedPath) {
        Step "Stopping stale desktop app process: $processPath"
        Stop-Process -Id $_.Id -Force
      }
    }
  }
}

Set-Location $root

Step "Checking Node.js"
try {
  $nodeVersion = (& node --version)
  Write-Host "Node: $nodeVersion"
  $nodeMajor = [int]($nodeVersion -replace "^v(\d+)\..*$", '$1')
  if ($nodeMajor -lt 20) {
    Fail "Node.js $nodeVersion is too old. Install Node.js 20 or 22, then rerun this script."
  }
  if ($nodeMajor -gt 22) {
    Write-Host "[WARN] Node.js $nodeVersion is newer than the tested range. Run npm run electron:smoke after install/build." -ForegroundColor Yellow
  }
} catch {
  Fail "Node.js is not available. Install Node.js 20 or 22 first."
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

$appExe = Find-UnpackedExe
$smokeRan = $false
if (-not $SkipSmoke) {
  if ($SkipBuild -and $appExe) {
    Step "Skipping desktop smoke test"
    Write-Host "SkipBuild is set and win-unpacked already exists. Skipping electron:smoke so packaged native modules keep the Electron ABI." -ForegroundColor Yellow
  } else {
    Step "Running desktop smoke test"
    & npm.cmd run electron:smoke
    if ($LASTEXITCODE -ne 0) { Fail "Electron smoke test failed." }
    $smokeRan = $true
  }
}

if (-not $SkipBuild -and (-not $appExe -or $smokeRan)) {
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
  Stop-StaleAppProcesses $appExe
  Step "Launching win-unpacked app"
  Start-Process -FilePath $appExe -WorkingDirectory (Split-Path $appExe)
}
