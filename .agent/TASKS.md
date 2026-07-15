# Active task

## Goal
Add a structured conversation-memory layer so cross-tool handoff preserves user
intent and key context, not just unfinished tasks.

## Acceptance criteria
- Current state schema stores structured user-intent memory fields.
- Resume briefs include that memory for the next tool.
- An explicit MCP tool exists to record handoff memory without storing raw
  transcripts by default.

## Status
In progress

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

## In progress
- Updating repo continuity notes and docs to reflect the new handoff-memory
  model.

## Next
- Decide whether to add opt-in transcript capture above the structured memory
  layer.
- Decide whether a dedicated human-readable memory document is worth adding.

## Blocked
- `npm run typecheck` currently fails in `packages/cli/test/cli.test.ts`
  (TS2532 on lines 180, 181, 185, 189, and 193). This appears unrelated to the
  memory-layer work.
- The current Apache-2.0 license is still permissive for redistribution, which
  may conflict with a proprietary sales model.
- Structured memory is not the same as full transcript recall.

## Out of scope
- Fixing unrelated CLI test typing failures unless they prove coupled to the
  current memory-layer work.
