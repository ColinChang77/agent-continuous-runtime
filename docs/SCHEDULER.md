# Scheduler

The V2 scheduler is deterministic and explainable.

## Policy

Current policy name:

- `priority-availability-health-cost`

Inputs considered:

- configured priority
- installation status
- detected authentication status
- runtime health availability
- cooldown state
- required capabilities
- preferred transport
- allowlist and denylist
- current agent exclusion
- maximum consecutive uses
- failover loop prevention for usage, authentication, and context-limit failures

## Decision Object

Each decision contains:

- `selectedAgentId`
- `eligibleCandidates`
- `excludedCandidates`
- `policy`
- `timestamp`

Excluded candidates always include explicit reasons such as:

- `not_installed`
- `authentication_unavailable`
- `runtime_health_unavailable`
- `capability_mismatch`
- `transport_mismatch`
- `cooldown_active`
- `failover_loop_prevention`
- `max_consecutive_uses_reached`

## Persistence

Scheduler inputs consume runtime health records from `.acr/agent-health.json`.

Those records survive runtime restarts and track:

- last successful launch
- last successful completion
- last failure
- failure type
- consecutive failures
- consecutive uses
- cooldown start
- cooldown expiry
- availability
- last health check

## Verification

Deterministic scheduler tests cover:

- normal priority selection
- unavailable preferred agent
- usage-limit cooldown
- authentication failure
- capability mismatch
- all agents unavailable
- loop prevention
