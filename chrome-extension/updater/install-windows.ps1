# HAF Watcher - one-time setup of automatic updates on Windows.
#
#   Right-click Start -> Windows PowerShell, then run:
#   powershell -ExecutionPolicy Bypass -File "C:\HAF Watcher\updater\install-windows.ps1"
#
# Creates a scheduled task that runs update-windows.ps1 every 5 minutes, as you,
# whether or not the dashboard is open. Run it again any time to repair it.

$ErrorActionPreference = 'Stop'
$ext = Split-Path -Parent $PSScriptRoot                    # the extension folder, e.g. C:\HAF Watcher
$home_ = Join-Path $env:LOCALAPPDATA 'HAF Watcher'
New-Item -ItemType Directory -Force -Path $home_ | Out-Null
# The task runs a COPY of the updater, so an update can safely replace the original.
$script = Join-Path $home_ 'update-windows.ps1'
Copy-Item -Force (Join-Path $PSScriptRoot 'update-windows.ps1') $script

$action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -Dest `"$ext`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName 'HAF Watcher Update' -Action $action -Trigger $trigger -Settings $settings -Description 'Pulls the newest HAF Watcher from GitHub every 5 minutes' -Force | Out-Null

Write-Output "Installed: 'HAF Watcher Update' runs every 5 minutes for the folder $ext"
Write-Output "Log: $home_\update.log"
Write-Output "Running it once now..."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Dest $ext
