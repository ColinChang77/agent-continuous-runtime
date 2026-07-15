import path from "node:path";

export const documentNames = [
  "PROJECT_CONTEXT.md",
  "TASKS.md",
  "DECISIONS.md",
  "RECENT_CONTEXT.md",
  "PROGRESS.md"
] as const;

export function agentDir(projectRoot: string): string {
  return path.join(projectRoot, ".agent");
}

export function acrDir(projectRoot: string): string {
  return path.join(projectRoot, ".acr");
}

export function currentStatePath(projectRoot: string): string {
  return path.join(agentDir(projectRoot), "CURRENT_STATE.json");
}

export function runtimeStatePath(projectRoot: string): string {
  return path.join(acrDir(projectRoot), "runtime.json");
}

export function checkpointsDir(projectRoot: string): string {
  return path.join(agentDir(projectRoot), "checkpoints");
}

export function locksDir(projectRoot: string): string {
  return path.join(agentDir(projectRoot), "locks");
}
