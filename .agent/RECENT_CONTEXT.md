# Recent Context

- 2026-07-15: CI on `main` had been red on every recent commit (not caused by the
  uninstall change). Three independent pre-existing failures were fixed: (1)
  `format:check` — 9 tracked files not prettier-formatted, fixed with
  `npm run format`; (2) `lint` — unused `applyAutomaticConversationMemory` import
  in `packages/runtime/test/runtime.test.ts`, removed; (3) `typecheck` — five
  TS2532 in `packages/cli/test/cli.test.ts` (noUncheckedIndexedAccess), fixed with
  non-null assertions on `postSessionChoices` indexed access. Full `npm run ci`
  now passes locally (exit 0).
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
