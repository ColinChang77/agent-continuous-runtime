# Decisions

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
