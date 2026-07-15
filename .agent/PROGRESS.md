# Progress

- 2026-07-15: Automatic handoff-memory enrichment is now live. Runtime
  supervisor writes structured conversation-memory context just before creating
  switch/failover checkpoints, and `prepare_handoff` does the same for explicit
  MCP handoffs. This means the next tool gets updated intent/context without a
  separate manual `record_memory` step. Verification:
  `npx vitest run packages/runtime/test/runtime.test.ts packages/mcp-server/test/server.test.ts`
  passes. `npm run typecheck` still fails only in existing
  `packages/cli/test/cli.test.ts` TS2532 lines 180/181/185/189/193.

- 2026-07-15: Added a structured conversation-memory layer for cross-tool
  handoff. `CurrentState` now stores `conversationMemory` with user intent,
  constraints, preferences, rejected approaches, open questions, and important
  context. Resume briefs now render a `Conversation Memory` section, so the
  next tool receives the user's why-notes as part of the handoff prompt. Added
  MCP tool `record_memory` for explicit writes. Verification:
  `npx vitest run packages/core/test/schemas.test.ts packages/runtime/test/runtime.test.ts packages/mcp-server/test/server.test.ts packages/storage-local/test/local-store.test.ts`
  passes. Repo-wide `npm run typecheck` still fails only in existing
  `packages/cli/test/cli.test.ts` TS2532 lines 180/181/185/189/193.

- 2026-07-15: Prepared a sellable delivery path. Generated
  `agent-continuity-runtime-1.0.0.tgz` via
  `npm --cache ./.npm-cache --logs-dir ./.npm-logs pack`, size 265 kB, SHA-256
  `b5ce351398ff3963db39e6985aebfbaf3159cd383efbdfd102fb163cb521af13`.
  Added `COMMERCIAL_DELIVERY.md` documenting what to send customers and how they
  install it, and linked that guide from `README.md`. Important caveat recorded:
  the project still declares Apache-2.0, so redistribution restrictions have
  not been tightened for proprietary resale.

- 2026-07-15: Replaced the placeholder bootstrap objective with the actual
  active runtime task. Repository truth shows one substantive code edit in
  `packages/runtime/src/transport-strategy.ts`: `node-pty` is now type-imported
  statically and implementation-loaded lazily inside `run()`, allowing PTY
  startup failures to propagate to runner fallback logic instead of hard-failing
  module load. Verification: `npx vitest run packages/runtime/test/runtime.test.ts`
  passes. Note: repo-wide `npm run typecheck` currently fails in
  `packages/cli/test/cli.test.ts` with existing TS2532 errors unrelated to this
  runtime file.

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
- 2026-07-14: Interactive-session fixes after real Claude/Codex trial exposed
  two gaps. (1) PtyTransportStrategy now forwards process.stdin -> child pty
  (raw mode + SIGWINCH resize + cleanup), so `acr start` can host a hands-on
  agent TUI when a PTY is available (previously it only streamed output, never
  accepted keystrokes). (2) `detectPtyAvailability` now does a real spawn probe
  instead of just importing node-pty, so `doctor` honestly reports pty
  availability; runner prints a clear one-line warning when it falls back from
  PTY. Root cause on this machine: node-pty 1.1.0 fails to spawn on Node v25
  ("posix_spawnp failed") even after `npm rebuild` — interactive PTY needs
  Node 22 LTS (matches package.json engines >=22). Build/typecheck/lint/tests
  pass; doctor now shows pty available: false on Node 25.
- 2026-07-14: Portability — added InheritTransportStrategy (stdio: "inherit",
  no native dep) so interactive agent sessions work on ANY Node/platform even
  when node-pty is unavailable. StrategyProcessRunner now picks order by
  interactivity: interactive TTY -> [pty, inherit(spawn), stdio]; non-interactive
  -> [pty, stdio] (keeps output capture for auto usage-limit classification).
  Trade-off documented: attached mode can't read output so auto usage-limit
  failover is reduced there (manual `acr switch` still works); full auto-failover
  wants Node 22 LTS. Installers warn on Node >24; README has a "Terminal modes"
  table. Added InheritTransportStrategy test; selection logic verified for both
  interactive and non-interactive. Build/typecheck/lint/tests pass.
- 2026-07-14: CRITICAL FIX — the CLI entry guard compared
  `process.argv[1] === fileURLToPath(import.meta.url)`, which never matched when
  `acr` was invoked through a symlink (exactly how `npm link` / global install
  expose it). Result: every installed `acr <cmd>` silently did nothing (exit 0,
  no output). Replaced with `isMainModule()` that realpath-resolves both sides.
  Added a regression test that execs the built bundle via a temp symlink and
  asserts help output. Verified `acr --help` / `acr doctor` now work via the
  linked bin. Build/typecheck/lint/full tests pass.
- 2026-07-14: Fixed "Not logged in" when ACR launches real claude/codex. The env
  allow-lists omitted USER, which macOS needs to reach the Keychain where the
  CLI login lives; the agent therefore launched unauthenticated even though the
  user was logged in. Reproduced (env -i HOME PATH ... claude -p → "Not logged
  in"; adding USER → "OK"; LOGNAME alone insufficient). Added USER + LOGNAME to
  CLAUDE_ENV_KEYS and CODEX_ENV_KEYS. Verified launch env now authenticates.
  Build/typecheck/lint/tests pass.
- 2026-07-14: UX — `acr switch` with no `--to` now shows an interactive numbered
  menu of installed agents (promptSelectAdapter) instead of erroring; the
  non-interactive path lists available ids in the error. User expected `switch`
  to present tool options. Excludes fake-agent from the menu. Added a menu test;
  updated help text. Build/lint/tests pass.
- 2026-07-15: One-window, menu-driven UX for beginners. `acr-claude`/`acr-codex`
  now run through runAgentLoop: after the agent ends, a numbered menu appears in
  the SAME terminal (postSessionChoices/promptPostSession) — continue with the
  other tool, continue with a second account of the same tool, restart, or quit.
  ACR checkpoints between iterations so the next agent resumes where the last
  left off. Picking a not-yet-configured second account runs an inline setup
  (ensureAltAccountConfigured: creates login dir, opens login, saves config).
  Blank/invalid answer defaults to quit. Non-interactive keeps JSON-output
  behavior. This removes the two-terminal `acr switch` requirement for the common
  case. Added menu tests; build/lint/full tests pass. Rationale: user asked for a
  dead-simple single-window flow for non-technical users.
- 2026-07-15: Discoverability — a first-time user had no way to know they must
  type /exit to reach the switch menu. runAgentLoop now shows a gated intro
  ("Press Enter to start...") before the first launch explaining that /exit (or
  Ctrl-C) brings up the menu; later launches show a one-line reminder. Honest
  limitation documented: the menu cannot auto-pop mid-session in attached mode
  (ACR can't see agent output or inject while the agent owns the terminal) —
  true auto-pop-on-limit needs a working PTY (Node 22). Build/lint/tests pass.
