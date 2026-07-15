#Requires -Version 5.1
<#
.SYNOPSIS
  Agent Continuity Runtime (ACR) uninstaller for Windows.

.DESCRIPTION
  Removes what install.ps1 created: the global `acr` command and the install
  directory. Your saved config in ~\.acr (which may contain API keys) is kept
  by default; you are asked before it is removed.

  IMPORTANT: This never touches any project's .agent\ directory. Those are your
  per-project continuity records, not install artifacts.

  One-line usage (PowerShell):
    irm https://raw.githubusercontent.com/ColinChang77/agent-continuous-runtime/main/scripts/uninstall.ps1 | iex

.PARAMETER Purge
  Also delete ~\.acr (config + saved accounts) without asking.

.PARAMETER KeepConfig
  Keep ~\.acr without asking.

.NOTES
  Optional environment overrides:
    ACR_INSTALL_DIR   Install directory to remove (default: $HOME\.agent-continuity-runtime)
    ACR_CONFIG_DIR    Config directory           (default: $HOME\.acr)
#>
param(
  [switch]$Purge,
  [switch]$KeepConfig
)

$ErrorActionPreference = 'Stop'

$InstallDir = if ($env:ACR_INSTALL_DIR) { $env:ACR_INSTALL_DIR } else { Join-Path $HOME '.agent-continuity-runtime' }
$ConfigDir  = if ($env:ACR_CONFIG_DIR)  { $env:ACR_CONFIG_DIR }  else { Join-Path $HOME '.acr' }
$PkgName    = 'agent-continuity-runtime'

function Write-Info($msg) { Write-Host "==> $msg" -ForegroundColor Blue }
function Write-Ok($msg)   { Write-Host "OK  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "!   $msg" -ForegroundColor Yellow }

# --- unregister global command ---------------------------------------------
Write-Info "Removing global 'acr' command"
$Unlinked = $false
if (Test-Path $InstallDir) {
  Push-Location $InstallDir
  try {
    npm unlink *> $null
    if ($LASTEXITCODE -eq 0) { $Unlinked = $true }
  } finally {
    Pop-Location
  }
}
if (-not $Unlinked) {
  npm rm -g $PkgName *> $null
  if ($LASTEXITCODE -eq 0) { $Unlinked = $true }
}
if ($Unlinked) {
  Write-Ok 'Global command removed'
} elseif (Get-Command acr -ErrorAction SilentlyContinue) {
  Write-Warn "Could not unregister 'acr' automatically. Remove it manually with: npm rm -g $PkgName"
} else {
  Write-Ok 'No global command was registered'
}

# --- remove install directory ----------------------------------------------
if (Test-Path $InstallDir) {
  Write-Info "Removing install directory $InstallDir"
  Remove-Item -Recurse -Force $InstallDir
  Write-Ok 'Install directory removed'
} else {
  Write-Ok "No install directory at $InstallDir"
}

# --- config directory (may contain API keys) -------------------------------
if (Test-Path $ConfigDir) {
  $doPurge = $false
  if ($Purge) {
    $doPurge = $true
  } elseif ($KeepConfig) {
    $doPurge = $false
  } else {
    $reply = Read-Host "?   Also delete saved config and accounts at $ConfigDir? [y/N]"
    if ($reply -match '^(y|yes)$') { $doPurge = $true }
  }
  if ($doPurge) {
    Write-Info "Removing config directory $ConfigDir"
    Remove-Item -Recurse -Force $ConfigDir
    Write-Ok 'Config directory removed'
  } else {
    Write-Warn "Kept $ConfigDir (may contain API keys). Delete it manually with: Remove-Item -Recurse -Force `"$ConfigDir`""
  }
}

# --- done ------------------------------------------------------------------
Write-Host ''
Write-Host 'Agent Continuity Runtime uninstalled.' -ForegroundColor White
Write-Host "Your projects' .agent\ continuity directories were left untouched."
