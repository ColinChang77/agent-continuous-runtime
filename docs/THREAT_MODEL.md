# Threat Model

## Scope

ACR runs locally, reads repository state, writes continuity metadata, exposes an MCP server, and may launch external agent CLIs.

## Threats

### Path traversal

- Risk: MCP callers request paths outside the configured repository root.
- Mitigation: `ensureAllowedRoot()` canonicalizes paths and rejects escapes.

### Symlink escapes

- Risk: a path appears inside the repository but resolves elsewhere.
- Mitigation: allowed-root checks use canonicalized real paths.

### Prompt injection from repository files

- Risk: repository content attempts to override ACR instructions.
- Mitigation: resume briefs treat repository content as evidence, not authority.

### Malicious state files

- Risk: malformed or tampered `.agent/` files break resume logic.
- Mitigation: schema validation, validation tooling, atomic replacement, optimistic concurrency.

### Secret leakage

- Risk: checkpoints or logs contain tokens, credentials, or full transcript dumps.
- Mitigation: ACR stores concise progress, not full chats; runtime captures bounded output only.

### Command injection

- Risk: untrusted text is passed to a shell.
- Mitigation: repository inspection uses explicit executable + arg arrays; adapters construct launch specs without shell interpolation.

### Untrusted Git repositories

- Risk: repository hooks or content trigger unexpected behavior.
- Mitigation: ACR does not run Git hooks directly and avoids destructive Git commands.

### MCP client misuse

- Risk: callers spam mutation tools or submit stale revisions.
- Mitigation: optimistic concurrency, lock usage, structured validation errors.

### Local multi-user machines

- Risk: another local user tampers with runtime files.
- Mitigation: repository ownership and host filesystem permissions remain the security boundary; ACR does not claim isolation beyond that.

### Oversized input / denial of service

- Risk: extremely large files or logs overwhelm memory.
- Mitigation: current MVP keeps resume/checkpoint payloads compact; future hard file-size caps are a recommended follow-up.

## Confirmation boundaries

ACR does not automatically:

- apply patches from snapshots
- commit or push
- change branches
- alter credentials
- enable unrestricted remote access

## Residual risk

- Vendor CLIs are external processes with evolving behavior.
- Usage-limit and auth classification remain best effort.
- PTY allocation can fail on some hosts; ACR falls back to standard child-process supervision in that case.
