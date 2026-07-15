#!/usr/bin/env bash
#
# Agent Continuity Runtime (ACR) uninstaller for macOS / Linux.
#
# Removes what install.sh created: the global `acr` command and the install
# directory. Your saved config in ~/.acr (which may contain API keys) is kept
# by default; you are asked before it is removed.
#
# IMPORTANT: This never touches any project's .agent/ directory. Those are your
# per-project continuity records, not install artifacts.
#
# One-line usage:
#   curl -fsSL https://raw.githubusercontent.com/ColinChang77/agent-continuous-runtime/main/scripts/uninstall.sh | bash
#
# Flags:
#   --purge          Also delete ~/.acr (config + saved accounts) without asking
#   --keep-config    Keep ~/.acr without asking
#   -y, --yes        Assume "no" to the config prompt (keep ~/.acr); non-interactive
#
# Optional environment overrides:
#   ACR_INSTALL_DIR   Install directory to remove (default: $HOME/.agent-continuity-runtime)
#   ACR_CONFIG_DIR    Config directory           (default: $HOME/.acr)
#
set -euo pipefail

INSTALL_DIR="${ACR_INSTALL_DIR:-$HOME/.agent-continuity-runtime}"
CONFIG_DIR="${ACR_CONFIG_DIR:-$HOME/.acr}"
PKG_NAME="agent-continuity-runtime"

PURGE_CONFIG="ask"   # ask | yes | no
ASSUME_YES=0

for arg in "$@"; do
  case "$arg" in
    --purge)        PURGE_CONFIG="yes" ;;
    --keep-config)  PURGE_CONFIG="no" ;;
    -y|--yes)       ASSUME_YES=1; [ "$PURGE_CONFIG" = "ask" ] && PURGE_CONFIG="no" ;;
    -h|--help)
      grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

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

# --- unregister global command ---------------------------------------------
info "Removing global 'acr' command"
UNLINKED=0
# Preferred path: undo `npm link` from the install dir so npm cleans its own state.
if [ -d "$INSTALL_DIR" ] && ( cd "$INSTALL_DIR" && npm unlink >/dev/null 2>&1 ); then
  UNLINKED=1
fi
# Fallback: remove the global package directly (works even if the dir is gone).
if [ "$UNLINKED" != "1" ] && npm rm -g "$PKG_NAME" >/dev/null 2>&1; then
  UNLINKED=1
fi
if [ "$UNLINKED" = "1" ]; then
  ok "Global command removed"
else
  if command -v acr >/dev/null 2>&1; then
    warn "Could not unregister 'acr' automatically. Remove it manually with: npm rm -g $PKG_NAME"
  else
    ok "No global command was registered"
  fi
fi

# --- remove install directory ----------------------------------------------
if [ -d "$INSTALL_DIR" ]; then
  info "Removing install directory $INSTALL_DIR"
  rm -rf "$INSTALL_DIR"
  ok "Install directory removed"
else
  ok "No install directory at $INSTALL_DIR"
fi

# --- config directory (may contain API keys) -------------------------------
if [ -d "$CONFIG_DIR" ]; then
  if [ "$PURGE_CONFIG" = "ask" ] && [ "$ASSUME_YES" != "1" ] && [ -e /dev/tty ]; then
    printf '%s?%s Also delete saved config and accounts at %s? [y/N] ' "$YELLOW" "$RESET" "$CONFIG_DIR"
    read -r reply < /dev/tty || reply=""
    case "$reply" in [yY]|[yY][eE][sS]) PURGE_CONFIG="yes" ;; *) PURGE_CONFIG="no" ;; esac
  fi
  if [ "$PURGE_CONFIG" = "yes" ]; then
    info "Removing config directory $CONFIG_DIR"
    rm -rf "$CONFIG_DIR"
    ok "Config directory removed"
  else
    warn "Kept $CONFIG_DIR (may contain API keys). Delete it manually with: rm -rf \"$CONFIG_DIR\""
  fi
fi

# --- done ------------------------------------------------------------------
printf '\n%sAgent Continuity Runtime uninstalled.%s\n' "$BOLD" "$RESET"
echo "Your projects' .agent/ continuity directories were left untouched."
