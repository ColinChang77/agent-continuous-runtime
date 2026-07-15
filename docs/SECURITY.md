# Security

## Current Hardening

- no shell interpolation is used for adapter launch arguments
- adapter launch specs use argument arrays
- plugin module identifiers reject relative and traversal-style paths
- workspace fallback resolution is package-name based
- adapter environments are allowlisted instead of forwarding the full parent environment
- runtime event payloads redact common token and API-key patterns
- runtime health and event files use atomic writes
- repository operations remain non-destructive
- the runtime does not automatically run destructive Git commands

## Sensitive Areas

- plugin loading
- executable invocation
- environment forwarding
- event persistence
- resume-context generation

## Verified Security Tests

- unsafe plugin identifiers are rejected without crashing the runtime
- adapter launch specs preserve argument-array execution
- event redaction removes known secret patterns from persisted payloads
