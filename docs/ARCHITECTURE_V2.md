# Architecture V2

## Purpose

Version 1 proved the local-first continuity model and the basic failover loop.
Version 2 shifts the design goal from "support Claude Code and Codex" to
"provide a universal runtime for coding agents."

This document is the architectural plan for that transition.

It is normative for the V2 migration work in this repository.

## Why V1 Is Insufficient

The MVP is functional, but it was intentionally optimized for delivery speed,
small scope, and deterministic fake-agent verification. That created several
architectural constraints that are acceptable for V1 and limiting for V2.

### Runtime architecture

Current state:

- [packages/runtime/src/supervisor.ts](/Users/holingchang/Downloads/agent-runtime-os/packages/runtime/src/supervisor.ts)
  owns lifecycle, recovery, retry policy, failover policy, switch detection,
  runtime-state mutation, and adapter selection.
- The supervisor has direct knowledge of:
  - checkpoint timing
  - retry timing
  - vendor routing rules
  - switch file polling
  - repository evidence capture

Problem:

- Too many responsibilities are concentrated in one class.
- Any new routing policy, agent family, transport, or failure mode requires
  editing the supervisor directly.
- The runtime cannot evolve into a generic agent-control plane while policy and
  mechanism remain intertwined.

### Process supervision

Current state:

- [packages/runtime/src/process-runner.ts](/Users/holingchang/Downloads/agent-runtime-os/packages/runtime/src/process-runner.ts)
  exposes one runner with PTY-first logic and a fallback path.
- The runner returns a single aggregated `ProcessResult`.

Problem:

- The runtime mostly reasons after process exit rather than from streaming
  structured events.
- PTY, stdio, and spawn are embedded in one implementation rather than modeled
  as transport strategies.
- There is no first-class transport capability model.

### Agent abstraction

Current state:

- `AgentAdapter` combines:
  - installation detection
  - launch spec construction
  - termination classification
  - resume instruction construction

Problem:

- Adapters are still "runtime-aware" rather than "plugin-like."
- Classification logic is duplicated across adapters.
- The abstraction assumes a direct CLI launch model and does not clearly expose:
  - supported transports
  - event parsing hooks
  - scheduling metadata
  - cost or health metadata
  - capability tags

### Adapter system

Current state:

- Adapters are statically imported in the CLI.
- The registry is effectively hardcoded in `adapterRegistry()`.

Problem:

- Third-party adapters require code changes in this repository.
- There is no installable plugin contract.
- There is no dynamic agent pool or plugin discovery boundary.

### Failure detection

Current state:

- Adapters classify failures directly from `TerminationEvidence`.
- Runtime retry and failover policy still depend on supervisor logic and
  adapter-specific outputs.

Problem:

- The failure pipeline is split between adapter code and runtime code.
- Detection is mostly exit-centric instead of event-centric.
- There is no reusable normalized failure classifier that can consume:
  - stdout
  - stderr
  - exit code
  - signal
  - structured agent events

### Recovery pipeline

Current state:

- Recovery logic lives partly in:
  - `resume-engine.ts`
  - `repository-inspector.ts`
  - `project-service.ts`
  - `supervisor.ts`

Problem:

- Recovery responsibilities are spread across CLI, MCP service, and runtime.
- There is no dedicated recovery engine boundary for:
  - checkpoint validation
  - repository evidence capture
  - resume generation
  - handoff packaging
  - resume execution preparation

### Event pipeline

Current state:

- No dedicated runtime event system exists.
- Process output is streamed to the terminal, but decisions are mostly made
  after process completion.

Problem:

- Runtime policy cannot subscribe to normalized events.
- Observability, plugin hooks, richer scheduling, and future remote control all
  need a first-class event stream.

### Scheduling

Current state:

- Fallback order is an ordered array passed into `startSession`.
- The runtime only knows "primary + fallbacks."

Problem:

- The design assumes one primary and a small static fallback list.
- There is no scheduler capable of evaluating:
  - availability
  - priority
  - health
  - capabilities
  - cost
  - user preference
  - policy-based routing

### State synchronization

Current state:

- Runtime state is stored in `.acr/runtime.json`.
- Locking and switch request files exist, but session ownership is still local
  and file-polled.

Problem:

- There is no explicit session abstraction.
- Runtime state updates are not modeled as domain events.
- Remote or multi-process orchestration would require invasive changes.

### Storage abstraction

Current state:

- The store abstraction is good for V1 continuity state.
- Runtime-specific files and logs are handled through utility functions and
  direct filesystem access.

Problem:

- Runtime operational persistence is not yet represented as a dedicated port.
- Event logs, session state, switch requests, and future plugin state should
  live behind explicit interfaces.

