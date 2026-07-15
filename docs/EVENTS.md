# Events

The runtime uses a normalized local-first event pipeline.

## Event Envelope

Every event includes:

- `sequence`
- `timestamp`
- `sessionId`
- `runId`
- `agentId`
- `schemaVersion`

## Event Types

Current normalized events:

- `AgentStarted`
- `AgentOutput`
- `AgentWarning`
- `UsageLimitDetected`
- `ContextLimitDetected`
- `AuthenticationFailure`
- `NetworkFailure`
- `UnknownFailure`
- `AgentExited`
- `CheckpointCreated`
- `ResumeStarted`
- `ResumeFinished`
- `SwitchRequested`
- `TransportSelected`
- `SchedulerDecision`
- `PluginDiscovered`
- `PluginLoaded`
- `PluginRejected`
- `PluginInitializationFailure`

## Guarantees

- sequence numbers are monotonic per pipeline session
- in-memory history is bounded
- events are serializable to JSON
- known token and API-key patterns are redacted
- subscriber failures are isolated
- local persistence is append-style JSONL per session under `.acr/events/`

## Current Limitation

Event persistence is local and file-backed only. ACR does not ship a remote
broker or cross-process replay service in V2 Phase 2.
