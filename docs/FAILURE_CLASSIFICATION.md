# Failure Classification

Failure classification is centralized in `packages/runtime/src/failure-classifier.ts`.

## Inputs

The classifier accepts:

- stdout
- stderr
- exit code
- signal
- timeout metadata
- transport-error metadata
- structured adapter events
- normalized runtime events

## Output

Every classification includes:

- `kind`
- `confidence`
- `evidence`
- `recommendedAction`
- `retryable`
- `safeToFailover`
- `cooldownMs`
- `failoverAppropriate`

## Adapter Role

Adapters still provide vendor-specific termination parsing. The runtime owns:

- evidence sanitation
- cooldown defaults
- normalized failure events
- event-derived confidence bumps

## Safety

- evidence is truncated and redacted before logging
- bearer tokens and `sk-...` style secrets are redacted
- unknown failures remain `unknown`

## Verified Adapters

- Claude Code
- Codex
- Gemini CLI
- Fake test adapter