### Plugin architecture

Current state:

- None. Adapters are linked directly into the CLI/runtime.

Problem:

- There is no stable public SDK boundary.
- There is no external plugin packaging contract.
- The runtime cannot become a universal agent platform without runtime plugin
  registration.

### Testability

Current state:

- V1 tests prove behavior, especially via fake-agent e2e.
- Most runtime policy is validated through one supervisor implementation.

Problem:

- It is harder than necessary to test:
  - scheduler decisions
  - event routing
  - classifier strategies
  - transport selection
  - plugin registration

### Performance

Current state:

- V1 is small and fast enough, but mostly synchronous in control flow.

Problem:

- Aggregating full output and re-reading state in multiple places will become
  less efficient as event volume and plugin count grow.
- There is no bounded in-memory event buffer contract or replay abstraction.

### Security

Current state:

- V1 enforces allowed roots, avoids destructive Git commands, and keeps the
  continuity store local-first.

Problem:

- There is no unified event redaction stage.
- Plugin boundaries are not yet defined.
- Third-party adapters will need capability restrictions and explicit trust
  boundaries.

## V2 Design Goals

V2 keeps the V1 repository-first model and `.agent/` continuity state, but
rebuilds the runtime as a layered system with stable extension points.

Primary goals:

- Support any coding agent with minimal new runtime code.
- Separate policy from mechanism.
- Separate event generation from decision making.
- Introduce a dynamic agent pool and scheduler.
- Treat adapters as plugins.
- Preserve V1 CLI commands and behavior while evolving the internals.

## Phase 2 Status

Phase 2 now extends the Phase 1 seams with working operational pieces:

- formal plugin manifests and validation
- public adapter SDK package
- external plugin loading without runtime source edits
- bundled Gemini CLI adapter
- persistent local agent health records
- deterministic scheduler decision objects
- normalized plugin lifecycle events
- redacted persisted runtime events
- upgraded `acr doctor`
- multi-OS CI matrix

The runtime remains local-first and repository-first. The main unresolved gap is
full live real-vendor failover verification. Current real-vendor coverage is
limited to executable detection, version detection, and launch/resume command
construction.

## V2 Layer Model

### Layer 1 — Launcher

Responsibility:

- startup
- configuration loading
- dependency injection
- runtime assembly

The launcher creates:

- agent registry
- scheduler
- transport selector
- failure classifier
- recovery engine
- runtime supervisor

The launcher does not supervise children directly.

### Layer 2 — Runtime Supervisor

Responsibility:

- session lifecycle
- child process management
- health and liveness
- checkpoint triggers
- switch and stop coordination

The supervisor consumes:

- launcher-provided dependencies
- normalized runtime events
- scheduler decisions
- recovery engine services

The supervisor does not parse vendor output directly.

### Layer 3 — Event Pipeline

Responsibility:

- normalize runtime and agent observations into typed events
- fan out to runtime decision consumers
- provide bounded event history for diagnostics and testing

Core event types:

- `AgentStarted`
- `AgentOutput`
- `AgentWarning`
- `UsageLimitDetected`
- `ContextLimitDetected`
- `AuthenticationFailure`
- `NetworkFailure`
- `AgentExited`
- `CheckpointCreated`
- `ResumeStarted`
- `ResumeFinished`
- `UnknownFailure`
- `SwitchRequested`
- `TransportSelected`

The event pipeline is the source of truth for runtime decisions.

### Layer 4 — Failure Classifier

Responsibility:

- consume process evidence and structured events
- return normalized failure decisions

Input:

- stdout
- stderr
- exit code
- signal
- normalized events

Output:

- failure type
- confidence
- retryability
- failover safety
- recommended recovery
- supporting evidence

Adapters may contribute evidence parsers or heuristics, but the runtime owns
the normalized classification contract.

### Layer 5 — Scheduler

Responsibility:

- choose the next agent
- apply routing and fallback policy

Selection factors:

- installation/availability
- priority
- health
- supported capabilities
- cost
- user preference
- policy constraints

The runtime never hardcodes "Claude then Codex."

### Layer 6 — Agent Pool

Responsibility:

- maintain the installed/registered agent set
- expose agent metadata to the scheduler and launcher
- support third-party adapter registration

Examples:

- Claude Code
- Codex
- Gemini CLI
- Cursor
- Aider
- Cline
- Roo Code

### Layer 7 — Recovery Engine

Responsibility:

- checkpoint validation
- repository inspection
- Git inspection
- resume generation
- handoff preparation
- repository evidence capture

The recovery engine is reusable by:

