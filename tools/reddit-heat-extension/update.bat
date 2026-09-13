@echo off
REM Pull the latest extension code, then click "Reload code" in the popup.
cd /d "%~dp0"
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b
git pull --ff-only origin %BRANCH%
echo.
echo Updated. Now click "Reload code" in the extension popup (data is kept).
pause
