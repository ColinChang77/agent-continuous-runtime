# Recent Context

- 2026-07-16: Added repository-bound verification freshness as ACR's concrete
  differentiation from transcript-transfer and long-term-memory tools.
  `complete_task` now binds verification results to Git HEAD, branch, status
  digest, and a tracked project-content diff digest. Resume labels evidence as
  `current`, `stale`, `unbound`, or `not_run`; legacy state remains readable.
  Fixed the previous `diffDigest` implementation, which accidentally rehashed
  status fields instead of diff content, and excluded `.agent/`/`.acr/` from
  content hashing to avoid self-referential invalidation. Same-path changes to
  tracked and untracked files are covered; untracked contents are represented
  only by local SHA-256 fingerprints and symlinks are not followed. Added an
  honest Related Projects section to README. Full suite passes: 76 tests, lint,
  typecheck, and build.
- 2026-07-16: Fixed `acr-codex` startup for legacy projects and enabled
  independent shortcut windows in the same project. The reported
  `Desktop/travel/frontend/.agent/CURRENT_STATE.json` was created before
  `conversationMemory` became required, so the new schema rejected it. The
  schema now supplies backward-compatible empty memory defaults. Shortcut
  sessions now use per-session runtime locks, ignore ambiguous project-wide
  switch requests, and serialize their final continuity-state/checkpoint write.
  Installed the rebuilt workspace globally and verified the global `acr resume`
  reads the affected frontend state successfully. Targeted core, storage,
  runtime, and CLI suites pass (36 tests); format, lint, typecheck, and build
  also pass.
- 2026-07-16: Open-sourced the project. The GitHub repo
  (ColinChang77/agent-continuous-runtime) was PRIVATE and its LICENSE was a
  73-byte stub (GitHub detected "Other"). Ran a secret scan over the working tree
  and full git history (sk-/ghp_/AKIA/xox/PRIVATE KEY) — clean, no secrets
  committed. Replaced LICENSE with the full Apache-2.0 text (Copyright 2026
  ColinChang77), added npm/repository metadata to package.json, and added
  CONTRIBUTING.md + root SECURITY.md. Then flipped the repo to PUBLIC via
  `gh repo edit --visibility public`; GitHub now detects "Apache License 2.0".
  npm publish was intentionally skipped (user dropped it). Note still open:
  `.mcp.json` is tracked and contains an absolute local path exposing the
  username; and the working tree still has uncommitted pre-existing deletions of
  COMMERCIAL_DELIVERY.md and agent-continuity-runtime-1.0.0.tgz.
- 2026-07-15: CI on `main` (ci.yml, matrix ubuntu/macos/windows) had been red on
  every recent commit — pre-existing, not caused by the uninstall change — and is
  now fully green (run 29467099210, all three OSes pass). Seven layered fixes:
  (1) `format:check` — 9 tracked files unformatted, fixed with `npm run format`;
  (2) `lint` — unused `applyAutomaticConversationMemory` import removed from
  `packages/runtime/test/runtime.test.ts`; (3) `typecheck` — five TS2532 in
  `packages/cli/test/cli.test.ts` fixed with non-null assertions;
  (4) Windows format:check flagged all 127 files (CRLF) — added `.gitattributes`
  forcing `eol=lf`; (5) `PtyTransportStrategy.terminate` called
  `child.kill("SIGINT")` which node-pty rejects on Windows ("Signals not
  supported") — guard to `kill()` without a signal on win32;
  (6) ROOT CAUSE of the Windows classification failures: diagnostic logging showed
  node-pty spawns on the Windows CI Node build but the child aborts natively
  (exit 134, C++ crash in the pty binding), masking the fake agent's real exit
  code so termination classified as "unknown". Fix in
  `packages/runtime/src/process-runner.ts`: prefer Stdio over PTY in
  non-interactive/headless mode (no terminal to emulate there; avoids the native
  node-pty dependency). Interactive TTY path still PTY-first and unchanged. Also
  added exit-code fallbacks in `packages/adapter-fake/src/index.ts`;
  (7) `cli.test.ts` asserted a raw path is contained in JSON output, but Windows
  backslashes are JSON-escaped — compare the JSON-encoded path instead.
  Commits: 91ca1fa, a7f3f4e, 7499a1b, ad12a55, ac3a69c, 9912e15, 5f0583d.
- 2026-07-15: Security review of the installer confirmed ACR's own source makes
  no outbound network calls (no telemetry/analytics, no http/https/net imports),
  keeps state in local files, and reads git read-only. Network activity is
  limited to install-time `git clone` + `npm install`, and the wrapped agent CLIs
  (claude/codex/gemini) talking to their own clouds. API keys are passed to the
  spawned agent's env and, if saved, written to `~/.acr/config.json` at mode 0600.
- 2026-07-15: Added uninstaller scripts `scripts/uninstall.sh` and
  `scripts/uninstall.ps1` (there was none before). They undo `npm link` and remove
  `~/.agent-continuity-runtime`; `~/.acr` is kept by default (may hold API keys)
  with `--purge` / `--keep-config` / `-y` flags. Project `.agent/` dirs are never
  touched. Verified via `bash -n` and fake-dir runs of both keep-config and purge
  cases. Documented under a new `## Uninstall` section in `README.md`.
- 2026-07-15: Automatic memory enrichment now runs at real handoff points
  (runtime switch/failover checkpoints and `prepare_handoff`). Manual
  `record_memory` remains available, but it is no longer required for the main
  path.
- 2026-07-15: User identified a real product gap: handoff preserved unfinished
  work but not the user's conversational context. The repo now stores
  structured conversation memory in current state and includes it in resume
  briefs.
- 2026-07-15: MCP now exposes `record_memory` so tools can persist user intent,
  preferences, rejected approaches, and open questions before a handoff.
- 2026-07-15: User asked how to hand the product to paying customers. The repo
  now includes `COMMERCIAL_DELIVERY.md` and a generated package artifact
  `agent-continuity-runtime-1.0.0.tgz`.
- 2026-07-15: Packaging succeeded with
  `npm --cache ./.npm-cache --logs-dir ./.npm-logs pack`.
- 2026-07-15: Current licensing remains Apache-2.0, so commercial distribution
  is operationally ready but not yet restricted for proprietary resale.
- 2026-07-15: Resume inspection showed the stored bootstrap objective lagged
  behind the working tree. The only substantive code diff is the runtime
  transport change in `packages/runtime/src/transport-strategy.ts`.
- 2026-07-15: Targeted verification passed for the runtime package via
  `npx vitest run packages/runtime/test/runtime.test.ts`.
- 2026-07-15: Repo-wide `npm run typecheck` is currently noisy because of
  existing TS2532 failures in `packages/cli/test/cli.test.ts`, so it is not
  reliable evidence for the runtime transport edit.
