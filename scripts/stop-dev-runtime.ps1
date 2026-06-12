$ErrorActionPreference = "SilentlyContinue"

$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$electronExe = [System.IO.Path]::GetFullPath((Join-Path $root "node_modules\electron\dist\electron.exe"))
$serverScript = [System.IO.Path]::GetFullPath((Join-Path $root "server\server.js"))

function Stop-ById($processId, $reason) {
  if (-not $processId) { return }
  Write-Host "Stopping stale workbench process $processId ($reason)"
  Stop-Process -Id $processId -Force
}

Get-Process | ForEach-Object {
  $path = $null
  try { $path = $_.Path } catch { $path = $null }
  if (-not $path) { return }

  $fullPath = [System.IO.Path]::GetFullPath($path)
  if ($fullPath -eq $electronExe) {
    Stop-ById $_.Id "Electron dev shell"
  }
}

try {
  Get-CimInstance Win32_Process | ForEach-Object {
    $commandLine = [string]$_.CommandLine
    if (-not $commandLine) { return }
    if ($commandLine.Contains($serverScript) -or ($commandLine.Contains($root) -and $commandLine.Contains("server\server.js"))) {
      Stop-ById $_.ProcessId "local backend"
    }
  }
} catch {
  Write-Host "Skipping command-line process cleanup: $($_.Exception.Message)"
}
