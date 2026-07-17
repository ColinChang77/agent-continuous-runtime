# Decisions

## DEC-VERIFICATION-FRESHNESS — Bind verification to repository truth

- Date: 2026-07-16
- Agent: codex
- Status: accepted
- Context: Session transfer and long-term agent memory already have mature open-source implementations; ACR needs a concrete repository-truth distinction.
- Decision: Bind verification results to repository evidence and mark them stale after HEAD, branch, status, or tracked project-content diff changes.
- Alternatives: Market generic cross-agent memory; import full vendor transcripts; claim semantic verification of handoff narratives.
- Consequences: ACR can honestly report evidence freshness without storing transcripts, but snapshot equality still does not prove every narrative claim.
- Related files: packages/core/src/schemas/current-state.ts, packages/runtime/src/repository-inspector.ts, packages/runtime/src/resume-engine.ts, packages/mcp-server/src/project-service.ts

- 2026-07-16: Keep exclusive locking for `acr start` and external `acr switch`,
  but let beginner shortcut commands use independent per-session locks so
  several terminal windows can run against one project. Serialize only the
  final shared continuity write/checkpoint, and do not consume ambiguous global
  switch requests from concurrent shortcut sessions.
- 2026-07-16: Treat missing `conversationMemory` as a legacy-state migration,
  not corruption; parse it as an empty structured memory object and persist the
  upgraded shape on the next state write.
- 2026-07-15: Auto-enrich conversation memory at handoff time from continuity
  state and handoff metadata so the main switch/failover path works without an
  explicit manual memory write.
- 2026-07-15: Implement conversation continuity as structured memory in
  `CURRENT_STATE.json` and resume-brief rendering, rather than raw transcript
  persistence.
- 2026-07-15: Add an explicit `record_memory` MCP tool so agents can persist
  user intent before handoff without calling low-level generic state patching.
- 2026-07-15: For paid delivery, use `npm pack` to create a single installable
  `.tgz` artifact rather than sending the whole source repository.
- 2026-07-15: Add a dedicated `COMMERCIAL_DELIVERY.md` guide so customer
  handoff instructions live in the repo and can be reused for future sales.
- 2026-07-15: Do not silently replace the existing Apache-2.0 license during
  this task; record the licensing caveat and leave the legal choice explicit.
- 2026-07-15: Set the active objective to the runtime transport fallback work,
  not continuity bootstrap, because the working tree contains a concrete
  `transport-strategy.ts` edit and no other substantive code changes.
- 2026-07-15: Record targeted runtime test results as the current verification
  signal and treat repo-wide typecheck failures in `packages/cli/test/cli.test.ts`
  as pre-existing noise until proven otherwise.
