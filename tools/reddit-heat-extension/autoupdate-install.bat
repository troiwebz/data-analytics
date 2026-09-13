@echo off
REM Turn on automatic updates (Windows). Runs update.bat every hour in the
REM background; the extension then reloads itself within a minute.
setlocal
set "HERE=%~dp0"
schtasks /Create /F /TN "RedditLeadThreadsUpdate" /TR "\"%HERE%update.bat\" /quiet" /SC HOURLY /RL LIMITED
if errorlevel 1 (echo Could not create the task. Try running this file as Administrator.) else (echo Automatic updates ON, hourly. Turn off with autoupdate-uninstall.bat)
pause
