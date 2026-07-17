# Agent Continuity Runtime

[![CI](https://github.com/ColinChang77/agent-continuous-runtime/actions/workflows/ci.yml/badge.svg)](https://github.com/ColinChang77/agent-continuous-runtime/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg)](package.json)

Agent Continuity Runtime (ACR) is a local-first continuity layer for AI coding agents operating on the same working tree.

## What ACR does

- Stores portable continuity state under `.agent/`
- Stores machine-local runtime state under `.acr/`
- Generates evidence-backed resume briefs from state plus repository inspection
- Binds recorded verification results to the Git and working-tree snapshot where they ran, then marks them stale after repository drift
- Carries forward structured conversation memory such as user intent, constraints, preferences, rejected approaches, and open questions
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
- Structured conversation memory for cross-tool handoff without storing full transcripts by default
- MCP server resources, tools, and prompts
- CLI commands for `setup`, `init`, `status`, `validate`, `repair`, `checkpoint`, `resume`, `start`, `switch`, `adapters list`, `mcp serve`, and `doctor`
- One-line installers (`scripts/install.sh`, `scripts/install.ps1`) with a first-run `acr setup` wizard
- Beginner-friendly `acr-claude` / `acr-codex` shortcuts with a one-window menu to switch tool/account, restart, or quit
- Multiple-account adapters (`claude-code-alt`, `codex-alt`) driven by saved config or environment
- Transport selection with PTY, portable attached (inherit) fallback, and capturing stdio; deterministic fake-agent failover tests
- Thin Claude Code and Codex adapters for detection, launch, and conservative termination classification

## Prerequisites

- Node.js 22 or newer
- npm 11 or newer
- A local repository or working directory
- Optional for real adapters:
  - `claude` installed and authenticated
  - `codex` installed and authenticated

## Installation

For paid customer delivery using a packaged `.tgz` instead of the full source
repository, see [`COMMERCIAL_DELIVERY.md`](COMMERCIAL_DELIVERY.md).

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

After install/build, ACR also exposes two beginner-friendly entrypoints. Run one
in your project folder and just work — no flags, no second terminal:

```bash
acr-claude   # start with Claude Code
acr-codex    # start with Codex
```

When the agent ends (you quit it, or you hit a usage limit and quit), ACR shows
a simple menu **in the same window**:

```
──────────────────────────────────────────
Claude Code ended. What would you like to do next?
  [1] Continue with Codex (use this if you hit a usage limit)
  [2] Continue with a second Claude Code account
  [3] Restart Claude Code
  [4] Quit
──────────────────────────────────────────
Choose (1-4):
```

Pick a number and ACR checkpoints your progress, then launches the chosen tool or
account right where you left off — all in one terminal. Choosing a second account
for the first time sets it up (creates its own login folder and opens the login)
on the spot.

## Uninstall

To remove ACR, run the uninstaller for your platform. It undoes what the
installer did — the global `acr` command and the install directory
(`~/.agent-continuity-runtime`).

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/ColinChang77/agent-continuous-runtime/main/scripts/uninstall.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/ColinChang77/agent-continuous-runtime/main/scripts/uninstall.ps1 | iex
```

Or, from a cloned repo: `bash scripts/uninstall.sh` (`scripts/uninstall.ps1` on
Windows).

Your saved config at `~/.acr` may contain API keys, so it is **kept by default**
and you are asked before it is deleted. Flags:

- `--purge` — also delete `~/.acr` (config + saved accounts) without asking
- `--keep-config` — keep `~/.acr` without asking
- `-y` / `--yes` (shell only) — non-interactive; keeps `~/.acr`

Your projects' `.agent/` continuity directories are **never** touched — those are
your per-project records, not install artifacts. Delete them yourself if you no
longer want a project's history.

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

## Verification freshness

Verification results recorded through `complete_task` are bound to the current
Git HEAD, branch, status digest, tracked project-content diff, and untracked file
fingerprints (excluding ACR's own `.agent/` and `.acr/` metadata). Every resume
compares that evidence with a fresh repository inspection and labels it as:

- `current` — the recorded repository snapshot still matches
- `stale` — code or repository state changed after verification
- `unbound` — the result came from legacy state without repository evidence
- `not_run` — no passing or failing verification was recorded

ACR detects when evidence is no longer current; it does not claim that a passing
command proves every narrative statement in a handoff.

## Related projects

The coding-agent continuity ecosystem includes excellent tools with different
goals. [`continues`](https://github.com/yigitkonur/cli-continues) imports native
sessions across many agent CLIs. [`ai-memory`](https://github.com/akitaonrails/ai-memory)
and [`agentmemory`](https://github.com/rohitg00/agentmemory) focus on durable,
searchable long-term memory. OpenAI's
[`codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) supports direct
Claude Code to Codex transfer.

ACR focuses on repository-resident operational state, drift-aware resume briefs,
verification freshness, checkpointing, and supervised recovery. It can
complement native session transfer or a long-term memory system rather than
replace either one.

## Contribution and release

- Run `npm run ci` before proposing changes.
- Use `npm run test:real-agents` to verify bundled real-agent adapters against
  locally installed vendor CLIs when available.
- Update `docs/DEVIATIONS.md` for material spec deltas.
- Update `CHANGELOG.md` for user-visible release changes.
- The sample release workflow is in `.github/workflows/release.yml`.
