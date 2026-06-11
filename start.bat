@echo off
cd /d "%~dp0."
chcp 65001 >nul
title AI 合同审阅工作台
echo 正在启动 AI 合同审阅工作台...
echo.

REM Check if Node.js is available
node --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js。
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

REM Check if dependencies are installed
if not exist "node_modules\electron\package.json" (
    echo 正在安装依赖...
    call npm install
    if errorlevel 1 (
        echo [错误] 依赖安装失败。
        pause
        exit /b 1
    )
)

REM Start Electron
echo 正在启动桌面应用...
call npm run electron

if errorlevel 1 (
    echo.
    echo [错误] 启动失败，请查看上方错误信息。
    pause
)
