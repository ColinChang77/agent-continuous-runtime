# Start Codex Implementation

Paste the following into Codex after opening this repository:

```text
You are the lead implementation engineer for this repository.

Read `docs/SPEC.md` completely before modifying files. Treat it as the normative product and technical specification.

Your task is to implement the working v1 MVP, not to rewrite or expand the specification.

Start by:
1. Inspecting the repository.
2. Creating `docs/IMPLEMENTATION_STATUS.md` with every milestone and acceptance criterion from the spec.
3. Creating the smallest sound monorepo foundation for Milestone 0.
4. Implementing Milestone 0 immediately.
5. Running formatting, linting, type checking, tests, and build.
6. Continuing milestone by milestone until the complete MVP is implemented.

Requirements:
- Prioritize executable behavior and tests over additional documentation.
- Do not stop after scaffolding.
- Do not claim automatic failover works until the fake-agent end-to-end test proves it.
- Keep Claude Code and Codex vendor logic isolated in adapters.
- Do not implement account rotation or usage-limit bypassing.
- Preserve a runnable repository after every milestone.
- Record material deviations from the spec in `docs/DEVIATIONS.md` instead of silently changing requirements.
- Do not ask me to restate context already present in the specification or repository.

Begin now with Milestone 0 and continue implementation.
```
