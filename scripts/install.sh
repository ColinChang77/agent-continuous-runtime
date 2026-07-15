#!/usr/bin/env bash
#
# Agent Continuity Runtime (ACR) installer for macOS / Linux.
#
# One-line usage:
#   curl -fsSL https://raw.githubusercontent.com/ColinChang77/agent-continuous-runtime/main/scripts/install.sh | bash
#
# Optional environment overrides:
#   ACR_INSTALL_DIR   Target install directory (default: $HOME/.agent-continuity-runtime)
#   ACR_BRANCH        Git branch to install     (default: main)
#   ACR_NO_LINK       If set to 1, skip `npm link` global command registration
#
set -euo pipefail

REPO_URL="https://github.com/ColinChang77/agent-continuous-runtime.git"
INSTALL_DIR="${ACR_INSTALL_DIR:-$HOME/.agent-continuity-runtime}"
BRANCH="${ACR_BRANCH:-main}"
MIN_NODE_MAJOR=22

# --- pretty output ---------------------------------------------------------
if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"; RED="$(printf '\033[31m')"
  GREEN="$(printf '\033[32m')"; YELLOW="$(printf '\033[33m')"
  BLUE="$(printf '\033[34m')"; RESET="$(printf '\033[0m')"
else
  BOLD=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

info()  { printf '%s==>%s %s\n' "$BLUE" "$RESET" "$1"; }
ok()    { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn()  { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
die()   { printf '%s✗ %s%s\n' "$RED" "$1" "$RESET" >&2; exit 1; }

# --- preflight checks ------------------------------------------------------
info "Checking prerequisites"

command -v git >/dev/null 2>&1 || die "git is required but was not found. Install git and re-run."
command -v node >/dev/null 2>&1 || die "Node.js ${MIN_NODE_MAJOR}+ is required but was not found. Install it from https://nodejs.org and re-run."
command -v npm >/dev/null 2>&1 || die "npm is required but was not found. It ships with Node.js."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  die "Node.js ${MIN_NODE_MAJOR}+ is required, but found $(node -v). Please upgrade."
fi
ok "git, Node.js $(node -v), npm $(npm -v)"
# node-pty (the PTY backend) tracks Node LTS; very new Node majors may lack a
# working build. ACR still runs interactively via attached mode there, but
# automatic usage-limit failover works best on an LTS release.
if [ "$NODE_MAJOR" -gt 24 ]; then
  warn "Node $(node -v) is newer than the tested LTS line. Interactive use works via attached mode; for full automatic failover, Node 22 LTS is recommended."
fi

# --- fetch source ----------------------------------------------------------
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating existing install at $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
else
  info "Cloning into $INSTALL_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi
ok "Source ready"

# --- build -----------------------------------------------------------------
info "Installing dependencies (this can take a minute)"
( cd "$INSTALL_DIR" && npm install --no-fund --no-audit )
ok "Dependencies installed"

info "Building"
( cd "$INSTALL_DIR" && npm run build )
ok "Build complete"

# --- expose global command -------------------------------------------------
LINKED=0
if [ "${ACR_NO_LINK:-0}" != "1" ]; then
  info "Registering global 'acr' command"
  if ( cd "$INSTALL_DIR" && npm link >/dev/null 2>&1 ); then
    LINKED=1
    ok "Global command 'acr' registered"
  else
    warn "Could not register a global command automatically (npm link failed, often a permissions issue)."
  fi
fi

# --- first-run setup wizard ------------------------------------------------
# Ask, once, what the fallback should be (a second account or the other tool)
# and save it so everyday use is a bare `acr start .`. Reads from /dev/tty so it
# still works when this script is piped through `curl ... | bash`.
if [ "${ACR_NO_SETUP:-0}" != "1" ] && [ -e /dev/tty ]; then
  info "Quick setup (skip anytime with Ctrl-C, re-run later with 'acr setup')"
  node "$INSTALL_DIR/dist/acr.js" setup < /dev/tty ||
    warn "Setup skipped. Run 'acr setup' later to configure your fallback."
fi

# --- done ------------------------------------------------------------------
printf '\n%sAgent Continuity Runtime installed.%s\n\n' "$BOLD" "$RESET"
if [ "$LINKED" = "1" ] && command -v acr >/dev/null 2>&1; then
  echo "Verify with:"
  echo "  ${BOLD}acr --help${RESET}"
else
  echo "Run it directly with:"
  echo "  ${BOLD}node \"$INSTALL_DIR/dist/acr.js\" --help${RESET}"
  echo
  echo "To enable the short 'acr' command, run:"
  echo "  ${BOLD}cd \"$INSTALL_DIR\" && npm link${RESET}"
fi
echo
echo "Get started (from your project directory):"
echo "  ${BOLD}acr setup${RESET}      # choose your agent + fallback (if you skipped it)"
echo "  ${BOLD}acr start .${RESET}    # run your agent with automatic handoff"
