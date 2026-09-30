# Put your Anthropic key, Telegram bot token and chat id into HAF Watcher on Windows.
#   powershell -ExecutionPolicy Bypass -File "C:\HAF Watcher\updater\set-keys.ps1"
# Leave any one empty to keep what is there. HAF Watcher loads them within a minute.
param([string]$Dest = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
function Plain($s) { if (-not $s -or $s.Length -eq 0) { return '' }; $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) } }
$ak = Plain (Read-Host 'Anthropic API key (sk-ant-..., Enter to keep)' -AsSecureString)
$tt = Plain (Read-Host 'Telegram bot token (123456:ABC..., Enter to keep)' -AsSecureString)
$ci = Read-Host 'Telegram chat id (digits, Enter to keep)'
if ($ak -and -not $ak.StartsWith('sk-ant-')) { Write-Output 'That Anthropic key does not start with sk-ant- - nothing written.'; exit 1 }
if ($tt -and $tt -notmatch '^\d+:[\w-]{20,}$') { Write-Output 'That bot token does not look like 123456:ABC... - nothing written.'; exit 1 }
if ($ci -and $ci -notmatch '^-?\d{4,}$') { Write-Output 'The chat id should be digits only - nothing written.'; exit 1 }
if (-not ($ak -or $tt -or $ci)) { Write-Output 'Nothing entered - nothing changed.'; exit 0 }
$out = Join-Path $Dest 'haf-keys.json'
$d = @{}
if (Test-Path $out) { try { (Get-Content $out -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $d[$_.Name] = $_.Value } } catch {} }
if ($ak) { $d['anthropicKey'] = $ak }; if ($tt) { $d['telegramToken'] = $tt }; if ($ci) { $d['telegramChatId'] = $ci }
$d['writtenAt'] = (Get-Date -Format s)
$d | ConvertTo-Json | Set-Content -Path $out -Encoding UTF8
icacls $out /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
Write-Output "Written: $out"
Write-Output "HAF Watcher loads them within a minute - watch for 'Loaded from Terminal' on Telegram."
