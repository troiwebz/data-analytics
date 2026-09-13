@echo off
REM ============================================================
REM  Reddit Lead Threads - one-click updater (Windows, no Git needed)
REM  Downloads the latest extension files from GitHub into THIS folder.
REM  The extension notices the new version and reloads itself within a minute.
REM  Your saved threads, batches and settings are kept (they live in Chrome).
REM ============================================================
setlocal
set "HERE=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$zip=Join-Path $env:TEMP 'rlt-update.zip'; $tmp=Join-Path $env:TEMP 'rlt-update';" ^
  "Write-Host 'Downloading latest version...';" ^
  "Invoke-WebRequest -UseBasicParsing 'https://github.com/troiwebz/data-analytics/archive/refs/heads/claude/brave-fermat-6ysqd0.zip' -OutFile $zip;" ^
  "if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force };" ^
  "Expand-Archive $zip $tmp -Force;" ^
  "$src=Get-ChildItem $tmp -Recurse -Directory -Filter 'reddit-heat-extension' | Select-Object -First 1;" ^
  "if (-not $src) { throw 'extension folder not found in download' };" ^
  "Copy-Item (Join-Path $src.FullName '*') '%HERE%' -Recurse -Force;" ^
  "Remove-Item $zip -Force; Remove-Item $tmp -Recurse -Force;" ^
  "$v=(Get-Content (Join-Path '%HERE%' 'manifest.json') | ConvertFrom-Json).version;" ^
  "Write-Host ('Updated to v' + $v + '. The extension reloads itself within a minute (or click Reload code).')"
if errorlevel 1 (echo. & echo Update failed. Check your internet connection and try again.)
pause
