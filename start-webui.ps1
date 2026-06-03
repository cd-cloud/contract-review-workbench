$ErrorActionPreference = "SilentlyContinue"

$workspace = Split-Path -Parent $MyInvocation.MyCommand.Definition
$url = "http://127.0.0.1:8787/"
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

function Test-PortOpen {
  param([string]$HostName, [int]$Port)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(500, $false)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

if (-not (Test-PortOpen -HostName "127.0.0.1" -Port 8787)) {
  Start-Process -FilePath "npm.cmd" -ArgumentList "run server:ai" -WorkingDirectory $workspace -WindowStyle Hidden
  for ($i = 0; $i -lt 30; $i += 1) {
    Start-Sleep -Milliseconds 500
    if (Test-PortOpen -HostName "127.0.0.1" -Port 8787) { break }
  }
}

if (Test-Path $edge) {
  Start-Process -FilePath $edge -ArgumentList "--new-window `"$url`""
} else {
  Start-Process $url
}
