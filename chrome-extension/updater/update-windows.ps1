# HAF Watcher - Windows updater.
#
# Checks GitHub every run; when a newer version is published, downloads only the
# extension files into this folder. manifest.json is written LAST, so Chrome's
# own "new version on disk" check reloads the extension once everything is in
# place. haf-secrets.json and anything else not in the repo is never touched.
#
# Run by the scheduled task that install-windows.ps1 creates (every 5 minutes).
# Safe to run by hand:  powershell -ExecutionPolicy Bypass -File update-windows.ps1

param(
  [string]$Dest   = (Split-Path -Parent $PSScriptRoot),
  [string]$Owner  = 'troiwebz',
  [string]$Repo   = 'data-analytics',
  [string]$Branch = 'claude/wizardly-brahmagupta-178bgm',
  [string]$Sub    = 'chrome-extension'
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$logDir = Join-Path $env:LOCALAPPDATA 'HAF Watcher'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'update.log'
function Say($m) { $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m"; Add-Content -Path $log -Value $line; Write-Output $line }

try {
  $raw = "https://raw.githubusercontent.com/$Owner/$Repo/$Branch/$Sub"
  $remote = (Invoke-RestMethod -UseBasicParsing -Uri "$raw/manifest.json" -Headers @{ 'Cache-Control' = 'no-cache' }).version
  $localFile = Join-Path $Dest 'manifest.json'
  $local = if (Test-Path $localFile) { (Get-Content $localFile -Raw | ConvertFrom-Json).version } else { '0' }
  if ($remote -eq $local) { Say "already up to date ($local)"; exit 0 }

  Say "update found: $local -> $remote, downloading"
  $tree = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Owner/$Repo/git/trees/$([uri]::EscapeDataString($Branch))?recursive=1" -Headers @{ 'User-Agent' = 'haf-watcher-updater' }
  $files = $tree.tree | Where-Object { $_.type -eq 'blob' -and $_.path.StartsWith("$Sub/") } |
    ForEach-Object { $_.path.Substring($Sub.Length + 1) } |
    Where-Object { $_ -notmatch '^(test|docs|node_modules)/' -and $_ -notmatch '^package(-lock)?\.json$' -and $_ -ne 'haf-secrets.json' }
  if (-not $files -or -not ($files -contains 'manifest.json')) { throw 'GitHub returned no file list' }

  # Everything into a staging folder first: a half-finished download never lands.
  $stage = Join-Path $env:TEMP ("haf-update-" + [guid]::NewGuid().ToString('N'))
  foreach ($f in $files) {
    $out = Join-Path $stage ($f -replace '/', '\')
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $out) | Out-Null
    $parts = @($f -split '/' | ForEach-Object { [uri]::EscapeDataString($_) })
    $url = "$raw/" + ($parts -join '/')
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $out
  }
  # Copy over the live folder, manifest.json last.
  foreach ($f in ($files | Where-Object { $_ -ne 'manifest.json' })) {
    $src = Join-Path $stage ($f -replace '/', '\'); $dst = Join-Path $Dest ($f -replace '/', '\')
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
    Copy-Item -Force $src $dst
  }
  Copy-Item -Force (Join-Path $stage 'manifest.json') $localFile
  # The scheduled task runs a copy of this script; keep that copy current too.
  $runner = Join-Path $logDir 'update-windows.ps1'
  $fresh = Join-Path $Dest 'updater\update-windows.ps1'
  if ((Test-Path $fresh) -and ($PSCommandPath -ne $fresh)) { Copy-Item -Force $fresh $runner }
  Remove-Item -Recurse -Force $stage
  Say "updated to $remote ($($files.Count) files). Chrome reloads the extension within a minute."
} catch {
  Say "update failed: $($_.Exception.Message)"
  exit 1
}
