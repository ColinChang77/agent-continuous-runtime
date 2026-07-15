import type { AgentAdapter } from "../ports/interfaces.js";
import type {
  FailureClassification,
  FailureKind,
  InstallationStatus
} from "./resume-types.js";

export const runtimeVersion = "2.0.0";
export const pluginApiVersion = "2.0.0";
export const eventSchemaVersion = "2.0.0";
export const runtimeHealthSchemaVersion = "2.0.0";

export type TransportMode = "pty" | "stdio" | "spawn";

export type AgentAvailability =
  "available" | "unavailable" | "cooldown" | "unknown";

export type AgentHealthStatus =
  "healthy" | "degraded" | "unavailable" | "cooldown" | "unknown";

export interface AgentHealth {
  status: AgentHealthStatus;
  available: boolean;
  checkedAt: string;
  message?: string;
  cooldownUntil?: string | null;
}

export interface AgentHealthRecord {
  agentId: string;
  lastSuccessfulLaunchAt: string | null;
  lastSuccessfulCompletionAt: string | null;
  lastFailureAt: string | null;
  lastFailureType: FailureKind | null;
  consecutiveFailures: number;
  consecutiveUses: number;
  cooldownStartedAt: string | null;
  cooldownExpiresAt: string | null;
  availability: AgentAvailability;
  lastHealthCheck: AgentHealth | null;
  recentFailures: FailureKind[];
}

export interface RuntimeSessionContext {
  sessionId: string;
  runId: string;
}

export interface EventEnvelope {
  sequence: number;
  timestamp: string;
  sessionId: string;
  runId: string;
  agentId: string | null;
  schemaVersion: string;
}

export interface SchedulingDecision {
  selectedAgentId: string | null;
  eligibleCandidates: string[];
  excludedCandidates: Array<{
    agentId: string;
    reasons: string[];
  }>;
  policy: string;
  timestamp: string;
}

export type RuntimeEventInput =
  | {
      type: "AgentStarted";
      agentId: string;
      transport: TransportMode;
      pid: number | null;
    }
  | {
      type: "AgentOutput";
      agentId: string;
      stream: "stdout" | "stderr";
      text: string;
    }
  | {
      type: "AgentWarning";
      agentId: string;
      message: string;
    }
  | {
      type:
        | "UsageLimitDetected"
        | "ContextLimitDetected"
        | "AuthenticationFailure"
        | "NetworkFailure"
        | "UnknownFailure";
      agentId: string;
      evidence: string[];
      confidence: FailureClassification["confidence"];
      failoverAppropriate: boolean;
      retryable: boolean;
      cooldownMs: number | null;
    }
  | {
      type: "AgentExited";
      agentId: string;
      exitCode: number | null;
      signal: string | null;
    }
  | {
      type: "CheckpointCreated";
      agentId: string;
      checkpointId: string;
      reason: string;
    }
  | {
      type: "ResumeStarted" | "ResumeFinished";
      agentId: string;
    }
  | {
      type: "SwitchRequested";
      agentId: string;
      targetAgentId: string;
    }
  | {
      type: "TransportSelected";
      agentId: string;
      transport: TransportMode;
    }
  | {
      type: "SchedulerDecision";
      agentId: string | null;
      decision: SchedulingDecision;
    }
  | {
      type:
        | "PluginDiscovered"
        | "PluginLoaded"
        | "PluginRejected"
        | "PluginInitializationFailure";
      agentId: string | null;
      pluginId: string;
      pluginSource: string;
      message: string;
    };

export type RuntimeEvent = RuntimeEventInput & EventEnvelope;

export interface RuntimeEventPipeline {
  emit(
    event: RuntimeEventInput,
    context?: Partial<RuntimeSessionContext>
  ): RuntimeEvent;
  list(): RuntimeEvent[];
  replay(): RuntimeEvent[];
  serialize(event: RuntimeEvent): string;
  clear(): void;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
}

export interface FailureClassifierInput {
  agent: AgentAdapter;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut?: boolean;
  transportError?: string | null;
  structuredEvents?: Array<{
    type: string;
    message?: string;
  }>;
  events: RuntimeEvent[];
}

export interface FailureClassifier {
  classify(input: FailureClassifierInput): Promise<FailureClassification>;
}

export type ConfigSchemaPropertyType =
  "string" | "number" | "boolean" | "array" | "object";

export interface AdapterConfigurationProperty {
  type: ConfigSchemaPropertyType;
  description?: string;
  items?: AdapterConfigurationProperty;
  properties?: Record<string, AdapterConfigurationProperty>;
}

export interface AdapterConfigurationSchema {
  type: "object";
  properties: Record<string, AdapterConfigurationProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ExecutableDetectionSpec {
  command: string;
  args?: string[];
}

export interface AgentPluginManifest {
  pluginId: string;
  displayName: string;
  version: string;
  acrApiVersion: string;
  agentId: string;
  agentDisplayName: string;
  declaredCapabilities: string[];
  supportedTransports: TransportMode[];
  executable: ExecutableDetectionSpec;
  configurationSchema?: AdapterConfigurationSchema;
}

export interface AgentPluginContext {
  config?: unknown;
}

export interface AgentPlugin {
  manifest: AgentPluginManifest;
  createAdapter(context?: AgentPluginContext): AgentAdapter;
  healthCheck?(adapter: AgentAdapter): Promise<AgentHealth>;
  source?: string;
}

export interface RegisteredAgent {
  id: string;
  displayName: string;
  adapter: AgentAdapter;
  plugin: AgentPlugin;
  installation: InstallationStatus;
  metadata: {
    priority: number;
    health: AgentHealthStatus;
    costTier: "low" | "medium" | "high";
    vendor: string;
    capabilities: string[];
    transportPreferences: TransportMode[];
  };
  health: AgentHealthRecord | null;
}

export interface AgentRegistry {
  register(
    plugin: AgentPlugin,
    config?: unknown
  ): Promise<RegisteredAgent | null>;
  get(id: string): RegisteredAgent | undefined;
  list(): RegisteredAgent[];
}

export interface SchedulerRequest {
  preferredAgentId?: string;
  allowedAgentIds?: string[];
  deniedAgentIds?: string[];
  currentAgentId?: string;
  excludedAgentIds?: string[];
  requiredCapabilities?: string[];
  preferredTransport?: TransportMode;
  maxConsecutiveUses?: number;
  explicitReuseFailedAgent?: boolean;
}

export interface AgentScheduler {
  decide(
    request: SchedulerRequest,
    candidates: RegisteredAgent[]
  ): SchedulingDecision;
  selectPrimary(
    request: SchedulerRequest,
    candidates: RegisteredAgent[]
  ): RegisteredAgent | undefined;
  selectNext(
    request: SchedulerRequest,
    candidates: RegisteredAgent[]
  ): RegisteredAgent | undefined;
}

export interface RuntimeLauncher {
  registry(): AgentRegistry;
  scheduler(): AgentScheduler;
}
