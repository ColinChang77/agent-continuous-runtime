# Recent Context

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
