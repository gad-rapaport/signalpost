#Requires -Version 7.2
<#
.SYNOPSIS
  Signalpost local operations. Run from any directory.

.EXAMPLE
  ./scripts/ops.ps1 setup            # create .env with random secrets, build, start, seed
  ./scripts/ops.ps1 start            # start the stack (http://127.0.0.1:8105)
  ./scripts/ops.ps1 stop             # stop and remove containers; the data volume is kept
  ./scripts/ops.ps1 status           # containers, health and live resource usage
  ./scripts/ops.ps1 logs app         # last 200 log lines of one service
  ./scripts/ops.ps1 seed             # idempotent demo data
  ./scripts/ops.ps1 backup           # online SQLite backup into ./backups
  ./scripts/ops.ps1 restore backups/signalpost-20261004-120000.db -Yes
  ./scripts/ops.ps1 reset-demo -Yes
  ./scripts/ops.ps1 drill outage     # failure drill: stop the demo target (incidents open within about a minute)
  ./scripts/ops.ps1 drill slow|error|normal   # switch the demo target's behaviour
  ./scripts/ops.ps1 drill recover    # start the demo target again and set it back to normal
  ./scripts/ops.ps1 test             # format, lint, types, unit and integration tests
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0, Mandatory)]
  [ValidateSet('setup', 'start', 'stop', 'status', 'logs', 'seed', 'backup', 'restore', 'reset-demo', 'drill', 'test', 'e2e')]
  [string]$Command,
  [Parameter(Position = 1)]
  [string]$Target,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root
$Url = 'http://127.0.0.1:8105'

function Invoke-Checked {
  param([string]$File, [string[]]$Arguments)
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$File $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
}

function New-Secret([int]$Length = 32) {
  $alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  -join (1..$Length | ForEach-Object { $alphabet[[System.Security.Cryptography.RandomNumberGenerator]::GetInt32($alphabet.Length)] })
}

function Initialize-DotEnv {
  $envPath = Join-Path $Root '.env'
  if (Test-Path -LiteralPath $envPath) { Write-Host '.env already exists; keeping it.'; return }
  $content = Get-Content -LiteralPath (Join-Path $Root '.env.example') -Raw
  $content = [regex]::Replace($content, 'replace-with-random-value', { New-Secret })
  Set-Content -LiteralPath $envPath -Value $content -Encoding utf8NoBOM
  Write-Host 'Created .env with random secrets. The admin password is SEED_ADMIN_PASSWORD in .env.'
}

function Wait-Ready([int]$TimeoutSeconds = 90) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri "$Url/readyz" -TimeoutSec 3 -SkipHttpErrorCheck
      if ($r.StatusCode -eq 200) { return }
    } catch { }
    Start-Sleep -Seconds 2
  }
  throw "Signalpost did not become ready within $TimeoutSeconds s. Check: ./scripts/ops.ps1 logs app"
}

function Get-BackupDir {
  $dir = Join-Path $Root 'backups'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $dir
}

switch ($Command) {
  'setup' {
    Initialize-DotEnv
    Get-BackupDir | Out-Null
    Invoke-Checked docker @('compose', 'build')
    Invoke-Checked docker @('compose', 'up', '-d', '--wait')
    Invoke-Checked docker @('compose', '--profile', 'tools', 'run', '--rm', 'seed')
    Write-Host "Signalpost is running at $Url (admin: $Url/admin)"
  }
  'start' {
    Get-BackupDir | Out-Null
    Invoke-Checked docker @('compose', 'up', '-d', '--wait')
    Wait-Ready
    Write-Host "Signalpost is running at $Url"
  }
  'stop' {
    Invoke-Checked docker @('compose', 'down')
    Write-Host 'Stopped. Data volume signalpost_data was kept.'
  }
  'status' {
    Invoke-Checked docker @('compose', 'ps', '--format', 'table {{.Service}}\t{{.State}}\t{{.Health}}\t{{.Ports}}')
    $ids = docker compose ps -q
    if ($ids) { Invoke-Checked docker (@('stats', '--no-stream', '--format', 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.PIDs}}') + $ids) }
  }
  'logs' {
    $services = if ($Target) { @($Target) } else { @() }
    Invoke-Checked docker (@('compose', 'logs', '--tail', '200', '--timestamps') + $services)
  }
  'seed' {
    Invoke-Checked docker @('compose', '--profile', 'tools', 'run', '--rm', 'seed')
  }
  'backup' {
    Get-BackupDir | Out-Null
    # Runs inside the live container: SQLite's online backup is consistent while checks keep writing.
    Invoke-Checked docker @('compose', 'exec', '-T', 'app', '/nodejs/bin/node', 'dist/cli.js', 'backup')
  }
  'restore' {
    if (-not $Target) { throw 'Usage: ops.ps1 restore <backups/file.db> -Yes' }
    $file = Get-Item -LiteralPath $Target
    $backupDir = (Resolve-Path -LiteralPath (Get-BackupDir)).Path
    if ($file.DirectoryName -ne $backupDir) { throw "Restore only reads files from $backupDir" }
    if (-not $Yes) { Write-Warning "Restore REPLACES all Signalpost data with $($file.Name) (the current file is kept as .before-restore). Re-run with -Yes."; exit 2 }
    Invoke-Checked docker @('compose', 'stop', 'app')
    Invoke-Checked docker @('compose', '--profile', 'tools', 'run', '--rm', 'seed', 'dist/cli.js', 'restore', "/backups/$($file.Name)", '--yes')
    Invoke-Checked docker @('compose', 'start', 'app')
    Wait-Ready
    Write-Host "Restored $($file.Name)."
  }
  'reset-demo' {
    if (-not $Yes) { Write-Warning 'reset-demo DELETES all monitors, checks, incidents and the audit log, then seeds again. Re-run with -Yes.'; exit 2 }
    Invoke-Checked docker @('compose', 'stop', 'app')
    Invoke-Checked docker @('compose', '--profile', 'tools', 'run', '--rm', 'seed', 'dist/cli.js', 'reset-demo', '--yes')
    Invoke-Checked docker @('compose', 'start', 'app')
    Wait-Ready
  }
  'drill' {
    switch ($Target) {
      'outage' {
        Invoke-Checked docker @('compose', 'stop', 'demo-api')
        Write-Host 'Demo target stopped. Monitors fail from the next check; incidents open after 2 failures (about a minute).'
      }
      'recover' {
        Invoke-Checked docker @('compose', 'start', 'demo-api')
        Start-Sleep -Seconds 3
        Invoke-Checked docker @('compose', 'exec', '-T', 'demo-api', '/nodejs/bin/node', 'dist/cli.js', 'demo-mode', 'normal')
        Write-Host 'Demo target back to normal; incidents resolve after 2 good checks.'
      }
      { $_ -in 'slow', 'error', 'normal' } {
        Invoke-Checked docker @('compose', 'exec', '-T', 'demo-api', '/nodejs/bin/node', 'dist/cli.js', 'demo-mode', $Target)
      }
      default { throw 'Usage: ops.ps1 drill outage|recover|slow|error|normal' }
    }
  }
  'test' {
    Invoke-Checked npm @('run', 'format:check')
    Invoke-Checked npm @('run', 'lint')
    Invoke-Checked npm @('run', 'typecheck')
    Invoke-Checked npm @('test')
    Write-Host 'All checks passed. End-to-end: ./scripts/ops.ps1 e2e (needs the running stack).'
  }
  'e2e' {
    Wait-Ready 10
    Invoke-Checked npx @('playwright', 'test', '--project=desktop', '--project=mobile')
  }
}
