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

### Quick install (recommended)

One line downloads a script that checks your environment, clones the repo,
builds it, and registers the global `acr` command.

**macOS / Linux** (bash or zsh):

```bash
curl -fsSL https://raw.githubusercontent.com/ColinChang77/agent-continuous-runtime/main/scripts/install.sh | bash
```

**Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/ColinChang77/agent-continuous-runtime/main/scripts/install.ps1 | iex
```

The installer finishes by running a short **setup wizard** (`acr setup`) that
asks two questions — which agent you use most, and what should take over when it
hits a usage limit (a second account of the same tool, or the other tool). Your
answers are saved, so from then on the everyday command is just:

```bash
acr start .
```

You can re-run the wizard any time with `acr setup`, or skip it during install
with `ACR_NO_SETUP=1`. Verify the install with:

```bash
acr --help
```

The installer clones into `~/.agent-continuity-runtime` by default. You can
override behavior with environment variables:

| Variable          | Default                       | Purpose                                  |
| ----------------- | ----------------------------- | ---------------------------------------- |
| `ACR_INSTALL_DIR` | `~/.agent-continuity-runtime` | Where to install                         |
| `ACR_BRANCH`      | `main`                        | Which branch to install                  |
| `ACR_NO_LINK`     | _(unset)_                     | Set to `1` to skip the global `acr` link |

If the global command can't be registered (a permissions issue on some
systems), the installer prints the exact `node dist/acr.js` command to run
instead.

> Prefer to read a script before piping it to a shell? The sources are
> [`scripts/install.sh`](scripts/install.sh) and
> [`scripts/install.ps1`](scripts/install.ps1).

### Manual install (from a cloned repo)

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

## Multiple accounts (Claude and Codex)

The easiest way to set this up is the wizard:

```bash
acr setup
```

It asks which agent you use most and whether the fallback is a second account
of the same tool or the other tool, creates a folder for the second account's
login, offers to log you in, and saves everything to `~/.acr/config.json`. After
that, `acr start .` just works.

The rest of this section documents what the wizard configures under the hood, in
case you want to set it up manually or in CI.

ACR ships two extra built-in adapters, `claude-code-alt` and `codex-alt`, that
run the same `claude` / `codex` binary but against a **different account**. This
keeps separate work/client credentials isolated per project.

Each alt adapter takes its account settings from `acr setup` (saved config) or,
if set, from environment variables (which override the saved config), and falls
back to the default account if neither is present.

**Claude:**

| Variable                  | Purpose                                                                      |
| ------------------------- | ---------------------------------------------------------------------------- |
| `ACR_CLAUDE_ALT_HOME`     | A separate `HOME` so `claude` reads a different `~/.claude` credential store |
| `ACR_CLAUDE_ALT_API_KEY`  | An alternate `ANTHROPIC_API_KEY`                                             |
| `ACR_CLAUDE_ALT_BASE_URL` | An alternate `ANTHROPIC_BASE_URL`                                            |

**Codex:**

| Variable                 | Purpose                                                                          |
| ------------------------ | -------------------------------------------------------------------------------- |
| `ACR_CODEX_ALT_HOME`     | A separate `CODEX_HOME` so `codex` reads a different `~/.codex` credential store |
| `ACR_CODEX_ALT_API_KEY`  | An alternate `OPENAI_API_KEY`                                                    |
| `ACR_CODEX_ALT_BASE_URL` | An alternate `OPENAI_BASE_URL`                                                   |

The most robust way to separate two logged-in accounts is a separate config
home so each account keeps its own stored login.

Claude example:

```bash
# One-time: log account B into its own HOME
mkdir -p ~/claude-account-b
HOME=~/claude-account-b claude   # complete the login flow for account B

# Then use it through ACR
export ACR_CLAUDE_ALT_HOME=~/claude-account-b
node dist/acr.js start . --agent claude-code-alt
node dist/acr.js switch . --to claude-code-alt   # or switch to it any time
```

Codex example:

```bash
# One-time: log account B into its own CODEX_HOME
mkdir -p ~/codex-account-b
CODEX_HOME=~/codex-account-b codex login   # complete the login flow for account B

# Then use it through ACR
export ACR_CODEX_ALT_HOME=~/codex-account-b
node dist/acr.js start . --agent codex-alt
node dist/acr.js switch . --to codex-alt
```

> Note: if `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` is set in your shell it takes
> precedence over the stored login for both adapters of that vendor. For clean
> home-based separation, either unset it or set the matching
> `ACR_*_ALT_API_KEY` explicitly for the alt account.

All four adapters show up together:

```bash
node dist/acr.js adapters list   # claude-code, claude-code-alt, codex, codex-alt, ...
```

**Important:** using multiple accounts to work around usage limits, billing, or
other vendor controls is out of scope (see "What ACR does not do"). Account
separation is intended for legitimately distinct identities, e.g. isolating a
client's credentials from your own.

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

## Terminal modes (why this matters across Node versions)

Interactive agents (the Claude/Codex TUIs) need a real terminal. ACR selects a
transport automatically:

| Mode         | Needs node-pty | Interactive       | Reads agent output → auto usage-limit failover |
| ------------ | -------------- | ----------------- | ---------------------------------------------- |
| **PTY**      | yes            | yes               | yes (best experience)                          |
| **Attached** | no             | yes               | no — classifies on exit code; use `acr switch` |
| **Stdio**    | no             | no (capture only) | yes                                            |

When you run in a real terminal, ACR prefers **PTY**. If node-pty is unavailable
(common on brand-new Node majors — the native module tracks the Node LTS line),
ACR automatically falls back to **Attached** mode so the agent TUI still works on
any Node version and platform; only automatic usage-limit detection is reduced
there (manual `acr switch` still hands off). For the full automatic-failover
experience, use **Node 22 LTS**. Non-interactive/CI runs use output-capturing
transports so classification is unaffected.

Check what your environment supports:

```bash
node dist/acr.js doctor   # reports "pty available: true/false"
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
