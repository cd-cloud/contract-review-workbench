@echo off
setlocal
cd /d "%~dp0"

echo.
echo == Contract Review Workbench portable start ==
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 22 LTS first.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm.cmd was not found. Reinstall Node.js 22 LTS.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  npm.cmd install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo Running preflight...
npm.cmd run preflight
if errorlevel 1 (
  echo.
  echo [WARN] Preflight reported issues. Review the messages above.
  echo The server will still try to start if the required dependencies are present.
)

echo.
echo Starting local server...
npm.cmd run server:ai

pause
