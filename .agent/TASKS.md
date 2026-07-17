# Active task

## Goal

Differentiate ACR with repository-bound verification evidence that becomes
explicitly stale when project code changes after verification.

## Acceptance criteria

- Legacy state without verification evidence remains readable.
- Verification results recorded through `complete_task` are bound to a fresh
  repository snapshot.
- Resume briefs label verification as current, stale, unbound, or not run.
- Same-path tracked content changes invalidate earlier verification evidence.
- Same-path untracked content changes also invalidate earlier evidence without
  storing raw file contents.

## Status

Completed

## Completed

- Inspected the working tree and confirmed the active code change is in
  `packages/runtime/src/transport-strategy.ts`.
- Ran `npx vitest run packages/runtime/test/runtime.test.ts` and confirmed the
  runtime suite passes.
- Ran `npm --cache ./.npm-cache --logs-dir ./.npm-logs pack` and generated
  `agent-continuity-runtime-1.0.0.tgz`.
- Added `COMMERCIAL_DELIVERY.md` and linked it from `README.md`.
- Added `conversationMemory` to current state, rendered it into resume briefs,
  and added the `record_memory` MCP tool.
- Verified the new memory flow with targeted core/runtime/storage/MCP tests.
- Wired automatic handoff-memory enrichment into runtime supervisor checkpoints
  and `prepare_handoff`, so manual `record_memory` is no longer required for the
  common switch/failover path.
- Added backward-compatible defaults for legacy state without
  `conversationMemory`.
- Added distinct runtime locks for concurrent shortcut windows and serialized
  final continuity updates.
- Installed the rebuilt bundle globally and verified it against the exact
  previously failing frontend project.
- Passed targeted core/storage/runtime/CLI tests (36), format, lint, typecheck,
  and build.
- Added backward-compatible repository evidence to verification state.
- Corrected tracked diff hashing so it fingerprints diff content instead of
  hashing only the existing status fields.
- Bound `complete_task` verification to Git HEAD, branch, status, and diff
  evidence.
- Added resume freshness labels and stale/unbound warnings.
- Added related-project positioning and verification-freshness documentation.
- Added SHA-256 fingerprints for untracked project files while safely hashing
  symlink targets as link text rather than following them.
- Passed lint, typecheck, build, all 76 automated tests, and the focused
  26-test core/runtime/MCP verification suite.

## In progress

- None.

## Next

- Optionally add `acr resume --verify` to rerun explicitly approved stale
  commands rather than only reporting their freshness.

## Blocked

- The current Apache-2.0 license is still permissive for redistribution, which
  may conflict with a proprietary sales model.
- Structured memory is not the same as full transcript recall.
- Verification freshness proves snapshot equality, not the semantic truth of
  every narrative handoff claim.

## Out of scope

- Automatically rerunning arbitrary recorded commands during resume.
