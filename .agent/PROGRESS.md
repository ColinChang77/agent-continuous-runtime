# Progress

- 2026-07-14: Added one-line installers `scripts/install.sh` (macOS/Linux) and
  `scripts/install.ps1` (Windows) that check prerequisites, clone, build, and
  register the global `acr` command. Documented in README "Quick install".
  Verified end-to-end: installer clones + builds from GitHub `main`, built CLI
  runs `acr --help`.
- 2026-07-14: Added `claude-code-alt` adapter for switching between Claude
  accounts. Parameterized `ClaudeCodeAdapter` (`id`, `displayName`,
  `envOverrides`) in `packages/adapter-claude-code`; registered a
  `builtin.claude-code-alt` plugin in `packages/cli` reading
  `ACR_CLAUDE_ALT_HOME` / `ACR_CLAUDE_ALT_API_KEY` / `ACR_CLAUDE_ALT_BASE_URL`.
  Documented in README "Multiple Claude accounts". Verified: build, typecheck,
  adapter tests pass; adapter appears in `adapters list` and launch spec carries
  the alternate HOME/API key. Note: usage-limit circumvention remains out of
  scope per project non-goals.
- 2026-07-14: Added `codex-alt` adapter mirroring `claude-code-alt`.
  Parameterized `CodexAdapter` (`id`, `displayName`, `envOverrides`), added
  `CODEX_HOME` to the codex env allow-list, and registered a `builtin.codex-alt`
  plugin reading `ACR_CODEX_ALT_HOME` (→CODEX_HOME) / `ACR_CODEX_ALT_API_KEY`
  (→OPENAI_API_KEY) / `ACR_CODEX_ALT_BASE_URL` (→OPENAI_BASE_URL). README
  section renamed to "Multiple accounts (Claude and Codex)". Verified: build,
  typecheck, lint, full tests pass; `adapters list` shows codex-alt; launch spec
  carries alternate CODEX_HOME/API key.
- 2026-07-14: Simplified UX with an `acr setup` wizard + saved config. New
  `packages/cli/src/config.ts` reads/writes `~/.acr/config.json` (primary,
  fallback, per-account home/apiKey/baseUrl). `runSetup` (reads /dev/tty so it
  works under `curl | bash`) asks primary agent + fallback mode (second account
  vs other tool), creates the account home dir, offers login, saves defaults.
  Alt adapters now source env from config (env vars still override). `acr start`
  with no `--agent`/`--fallback` uses saved defaults, so everyday use is
  `acr start .`. Installers run the wizard at the end (ACR_NO_SETUP=1 to skip).
  Added config/wizard tests. Verified flag-free start uses saved primary; build,
  typecheck, lint, full tests pass.

