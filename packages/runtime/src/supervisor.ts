import type { AgentAdapter } from "@acr/core";
import { createLocalStore } from "@acr/storage-local";
import { randomUUID } from "node:crypto";

import { createRuntimeEventPipeline } from "./event-pipeline.js";
import { createFailureClassifier } from "./failure-classifier.js";
import type { DefaultFailureClassifier } from "./failure-classifier.js";
import { createAgentHealthStore } from "./health-store.js";
import { applyAutomaticConversationMemory } from "./conversation-memory.js";
import {
  createDiffDigest,
  createRepositoryInspector,
  createStatusDigest
} from "./repository-inspector.js";
import { createResumeEngine } from "./resume-engine.js";
import { createProcessRunner, type ProcessRunner } from "./process-runner.js";
import { acquireRuntimeLock, RuntimeLockedError } from "./runtime-lock.js";
import {
  appendRuntimeLog,
  clearSwitchRequest,
  defaultRuntimeState,
  patchRuntimeState,
  readRuntimeState,
  readSwitchRequest,
  writeRuntimeState,
  writeSwitchResult,
  type SwitchRequest
} from "./runtime-state.js";

export interface StartSessionOptions {
  projectRoot: string;
  agent: AgentAdapter;
  fallbacks?: AgentAdapter[];
  scenario?: string;
  fallbackScenarios?: string[];
  maxFailovers?: number;
  networkRetryCount?: number;
  resolveAdapterById?: (id: string) => AgentAdapter | undefined;
  /** Allow independent shortcut sessions to run in the same project. */
  allowConcurrent?: boolean;
}

export interface StartSessionResult {
  agentId: string;
  fallbackAgentId: string | null;
  classification: Awaited<ReturnType<AgentAdapter["classifyTermination"]>>;
  checkpoints: string[];
}

export class RuntimeSupervisor {
  private readonly store = createLocalStore();
  private readonly resumeEngine = createResumeEngine(this.store);
  private readonly inspector = createRepositoryInspector();
  private eventPipeline = createRuntimeEventPipeline();
  private readonly failureClassifier: DefaultFailureClassifier =
    createFailureClassifier();
  private readonly healthStore = createAgentHealthStore();

  constructor(
    private readonly processRunner: ProcessRunner = createProcessRunner()
  ) {}

  async startSession(
    options: StartSessionOptions
  ): Promise<StartSessionResult> {
    await this.store.initialize(options.projectRoot);
    this.eventPipeline.clear();
    const runtimeState = await readRuntimeState(options.projectRoot).catch(
      async () => {
        const created = defaultRuntimeState(
          options.projectRoot,
          (options.fallbacks ?? []).map((adapter) => adapter.id)
        );
        return writeRuntimeState(options.projectRoot, created);
      }
    );
    const concurrentSessionKey = options.allowConcurrent
      ? `runtime-${process.pid}-${randomUUID()}`
      : null;
    const sessionRuntimeId = concurrentSessionKey
      ? `${runtimeState.runtimeId}-${concurrentSessionKey}`
      : runtimeState.runtimeId;
    this.eventPipeline = createRuntimeEventPipeline({
      projectRoot: options.projectRoot,
      persist: true,
      sessionId: sessionRuntimeId,
      runId: `run-${Date.now().toString(36)}`
    });
    const lock = await acquireRuntimeLock(
      options.projectRoot,
      sessionRuntimeId,
      "runtime-supervision",
      concurrentSessionKey ?? "runtime"
    );
    const checkpoints: string[] = [];
    const fallbackOrder = options.fallbacks ?? [];
    const maxFailovers = options.maxFailovers ?? 2;
    const networkRetryCount = options.networkRetryCount ?? 1;

    try {
      if (!options.allowConcurrent) {
        await clearSwitchRequest(options.projectRoot);
      }
      await patchRuntimeState(options.projectRoot, (current) => ({
        ...current,
        status: "starting",
        activeAgent: options.agent.id,
        fallbackOrder: fallbackOrder.map((adapter) => adapter.id),
        startedAt: current.startedAt ?? new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
        failover: {
          ...current.failover,
          attempt: 0,
          maxAttempts: maxFailovers,
          lastReason: null
        }
      }));
      const primary = await this.runSingleAgentWithRetry(
        options.projectRoot,
        options.agent,
        options.scenario,
        networkRetryCount,
        options.resolveAdapterById,
        options.allowConcurrent
      );
      checkpoints.push(primary.checkpointId);

      let lastFallbackAgentId: string | null = null;
      let failovers = 0;
      let currentClassification = primary.classification;

      while (
        currentClassification.safeToFailover &&
        failovers < maxFailovers &&
        fallbackOrder[failovers]
      ) {
        const fallback = fallbackOrder[failovers];
        if (!fallback) break;
        if (!this.canFailOver(options.agent, fallback, currentClassification)) {
          break;
        }

        const fallbackRun = await this.runSingleAgentWithRetry(
          options.projectRoot,
          fallback,
          options.fallbackScenarios?.[failovers],
          networkRetryCount,
          options.resolveAdapterById,
          options.allowConcurrent
        );
        checkpoints.push(fallbackRun.checkpointId);
        lastFallbackAgentId = fallback.id;
        failovers += 1;
        currentClassification = fallbackRun.classification;

        await patchRuntimeState(options.projectRoot, (current) => ({
          ...current,
          status: "failing_over",
          activeAgent: fallback.id,
          lastHeartbeatAt: new Date().toISOString(),
          failover: {
            ...current.failover,
            attempt: failovers,
            lastReason: primary.classification.kind
          }
        }));
      }

      return {
        agentId: options.agent.id,
        fallbackAgentId: lastFallbackAgentId,
        classification: primary.classification,
        checkpoints
      };
    } catch (error) {
      await patchRuntimeState(options.projectRoot, (current) => ({
        ...current,
        status: "failed",
        activeAgent: null,
        lastHeartbeatAt: new Date().toISOString()
      })).catch(() => undefined);
      throw error;
    } finally {
      await patchRuntimeState(options.projectRoot, (current) => ({
        ...current,
        status: "stopped",
        activeAgent: null,
        lastHeartbeatAt: new Date().toISOString()
      })).catch(() => undefined);
      await lock.release();
    }
  }

