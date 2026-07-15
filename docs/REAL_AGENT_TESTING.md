# Real Agent Testing

## Commands

```bash
npm run test:real-agents
npm run test:real-failover
```

## `test:real-agents`

This command verifies:

- local executable detection
- adapter installation detection
- version reporting

Current locally verified results on 2026-07-14:

- Claude Code: verified
- Codex: verified
- Gemini CLI: verified
- Cursor: skipped because not installed

## `test:real-failover`

This command is intentionally conservative.

Current verification level:

- `command-construction-only`

It verifies:

- real CLI detection
- resume-instruction generation
- launch-command construction

It does not currently verify:

- live paid-session launch
- controlled real-vendor termination
- full real-vendor replacement-agent continuation

Those behaviors remain outside the verified set for V2 Phase 2.
