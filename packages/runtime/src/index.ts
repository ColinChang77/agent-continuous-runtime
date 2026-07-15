import type { AgentAdapterDescriptor } from "@acr/core";

export function createRuntimeBanner(adapter: AgentAdapterDescriptor): string {
  return `ACR runtime prepared for ${adapter.displayName} (${adapter.id})`;
}

export * from "./repository-inspector.js";
export * from "./conversation-memory.js";
export * from "./resume-engine.js";
export * from "./event-pipeline.js";
export * from "./failure-classifier.js";
export * from "./agent-registry.js";
export * from "./health-store.js";
export * from "./scheduler.js";
export * from "./launcher.js";
export * from "./process-runner.js";
export * from "./transport-strategy.js";
export * from "./runtime-lock.js";
export * from "./runtime-state.js";
export * from "./supervisor.js";
