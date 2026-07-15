# Agent Continuity Runtime

Agent Continuity Runtime (ACR) is a local-first continuity layer for AI coding agents operating on the same working tree.

## What ACR does

- Stores portable continuity state under `.agent/`
- Stores machine-local runtime state under `.acr/`
- Generates evidence-backed resume briefs from state plus repository inspection
- Exposes continuity through an MCP server over stdio
- Supervises agent processes and performs best-effort failover
- Preserves work by checkpointing before and after handoff

## What ACR does not do

- Bypass usage limits, authentication, billing, or vendor controls
- Recover reasoning that was never written to disk
- Merge concurrent conflicting edits automatically
- Replace Git
- Run two agents concurrently on the same files by default

Both agents must operate on the same working tree, or changes must be synchronized by another mechanism.

## Status

Implemented and tested:

- Local continuity store and checkpointing
- Repository inspection and resume generation
- MCP server resources, tools, and prompts
- CLI commands for `init`, `status`, `validate`, `repair`, `checkpoint`, `resume`, `start`, `switch`, `adapters list`, `mcp serve`, and `doctor`
- PTY-first process runner with deterministic fake-agent failover tests
- Thin Claude Code and Codex adapters for detection, launch, and conservative termination classification

## Prerequisites

- Node.js 22 or newer
- npm 11 or newer
- A local repository or working directory
- Optional for real adapters:
  - `claude` installed and authenticated
  - `codex` installed and authenticated

## Installation

```bash
npm install
npm run build
```

For local CLI usage during development:

```bash
node dist/acr.js --help
```

After install/build, ACR also exposes direct shortcut entrypoints for the two
primary supervised flows:

```bash
acr-claude
acr-codex
```

Those shortcuts are equivalent to starting ACR supervision with:

- `acr-claude`: Claude Code primary, Codex fallback
- `acr-codex`: Codex primary, Claude Code fallback

## Five-minute quickstart

```bash
npm install
npm run build
node dist/acr.js init .
node dist/acr.js resume .
node dist/acr.js start . --agent fake-agent --scenario usage_limit --fallback fake-agent --fallback-scenario success
node dist/acr.js validate .
```

## Command examples

```bash
node dist/acr.js init .
node dist/acr.js start . --agent codex --fallback claude-code
node dist/acr.js resume .
node dist/acr.js switch . --to codex
node dist/acr.js status .
node dist/acr.js doctor
```

Shortcut examples:

```bash
acr-claude
acr-codex
acr-claude /absolute/path/to/repo
acr-codex /absolute/path/to/repo
```

## Claude Code setup

- Ensure `claude --help` works locally.
- Initialize ACR in the repository so `AGENTS.md`, `CLAUDE.md`, and `.agent/` exist.
- Run Claude Code from the same repository root that ACR initializes.
- For MCP usage, run:

```bash
node dist/acr.js mcp serve --project /absolute/path/to/repo
```

- Register that stdio server in Claude Code using your normal Claude MCP configuration flow.

## Codex setup

- Ensure `codex --help` works locally.
- Initialize ACR in the repository so `AGENTS.md` and `.agent/` exist.
- Run Codex from the same repository root that ACR initializes.
- For MCP usage, run the same stdio server:

```bash
node dist/acr.js mcp serve --project /absolute/path/to/repo
```

- Register that stdio server in Codex through its MCP configuration commands.

## Manual handoff

```bash
node dist/acr.js checkpoint . --summary "Completed parser changes" --next "Run the parser test suite and inspect failures"
node dist/acr.js resume .
```

## Automatic failover

Fake-agent demo:

```bash
./scripts/demo-fake-failover.sh
```

Real agents:

```bash
node dist/acr.js start . --agent claude-code --fallback codex
node dist/acr.js start . --agent codex --fallback claude-code
```

## Development

```bash
npm run format
npm run lint
npm run typecheck
npm run test
npm run build
npm run ci
```

## Security model

- Repository files are treated as untrusted input.
- Allowed-root checks block path escapes for MCP tool requests.
- State updates use optimistic concurrency and atomic writes.
- ACR never commits, resets, cleans, or reverts user code automatically.
- Runtime logs and checkpoint payloads avoid storing credentials and full transcripts.

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Troubleshooting

- `ACR_STATE_NOT_INITIALIZED`: run `acr init` first.
- `ACR_REVISION_CONFLICT`: reread current state, then retry mutation.
- `ACR_PATH_OUTSIDE_ROOT`: ensure the requested project root matches the configured MCP root.
- PTY allocation failure: ACR falls back to standard child-process execution for local supervision.

## Adapter development

Adapter boundaries live in separate packages:

- `packages/adapter-claude-code`
- `packages/adapter-codex`
- `packages/adapter-fake`

Each adapter is responsible only for detection, launch-spec construction, resume instruction formatting, and termination classification.

## Storage development

Local storage lives in `packages/storage-local` and is repository-first:

- `.agent/` holds portable continuity state
- `.acr/` holds machine-local runtime state

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Version 2 design and migration plan: [docs/ARCHITECTURE_V2.md](docs/ARCHITECTURE_V2.md).

```text
CLI / Runtime Supervisor
  -> adapters
  -> process runner
  -> checkpoints

MCP Server
  -> ProjectService
  -> storage-local
  -> runtime inspection/resume

Repository
  -> .agent/
  -> .acr/
  -> working tree
```

## Usage-limit detection limitations

- Vendor output changes over time.
- Exit codes alone are not enough to prove a usage limit.
- Classifiers are conservative and evidence-based, not guaranteed.

## Contribution and release

- Run `npm run ci` before proposing changes.
- Use `npm run test:real-agents` to verify bundled real-agent adapters against
  locally installed vendor CLIs when available.
- Update `docs/DEVIATIONS.md` for material spec deltas.
- Update `CHANGELOG.md` for user-visible release changes.
- The sample release workflow is in `.github/workflows/release.yml`.
