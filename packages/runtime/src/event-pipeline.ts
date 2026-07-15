import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  eventSchemaVersion,
  type RuntimeEvent,
  type RuntimeEventInput,
  type RuntimeEventPipeline,
  type RuntimeSessionContext
} from "@acr/core";
import { atomicWriteFile } from "@acr/storage-local";

const redactionPatterns = [
  /\b(sk-[A-Za-z0-9_-]{10,})\b/g,
  /\b(AIza[0-9A-Za-z_-]{16,})\b/g,
  /\b([A-Z0-9_]*(TOKEN|API_KEY|SECRET)[A-Z0-9_]*=)([^\s]+)/gi,
  /\b(Bearer\s+)([A-Za-z0-9._-]+)/gi
];

function redactText(input: string): string {
  return redactionPatterns.reduce((value, pattern) => {
    return value.replace(pattern, (_match, prefix = "") => {
      return `${prefix}[REDACTED]`;
    });
  }, input);
}

function redactEvent(event: RuntimeEvent): RuntimeEvent {
  if (event.type === "AgentOutput") {
    return {
      ...event,
      text: redactText(event.text)
    };
  }

  if (
    event.type === "UsageLimitDetected" ||
    event.type === "ContextLimitDetected" ||
    event.type === "AuthenticationFailure" ||
    event.type === "NetworkFailure" ||
    event.type === "UnknownFailure"
  ) {
    return {
      ...event,
      evidence: event.evidence.map(redactText)
    };
  }

  if (
    event.type === "PluginDiscovered" ||
    event.type === "PluginLoaded" ||
    event.type === "PluginRejected" ||
    event.type === "PluginInitializationFailure"
  ) {
    return {
      ...event,
      message: redactText(event.message)
    };
  }

  if (event.type === "AgentWarning") {
    return {
      ...event,
      message: redactText(event.message)
    };
  }

  return event;
}

function acrDir(projectRoot: string): string {
  return path.join(projectRoot, ".acr");
}

function eventLogPath(projectRoot: string, sessionId: string): string {
  return path.join(acrDir(projectRoot), "events", `${sessionId}.jsonl`);
}

export interface EventPipelineOptions {
  maxEvents?: number;
  sessionId?: string;
  runId?: string;
  projectRoot?: string;
  persist?: boolean;
}

export class InMemoryRuntimeEventPipeline implements RuntimeEventPipeline {
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private readonly events: RuntimeEvent[] = [];
  private readonly maxEvents: number;
  private sequence = 0;
  private readonly session: RuntimeSessionContext;
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: EventPipelineOptions = {}) {
    this.maxEvents = options.maxEvents ?? 256;
    this.session = {
      sessionId: options.sessionId ?? `session-${Date.now().toString(36)}`,
      runId: options.runId ?? `run-${Date.now().toString(36)}`
    };
  }

  emit(
    event: RuntimeEventInput,
    context?: Partial<RuntimeSessionContext>
  ): RuntimeEvent {
    const normalized = redactEvent({
      ...event,
      sequence: ++this.sequence,
      timestamp: new Date().toISOString(),
      sessionId: context?.sessionId ?? this.session.sessionId,
      runId: context?.runId ?? this.session.runId,
      schemaVersion: eventSchemaVersion
    } as RuntimeEvent);

    this.events.push(normalized);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }

    this.persistQueue = this.persistQueue
      .then(() => this.persist(normalized))
      .catch(() => undefined);

    for (const listener of this.listeners) {
      try {
        listener(normalized);
      } catch {
        // Subscriber isolation is required; errors are intentionally swallowed.
      }
    }

    return normalized;
  }

  list(): RuntimeEvent[] {
    return [...this.events];
  }

  replay(): RuntimeEvent[] {
    return this.list();
  }

  serialize(event: RuntimeEvent): string {
    return JSON.stringify(redactEvent(event));
  }

  clear(): void {
    this.events.length = 0;
    this.sequence = 0;
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async persist(event: RuntimeEvent): Promise<void> {
    if (!this.options.persist || !this.options.projectRoot) {
      return;
    }

    const filePath = eventLogPath(
      this.options.projectRoot,
      this.session.sessionId
    );
    await mkdir(path.dirname(filePath), { recursive: true });
    const previous = await readFile(filePath, "utf8").catch(() => "");
    await atomicWriteFile(filePath, `${previous}${this.serialize(event)}\n`);
  }
}

export function createRuntimeEventPipeline(options?: EventPipelineOptions) {
  return new InMemoryRuntimeEventPipeline(options);
}
