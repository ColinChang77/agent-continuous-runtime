# Deviations

Only unresolved deviations that are blocked by external limitations remain.

## PTY fallback on hosts where PTY allocation fails

- Date: 2026-07-14
- Classification: blocked by SDK limitation
- Exact SPEC requirement:
  - `docs/SPEC.md` Section 17.3: "The process runner MUST use a pseudo-terminal where required."
- Current behavior:
  - ACR is PTY-first through `node-pty`, but falls back to a standard child process when PTY allocation throws at runtime.
  - The fallback still preserves interactive supervision, stdout/stderr capture, interruption handling, checkpointing, and failover.
- Reason it cannot be implemented fully today:
  - PTY creation is delegated to the host operating system through `node-pty`.
  - When the host refuses PTY allocation, ACR cannot force PTY availability from user space.
- External limitation or dependency:
  - Host PTY availability and `node-pty` runtime behavior.
- Evidence supporting that limitation:
  - The implementation must catch PTY spawn failures in [packages/runtime/src/process-runner.ts](/Users/holingchang/Downloads/agent-runtime-os/packages/runtime/src/process-runner.ts).
  - Runtime tests verify the fallback path in [packages/runtime/test/runtime.test.ts](/Users/holingchang/Downloads/agent-runtime-os/packages/runtime/test/runtime.test.ts).
- Practical impact on users:
  - On affected hosts, the supervised agent may lose some terminal semantics that depend on a real PTY.
  - Continuity features still work, but terminal behavior may be slightly less faithful.
- Recommended future resolution:
  - Re-test against newer `node-pty` releases and host environments with reliable PTY support.
- Manual workaround:
  - Run ACR on a host where PTY allocation works normally.

## Full live real-vendor failover verification

- Date: 2026-07-14
- Classification: blocked by external limitation
- Exact SPEC requirement:
  - The V2 Phase 2 request requires true real-vendor failover verification, including controlled termination, runtime classification, replacement launch, and automatic resume delivery.
- Current behavior:
  - `npm run test:real-agents` verifies local Claude Code, Codex, and Gemini CLI detection and version reporting when installed.
  - `npm run test:real-failover` verifies real-adapter resume generation and launch-command construction only.
  - Deterministic end-to-end failover remains fully verified through the fake-agent runtime path.
- Reason it cannot be implemented fully today:
  - The locally available vendor CLIs do not expose a stable, low-cost, CI-safe control surface for deterministic interruption and continuation testing without invoking real paid agent sessions.
  - Safely reproducing vendor quota, auth, or context-limit conditions would require either unsupported CLI automation or intentionally consuming real vendor resources.
- External limitation or dependency:
  - Vendor CLI automation surfaces, authentication state, and paid session semantics.
- Evidence supporting that limitation:
  - Real local verification is currently limited to executable and command construction through [scripts/real-agent-integration.mjs](/Users/holingchang/Downloads/agent-runtime-os/scripts/real-agent-integration.mjs) and [scripts/real-failover.mjs](/Users/holingchang/Downloads/agent-runtime-os/scripts/real-failover.mjs).
  - The repository does not have a deterministic vendor-provided harness for launching, interrupting, and resuming Claude Code or Codex sessions under CI-safe conditions.
- Practical impact on users:
  - Real adapter installation and resume-command generation are verified.
  - Full live vendor replacement behavior is not yet a verified claim.
- Recommended future resolution:
  - Add vendor-supported scripted test modes or stable session-control surfaces when available.
  - Expand the real-failover harness once a CI-safe launch/interrupt/resume path exists.
- Manual workaround:
  - Use the fake-agent e2e suite for deterministic automation coverage and manually exercise live vendor switching in a local repository when desired.
