# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** — do not open a public
GitHub issue.

Use GitHub's [private vulnerability reporting](https://github.com/ColinChang77/agent-continuous-runtime/security/advisories/new)
("Report a vulnerability" under the repository's **Security** tab). We aim to
acknowledge reports within a few days and will keep you updated on the fix.

## Scope and design notes

ACR is local-first: it stores continuity state in local files and does not send
your data to any external service. It launches your existing agent CLIs
(e.g. Claude Code, Codex) and reads your repository read-only via `git`.

For the project's security model and threat analysis, see:

- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)

Secrets (API keys) are only read from the environment or vendor-native
mechanisms and passed to the agent process ACR launches; ACR does not transmit
them anywhere. Persisted logs and state redact common token/API-key patterns.