  private async runSingleAgentWithRetry(
    projectRoot: string,
    adapter: AgentAdapter,
    scenario: string | undefined,
    networkRetryCount: number,
    resolveAdapterById?: (id: string) => AgentAdapter | undefined,
    allowConcurrent = false
  ) {
    let attempts = 0;
    let lastResult = await this.runSingleAgent(
      projectRoot,
      adapter,
      scenario,
      resolveAdapterById,
      allowConcurrent
    );

    while (
      lastResult.classification.kind === "network_failure" &&
      lastResult.classification.retryable &&
      attempts < networkRetryCount
    ) {
      attempts += 1;
      const delayMs = 250 * 2 ** (attempts - 1);
      await appendRuntimeLog(
        projectRoot,
        `Retrying ${adapter.id} after network failure in ${delayMs}ms.`,
        "failover"
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      lastResult = await this.runSingleAgent(
        projectRoot,
        adapter,
        scenario,
        resolveAdapterById,
        allowConcurrent
      );
    }

    return lastResult;
  }

  private async runSingleAgent(
    projectRoot: string,
    adapter: AgentAdapter,
    scenario: string | undefined,
    resolveAdapterById?: (id: string) => AgentAdapter | undefined,
    allowConcurrent = false
  ) {
    const brief = await this.resumeEngine.generate(projectRoot);
    this.eventPipeline.emit({
      type: "ResumeStarted",
      agentId: adapter.id
    });
    const resumeInstruction = await adapter.buildResumeInstruction({ brief });
    this.eventPipeline.emit({
      type: "ResumeFinished",
      agentId: adapter.id
    });
    const spec = await adapter.buildLaunchSpec(
      scenario
        ? { projectRoot, resumeInstruction, scenario }
        : { projectRoot, resumeInstruction }
    );
    await patchRuntimeState(projectRoot, (current) => ({
      ...current,
      status: "running",
      activeAgent: adapter.id,
      lastHeartbeatAt: new Date().toISOString()
    }));
    await appendRuntimeLog(projectRoot, `Launching ${adapter.id}.`);

    // A project-wide switch request is ambiguous when several shortcut
    // windows are active. Concurrent shortcut sessions use their own post-run
    // menu, so only exclusive sessions listen for external switch requests.
    const monitor = allowConcurrent
      ? { stop: async () => null }
      : this.createSwitchMonitor(projectRoot);
    const result = await this.processRunner.run(spec, {
      onTransportSelected: (mode) => {
        this.eventPipeline.emit({
          type: "TransportSelected",
          agentId: adapter.id,
          transport: mode
        });
      },
      onStarted: (pid, mode) => {
        void this.healthStore.markLaunch(projectRoot, adapter.id);
        this.eventPipeline.emit({
          type: "AgentStarted",
          agentId: adapter.id,
          transport: mode,
          pid
        });
      },
      onOutput: (stream, text) => {
        this.eventPipeline.emit({
          type: "AgentOutput",
          agentId: adapter.id,
          stream,
          text
        });
      },
      onExit: (exitCode, signal) => {
        this.eventPipeline.emit({
          type: "AgentExited",
          agentId: adapter.id,
          exitCode,
          signal
        });
      }
    });
    const switchRequest = await monitor.stop();
    const classification = await this.failureClassifier.classify({
      agent: adapter,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      signal: result.signal,
      events: this.eventPipeline.list()
    });
    const failureEvent = this.failureClassifier.toEvent(
      adapter.id,
      classification
    );
    if (failureEvent) {
      this.eventPipeline.emit(failureEvent);
    }
    if (classification.kind === "normal_exit") {
      await this.healthStore.markCompletion(projectRoot, adapter.id);
    } else {
      await this.healthStore.markFailure(
        projectRoot,
        adapter.id,
        classification.kind,
        classification.cooldownMs ?? null
      );
    }
    const reason = switchRequest ? "switch" : classification.kind;
    const summary = switchRequest
      ? `Manual switch requested while ${adapter.id} was active. Repository truth was checkpointed; narrative intent may lag behind repository state.`
      : `Agent ${adapter.id} exited with ${classification.kind}. Repository truth was checkpointed; narrative intent may lag behind repository state.`;
    // Serialize the short continuity update across concurrent windows. Without
    // this, two agents exiting together can both read the same revision and
    // race while writing CURRENT_STATE.json.
    const stateLock = await this.acquireStateUpdateLock(projectRoot);
    let checkpoint;
    try {
      const currentState = await this.captureRepositoryEvidence(projectRoot);
      const stateWithMemory = await this.store.writeCurrentState(
        projectRoot,
        {
          ...currentState,
          conversationMemory: applyAutomaticConversationMemory(currentState, {
            agentId: adapter.id,
            ...(switchRequest?.targetAdapterId
              ? { targetAgentId: switchRequest.targetAdapterId }
              : {}),
            failureKind: reason,
            handoffSummary: summary,
            nextAction: currentState.recovery.resumeFrom,
            changedFiles: brief.changedFiles
          })
        },
        currentState.revision
      );
      checkpoint = await this.store.createCheckpoint(projectRoot, {
        checkpointId: `${new Date().toISOString().replaceAll(":", "-")}_${adapter.id}`,
        reason,
        summary,
        handoff: resumeInstruction,
        currentState: stateWithMemory,
        safeToResume: switchRequest ? true : classification.safeToFailover
      });
    } finally {
      await stateLock.release();
    }
    this.eventPipeline.emit({
      type: "CheckpointCreated",
      agentId: adapter.id,
      checkpointId: checkpoint.checkpointId,
      reason
    });

    if (switchRequest) {
      const target = resolveAdapterById?.(switchRequest.targetAdapterId);
      this.eventPipeline.emit({
        type: "SwitchRequested",
        agentId: adapter.id,
        targetAgentId: switchRequest.targetAdapterId
      });
      await clearSwitchRequest(projectRoot);
      await writeSwitchResult(projectRoot, {
        requestId: switchRequest.requestId,
        targetAdapterId: switchRequest.targetAdapterId,
        runtimeId: (await readRuntimeState(projectRoot)).runtimeId,
        status: target ? "ready" : "rejected",
        message: target
          ? "Runtime checkpointed and released for manual switch."
          : `Unknown target adapter: ${switchRequest.targetAdapterId}`
      });
    }

    return {
      classification,
      checkpointId: checkpoint.checkpointId
    };
  }

  private createSwitchMonitor(projectRoot: string) {
    let pending: SwitchRequest | null = null;
    let polling = false;
    const timer = globalThis.setInterval(() => {
      if (polling || pending) return;
      polling = true;
      void readSwitchRequest(projectRoot)
        .then(async (request) => {
          if (!request || pending) return;
          pending = request;
          await appendRuntimeLog(
            projectRoot,
            `Received switch request for ${request.targetAdapterId}.`
          );
          await this.processRunner.terminate("manual switch requested");
        })
        .finally(() => {
          polling = false;
        });
    }, 100);

    return {
      stop: async () => {
        globalThis.clearInterval(timer);
        return pending;
      }
    };
  }

  private async acquireStateUpdateLock(projectRoot: string) {
    const deadline = Date.now() + 35_000;
    for (;;) {
      try {
        return await acquireRuntimeLock(
          projectRoot,
          `continuity-${process.pid}`,
          "continuity-state-update",
          "continuity-state"
        );
      } catch (error) {
        if (!(error instanceof RuntimeLockedError)) {
          throw error;
        }
        if (Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }

  private async captureRepositoryEvidence(projectRoot: string) {
    const [state, snapshot, diff] = await Promise.all([
      this.store.readCurrentState(projectRoot),
      this.inspector.inspect(projectRoot),
      this.inspector.diff(projectRoot)
    ]);

    return this.store.writeCurrentState(
      projectRoot,
      {
        ...state,
        repositoryEvidence: {
          head: snapshot.head,
          branch: snapshot.branch,
          isDirty: snapshot.isDirty,
          statusDigest: createStatusDigest(snapshot),
          diffDigest: createDiffDigest(diff),
          capturedAt: snapshot.capturedAt
        }
      },
      state.revision
    );
  }

  private canFailOver(
    source: AgentAdapter,
    target: AgentAdapter,
    classification: StartSessionResult["classification"]
  ): boolean {
    if (
      classification.kind === "normal_exit" ||
      classification.kind === "user_interrupt" ||
      classification.kind === "unknown"
    ) {
      return false;
    }

    if (classification.kind === "authentication_failure") {
      return this.vendorKey(source.id) !== this.vendorKey(target.id);
    }

    return true;
  }

  private vendorKey(adapterId: string): string {
    if (adapterId === "claude-code") return "anthropic";
    if (adapterId === "codex") return "openai";
    return adapterId;
  }
}

export function createRuntimeSupervisor(processRunner?: ProcessRunner) {
  return new RuntimeSupervisor(processRunner);
}
