# Changelog

## Unreleased

Added

- One-line installers for macOS/Linux (`scripts/install.sh`) and Windows (`scripts/install.ps1`)
- `acr setup` first-run wizard; saved config at `~/.acr/config.json` so `acr start .` works with no flags
- Multiple-account support via `claude-code-alt` / `codex-alt` adapters (saved config or `ACR_*_ALT_*` env)
- Beginner one-window flow: `acr-claude` / `acr-codex` show a menu after each session to switch tool/account, restart, or quit — no second terminal
- Interactive menu for `acr switch` when `--to` is omitted
- Portable attached (inherit) transport so interactive agents work even without node-pty

Fixed

- CLI did nothing when invoked through a symlinked bin (`npm link` / global install); entry-point detection now resolves symlinks
- "Not logged in" when launching agents: pass `USER`/`LOGNAME` so macOS Keychain credentials resolve
- Interactive agent sessions now forward keystrokes (PTY strategy) instead of only streaming output
- `doctor` reports PTY availability from a real spawn probe instead of a bare import

## 1.0.0

- Initial local-first MVP implementation
- Added continuity store, resume engine, MCP server, CLI, runtime supervisor, fake adapter, and thin Claude/Codex adapters
