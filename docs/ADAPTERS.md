# Adapters

Version 2 treats adapters as plugins.

## Plugin model

Bundled adapters are registered through the launcher, and third-party adapters
can be loaded without modifying runtime code by exporting `agentPlugin` or
`agentPlugins` from an installable module and setting:

```bash
ACR_AGENT_PLUGINS=@third-party/agent-roocode
```

The public SDK surface for plugins lives in `@acr/adapter-sdk` and currently exposes:

- `AgentPlugin`
- `AgentAdapter`
- `AgentCapabilities`
- `AgentLaunchRequest`
- `AgentResumeRequest`
- `AgentHealth`
- `RuntimeEvent`
- `FailureClassifierInput`
- `TransportMode`

An adapter plugin is responsible for:

- installation detection
- launch spec construction
- resume instruction construction
- agent capability declaration
- vendor-specific termination evidence

The runtime owns:

- scheduling
- event normalization
- checkpointing
- repository inspection
- recovery policy
- failover policy

## Real adapters

### Claude Code

- Executable: `claude`
- Detection: `claude --version`
- Launch: starts in the repository root with the resume brief as the initial prompt
- Classification: conservative pattern matching for usage, auth, network, context-limit, interrupt, and normal exit cases

### Codex

- Executable: `codex`
- Detection: `codex --version`
- Launch: starts in the repository root with the resume brief as the initial prompt
- Classification: conservative pattern matching for usage, auth, network, context-limit, interrupt, and normal exit cases

### Gemini CLI

- Executable: `gemini`
- Detection: `gemini --version`
- Launch: starts in the repository root with `--prompt-interactive` and the generated resume brief
- Classification: conservative pattern matching for quota, auth, network, context-limit, interrupt, and normal exit cases

## Test adapter

### Fake agent

- Deterministic local script used by the runtime tests
- Supports:
  - success
  - usage limit
  - partial crash
  - authentication failure
  - network failure
  - context limit
  - long-running interactive session
  - unknown failure

## Notes

- Adapter packages do not own storage or checkpoint logic.
- Adapter failure classification is evidence-based and intentionally conservative.
- Bundled adapters are loaded through the launcher registry rather than a
  hardcoded runtime switch.
- Optional local verification is available through `npm run test:real-agents`.
- Partial real-vendor resume-command verification is available through `npm run test:real-failover`.
