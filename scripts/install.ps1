#Requires -Version 5.1
<#
.SYNOPSIS
  Agent Continuity Runtime (ACR) installer for Windows.

.DESCRIPTION
  One-line usage (PowerShell):
    irm https://raw.githubusercontent.com/ColinChang77/agent-continuous-runtime/main/scripts/install.ps1 | iex

  Optional environment overrides:
    ACR_INSTALL_DIR   Target install directory (default: $HOME\.agent-continuity-runtime)
    ACR_BRANCH        Git branch to install     (default: main)
    ACR_NO_LINK       Set to 1 to skip `npm link` global command registration
#>

$ErrorActionPreference = 'Stop'

$RepoUrl     = 'https://github.com/ColinChang77/agent-continuous-runtime.git'
$InstallDir  = if ($env:ACR_INSTALL_DIR) { $env:ACR_INSTALL_DIR } else { Join-Path $HOME '.agent-continuity-runtime' }
$Branch      = if ($env:ACR_BRANCH) { $env:ACR_BRANCH } else { 'main' }
$MinNodeMajor = 22

function Write-Info($msg) { Write-Host "==> $msg" -ForegroundColor Blue }
function Write-Ok($msg)   { Write-Host "OK  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "!   $msg" -ForegroundColor Yellow }
function Die($msg)        { Write-Host "X   $msg" -ForegroundColor Red; exit 1 }

# --- preflight checks ------------------------------------------------------
Write-Info 'Checking prerequisites'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Die 'git is required but was not found. Install it from https://git-scm.com and re-run.'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die "Node.js $MinNodeMajor+ is required but was not found. Install it from https://nodejs.org and re-run."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Die 'npm is required but was not found. It ships with Node.js.'
}

$NodeMajor = [int](node -p 'process.versions.node.split(".")[0]')
if ($NodeMajor -lt $MinNodeMajor) {
  Die "Node.js $MinNodeMajor+ is required, but found $(node -v). Please upgrade."
}
Write-Ok "git, Node.js $(node -v), npm $(npm -v)"

# --- fetch source ----------------------------------------------------------
if (Test-Path (Join-Path $InstallDir '.git')) {
  Write-Info "Updating existing install at $InstallDir"
  git -C $InstallDir fetch --depth 1 origin $Branch
  git -C $InstallDir checkout $Branch
  git -C $InstallDir reset --hard "origin/$Branch"
} else {
  Write-Info "Cloning into $InstallDir"
  git clone --depth 1 --branch $Branch $RepoUrl $InstallDir
}
Write-Ok 'Source ready'

# --- build -----------------------------------------------------------------
Push-Location $InstallDir
try {
  Write-Info 'Installing dependencies (this can take a minute)'
  npm install --no-fund --no-audit
  Write-Ok 'Dependencies installed'

  Write-Info 'Building'
  npm run build
  Write-Ok 'Build complete'

  # --- expose global command ----------------------------------------------
  $Linked = $false
  if ($env:ACR_NO_LINK -ne '1') {
    Write-Info "Registering global 'acr' command"
    npm link *> $null
    if ($LASTEXITCODE -eq 0) {
      $Linked = $true
      Write-Ok "Global command 'acr' registered"
    } else {
      Write-Warn 'Could not register a global command automatically (npm link failed).'
    }
  }
} finally {
  Pop-Location
}

# --- first-run setup wizard ------------------------------------------------
# Ask, once, what the fallback should be (a second account or the other tool)
# and save it so everyday use is a bare `acr start .`.
if ($env:ACR_NO_SETUP -ne '1') {
  Write-Info "Quick setup (skip anytime with Ctrl-C, re-run later with 'acr setup')"
  try {
    node (Join-Path $InstallDir 'dist\acr.js') setup
  } catch {
    Write-Warn "Setup skipped. Run 'acr setup' later to configure your fallback."
  }
}

# --- done ------------------------------------------------------------------
Write-Host ''
Write-Host 'Agent Continuity Runtime installed.' -ForegroundColor White
Write-Host ''
if ($Linked -and (Get-Command acr -ErrorAction SilentlyContinue)) {
  Write-Host 'Verify with:'
  Write-Host '  acr --help'
} else {
  Write-Host 'Run it directly with:'
  Write-Host "  node `"$InstallDir\dist\acr.js`" --help"
  Write-Host ''
  Write-Host "To enable the short 'acr' command, run:"
  Write-Host "  cd `"$InstallDir`"; npm link"
}
Write-Host ''
Write-Host 'Get started (from your project directory):'
Write-Host '  acr setup      # choose your agent + fallback (if you skipped it)'
Write-Host '  acr start .    # run your agent with automatic handoff'
