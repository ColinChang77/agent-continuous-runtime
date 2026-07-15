import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  runtimeHealthSchemaVersion,
  type AgentHealth,
  type AgentHealthRecord,
  type FailureKind
} from "@acr/core";
import { atomicWriteFile } from "@acr/storage-local";

interface RuntimeHealthFile {
  schemaVersion: string;
  agents: Record<string, AgentHealthRecord>;
}

function acrDir(projectRoot: string): string {
  return path.join(projectRoot, ".acr");
}

function healthPath(projectRoot: string): string {
  return path.join(acrDir(projectRoot), "agent-health.json");
}

export function defaultAgentHealthRecord(agentId: string): AgentHealthRecord {
  return {
    agentId,
    lastSuccessfulLaunchAt: null,
    lastSuccessfulCompletionAt: null,
    lastFailureAt: null,
    lastFailureType: null,
    consecutiveFailures: 0,
    consecutiveUses: 0,
    cooldownStartedAt: null,
    cooldownExpiresAt: null,
    availability: "unknown",
    lastHealthCheck: null,
    recentFailures: []
  };
}

async function readFileState(projectRoot: string): Promise<RuntimeHealthFile> {
  const parsed = JSON.parse(
    await readFile(healthPath(projectRoot), "utf8").catch(() => {
      return JSON.stringify({
        schemaVersion: runtimeHealthSchemaVersion,
        agents: {}
      } satisfies RuntimeHealthFile);
    })
  ) as RuntimeHealthFile;

  if (parsed.schemaVersion !== runtimeHealthSchemaVersion) {
    throw new Error(
      `Unsupported runtime health schema ${parsed.schemaVersion}; expected ${runtimeHealthSchemaVersion}.`
    );
  }

  return parsed;
}

async function writeFileState(
  projectRoot: string,
  state: RuntimeHealthFile
): Promise<void> {
  await mkdir(acrDir(projectRoot), { recursive: true });
  await atomicWriteFile(
    healthPath(projectRoot),
    `${JSON.stringify(state, null, 2)}\n`
  );
}

export class LocalAgentHealthStore {
  async readAll(
    projectRoot: string
  ): Promise<Record<string, AgentHealthRecord>> {
    return (await readFileState(projectRoot)).agents;
  }

  async read(projectRoot: string, agentId: string): Promise<AgentHealthRecord> {
    const state = await readFileState(projectRoot);
    return state.agents[agentId] ?? defaultAgentHealthRecord(agentId);
  }

  async write(
    projectRoot: string,
    agentId: string,
    record: AgentHealthRecord
  ): Promise<AgentHealthRecord> {
    const state = await readFileState(projectRoot);
    state.agents[agentId] = record;
    await writeFileState(projectRoot, state);
    return record;
  }

  async reset(projectRoot: string, agentId?: string): Promise<void> {
    const state = await readFileState(projectRoot);
    if (agentId) {
      delete state.agents[agentId];
    } else {
      state.agents = {};
    }
    await writeFileState(projectRoot, state);
  }

  async markLaunch(
    projectRoot: string,
    agentId: string
  ): Promise<AgentHealthRecord> {
    const current = await this.read(projectRoot, agentId);
    const next = {
      ...current,
      lastSuccessfulLaunchAt: new Date().toISOString(),
      consecutiveUses: current.consecutiveUses + 1,
      availability: "available"
    } satisfies AgentHealthRecord;
    return this.write(projectRoot, agentId, next);
  }

  async markCompletion(
    projectRoot: string,
    agentId: string
  ): Promise<AgentHealthRecord> {
    const current = await this.read(projectRoot, agentId);
    const next = {
      ...current,
      lastSuccessfulCompletionAt: new Date().toISOString(),
      consecutiveFailures: 0,
      cooldownStartedAt: null,
      cooldownExpiresAt: null,
      availability: "available"
    } satisfies AgentHealthRecord;
    return this.write(projectRoot, agentId, next);
  }

  async markFailure(
    projectRoot: string,
    agentId: string,
    failureType: FailureKind,
    cooldownMs: number | null
  ): Promise<AgentHealthRecord> {
    const current = await this.read(projectRoot, agentId);
    const now = new Date();
    const expiresAt =
      typeof cooldownMs === "number" && cooldownMs > 0
        ? new Date(now.getTime() + cooldownMs).toISOString()
        : null;
    const next = {
      ...current,
      lastFailureAt: now.toISOString(),
      lastFailureType: failureType,
      consecutiveFailures: current.consecutiveFailures + 1,
      cooldownStartedAt: expiresAt ? now.toISOString() : null,
      cooldownExpiresAt: expiresAt,
      availability: expiresAt ? "cooldown" : "available",
      recentFailures: [...current.recentFailures, failureType].slice(-10)
    } satisfies AgentHealthRecord;
    return this.write(projectRoot, agentId, next);
  }

  async writeHealthCheck(
    projectRoot: string,
    agentId: string,
    health: AgentHealth
  ): Promise<AgentHealthRecord> {
    const current = await this.read(projectRoot, agentId);
    const next = {
      ...current,
      lastHealthCheck: health,
      availability: health.available
        ? current.cooldownExpiresAt &&
          new Date(current.cooldownExpiresAt).getTime() > Date.now()
          ? "cooldown"
          : "available"
        : "unavailable"
    } satisfies AgentHealthRecord;
    return this.write(projectRoot, agentId, next);
  }
}

export function createAgentHealthStore() {
  return new LocalAgentHealthStore();
}
