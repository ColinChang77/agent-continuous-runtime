# Implementation Status

This file tracks the implementation against the normative requirements in [SPEC.md](/Users/holingchang/Downloads/agent-runtime-os/docs/SPEC.md).

## Milestone 0 — Repository foundation

Deliverables:

- [x] Monorepo/build setup
- [x] Strict TypeScript
- [x] Lint/format/test/CI
- [x] Core schemas
- [x] Documented development commands

Acceptance:

- [x] Clean install and build
- [x] Tests run in CI
- [x] No placeholder package with empty exports

## Milestone 1 — Local continuity store

Deliverables:

- [x] `.agent/` initialization
- [x] Atomic state writes
- [x] Instruction-file managed blocks
- [x] Revision conflicts
- [x] Checkpoints
- [x] Validation

Acceptance:

- [x] Repeated `acr init` is idempotent
- [x] Existing user instructions survive
- [x] Interrupted-write test preserves valid prior JSON
- [x] Checkpoint manifests validate

## Milestone 2 — Repository inspector and resume engine

Deliverables:

- [x] Git/non-Git inspection
- [x] Drift classifier
- [x] Resume brief
- [x] Safe reconciliation

Acceptance:

- [x] Uncommitted and untracked work is surfaced
- [x] Stale state is flagged
- [x] Exact next action is always present when resumable
- [x] No destructive commands run

## Milestone 3 — MCP server

Deliverables:

- [x] Stdio server
- [x] Required Resources, Tools, Prompts
- [x] Structured errors
- [x] Allowed-root enforcement

Acceptance:

- [x] Official MCP client tooling can list/invoke features over stdio
- [x] Path escape tests fail safely
- [x] Revision conflicts are observable
- [x] All required tools have tests

## Milestone 4 — CLI and runtime foundation

Deliverables:

- [x] Required CLI commands
- [x] PTY process runner
- [x] Runtime lock
- [x] Fake adapter
- [x] Interactive signal behavior

Acceptance:

- [x] Fake agent can be supervised interactively
- [x] Recovery checkpoint is written on abnormal exit
- [x] Ctrl+C behavior is documented and tested

## Milestone 5 — Claude Code and Codex adapters

Deliverables:

- [x] Installation/version detection
- [x] Launch specs
- [x] MCP/config guidance
- [x] Resume instructions
- [x] Conservative failure classifiers

Acceptance:

- [x] Adapters are separate packages/modules
- [x] Core has no vendor imports
- [x] Smoke tests can be run locally
- [x] Exact known error strings are data/config, not scattered logic

## Milestone 6 — Automatic failover

Deliverables:

- [x] Failover coordinator
- [x] Retry policy
- [x] Fallback order
- [x] Loop prevention
- [x] Handoff checkpoint
- [x] Launch of replacement agent

Acceptance:

- [x] Fake-agent e2e demonstrates full usage-limit failover
- [x] Partial edits are preserved
- [x] Unknown errors do not trigger unsafe loops
- [x] User interruption does not fail over by default

## Milestone 7 — Release readiness

Deliverables:

- [x] README installation and quickstart
- [x] Example Claude Code and Codex MCP configuration
- [x] Architecture and threat-model docs
- [x] npm package metadata
- [x] Changelog/release workflow
- [x] Sample repository/demo script

Acceptance:

- [x] A new developer can install, initialize, run fake demo, configure agents, and validate a project by following README only
- [x] Package tarballs contain required runtime files
- [x] No secrets or local paths are published

## Current Notes

- Status starts from an empty repository except for the specification.
- Material deviations must be recorded in `docs/DEVIATIONS.md`.
- Current verified command set: `npm run ci`
- Additional V2 architecture verification: `npm run test:real-agents`
- Additional partial real-vendor failover verification: `npm run test:real-failover`
- Additional manual verification: `npm --cache ./.npm-cache pack --dry-run`
- Additional automated verification: `npm run test:mcp:stdio`
- Additional automated verification: concurrent manual switch coverage in [packages/cli/test/cli.test.ts](/Users/holingchang/Downloads/agent-runtime-os/packages/cli/test/cli.test.ts)
- V2 foundations now present:
  - launcher-based dependency assembly
  - dynamic agent registry and scheduler
  - runtime event pipeline
  - dedicated failure classifier
  - transport strategy layer
  - plugin loading through `ACR_AGENT_PLUGINS`
  - optional real-agent verification harness
- V2 Phase 2 operational pieces now present:
  - `@acr/adapter-sdk` public package
  - validated plugin manifests
  - example external plugin package with CLI integration coverage
  - Gemini CLI adapter and tests
  - persistent local agent health records
  - deterministic scheduler decisions with exclusion reasons
  - persisted redacted runtime events
  - `acr health reset`
  - upgraded `acr doctor` text and `--json` output
  - cross-platform CI matrix
- Remaining unresolved deviations are documented in `docs/DEVIATIONS.md`.
