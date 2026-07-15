# Architecture

## Components

```text
User terminal
  -> acr CLI
     -> runtime supervisor
        -> process runner
        -> adapter registry
        -> checkpoints

MCP server
  -> ProjectService
     -> storage-local
     -> repository inspector
     -> resume engine

Repository
  -> .agent/
  -> .acr/
  -> working tree
```

## Package boundaries

- `@acr/core`
  - schemas, ports, shared domain types
- `@acr/storage-local`
  - `.agent/` and `.acr/` persistence, atomic writes, validation
- `@acr/runtime`
  - repository inspection, resume generation, locks, process supervision
- `@acr/mcp-server`
  - stdio MCP resources, tools, prompts, allowed-root enforcement
- `@acr/adapter-claude-code`
  - Claude Code detection, launch spec, termination classification
- `@acr/adapter-codex`
  - Codex detection, launch spec, termination classification
- `@acr/adapter-fake`
  - deterministic fake adapter for failover tests
- `acr`
  - command-line entrypoint

## Design notes

- Repository truth wins over continuity claims.
- Storage and runtime remain vendor-neutral.
- Real adapter logic is isolated to adapter packages.
- MCP mutations flow through the same store and resume services as the CLI.