- CLI
- MCP server
- runtime supervisor
- future daemon or API surfaces

### Layer 8 — Shared Memory

Responsibility:

- preserve canonical `.agent/` continuity state
- preserve `.acr/` runtime state and operational metadata

V2 keeps the V1 local-first state model and evolves schemas conservatively.

## Proposed Package and Module Direction

V2 does not require an immediate package explosion. The first step is internal
modularization with stable interfaces.

Near-term structure inside the existing packages:

- `@acr/core`
  - runtime event schemas
  - transport contracts
  - scheduler contracts
  - plugin contracts
  - failure classification contracts
  - agent SDK types
- `@acr/runtime`
  - launcher
  - runtime supervisor
  - event pipeline
  - failure classifier
  - scheduler
  - agent registry
  - transport strategies
  - recovery engine bridge
- `@acr/mcp-server`
  - unchanged externally, but should depend on recovery interfaces rather than
    implicit runtime internals

Future optional packages:

- `@acr/plugin-sdk`
- `@acr/adapter-gemini`
- `@acr/adapter-cursor`
- `@acr/adapter-aider`

## Public SDK Direction

V2 introduces a public adapter/plugin contract.

A plugin should be able to provide:

- agent metadata
- installation detection
- launch spec construction
- capability declaration
- event parsing hints
- classifier hints or matchers
- transport preferences

The runtime should not require source edits to register:

- `@third-party/agent-roocode`

The minimum SDK surface should be:

- `AgentPlugin`
- `AgentRuntimeAdapter`
- `AgentDescriptor`
- `AgentCapabilitySet`
- `FailureSignalRule`
- `TransportPreference`

## Transport Strategy Model

V2 transport selection order:

1. PTY
2. stdio
3. spawn
4. best available fallback

Transport selection is capability-based, not hardcoded.

Each transport strategy reports:

- selected mode
- supported interactivity
- resize support
- signal semantics
- known limitations

## Real Vendor Verification

V2 keeps fake-agent e2e as the mandatory CI path and adds optional real-agent
integration when vendor CLIs are available locally.

The runtime should detect:

- `claude`
- `codex`
- `gemini`
- `cursor`

If installed:

- run adapter integration tests
- run launch/resume smoke tests

If unavailable:

- skip with explicit reporting

This keeps CI deterministic while improving real-world confidence.

## Migration Plan

V2 must preserve the MVP CLI and keep the repository runnable after each step.

### Phase 1 — Introduce interfaces without behavior change

- add runtime event types
- add scheduler interfaces
- add agent registry interfaces
- add launcher interfaces
- add transport strategy interfaces
- keep the old supervisor behavior behind the new abstractions

### Phase 2 — Move policy behind dedicated services

- move failure classification into a dedicated runtime classifier
- move fallback selection into a scheduler
- move static adapter lists into a registry

### Phase 3 — Add plugin registration

- allow runtime assembly from registered plugins
- keep bundled adapters as built-in plugins
- add SDK documentation and tests

### Phase 4 — Expand transport and verification

- transport strategy selection
- richer streaming event emission
- real-agent local integration detection and test harness

### Phase 5 — Optional future work

- daemonized runtime
- remote orchestration
- plugin sandboxing
- observability exports

## Tradeoffs

### Benefits

- new agents require less runtime modification
- runtime policy becomes testable in isolation
- transport and scheduling become replaceable
- plugin ecosystem becomes feasible

### Costs

- more interfaces and dependency injection
- more modules to keep coherent
- temporary duplication during migration

## Risks

### Migration risk

- The repository currently has solid MVP coverage. A careless refactor could
  regress the verified failover path.

Mitigation:

- keep the old CLI surface
- migrate in small steps
- add tests around every new seam

### Plugin trust risk

- Third-party adapters can widen the threat surface.

Mitigation:

- define explicit plugin capability boundaries
- keep storage and Git mutation policy in the core runtime

### Over-generalization risk

- Designing for every future agent can create abstraction debt.

Mitigation:

- standardize only the stable contracts:
  - launch
  - events
  - classification
  - scheduling metadata
  - transport preference

## Extension Points

Version 2 is intentionally designed around extension points:

- transport strategies
- classifier rule packs
- agent plugins
- schedulers
- recovery policies
- runtime event subscribers

## Immediate V2 Implementation Scope

The first V2 implementation steps in this repository are:

1. add launcher, registry, scheduler, transport, event, and classifier
   abstractions
2. route the existing supervisor through those abstractions
3. preserve all current CLI behavior
4. keep fake-agent e2e passing
5. add tests for the new layers

That is the architectural evolution target for the next implementation steps.
