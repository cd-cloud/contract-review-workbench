$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
& (Join-Path $root "scripts\setup-windows.ps1") -Launch
