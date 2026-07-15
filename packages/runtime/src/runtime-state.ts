import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  runtimeStateSchema,
  schemaVersion,
  type RuntimeState
} from "@acr/core";
import { atomicWriteFile } from "@acr/storage-local";

function nowIso(): string {
  return new Date().toISOString();
}

function acrDir(projectRoot: string): string {
  return path.join(projectRoot, ".acr");
}

function sessionsDir(projectRoot: string): string {
  return path.join(acrDir(projectRoot), "sessions");
}

function runtimeStatePath(projectRoot: string): string {
  return path.join(acrDir(projectRoot), "runtime.json");
}

function runtimeLogPath(projectRoot: string): string {
  return path.join(acrDir(projectRoot), "runtime.log");
}

function failoverLogPath(projectRoot: string): string {
  return path.join(acrDir(projectRoot), "failover.log");
}

function switchRequestPath(projectRoot: string): string {
  return path.join(sessionsDir(projectRoot), "switch-request.json");
}

function switchResultPath(projectRoot: string): string {
  return path.join(sessionsDir(projectRoot), "switch-result.json");
}

async function readOptionalJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

export interface SwitchRequest {
  requestId: string;
  targetAdapterId: string;
  requestedAt: string;
  requesterPid: number;
}

export interface SwitchResult {
  requestId: string;
  targetAdapterId: string;
  runtimeId: string;
  status: "ready" | "rejected";
  message: string;
  createdAt: string;
}

export async function readRuntimeState(
  projectRoot: string
): Promise<RuntimeState> {
  return runtimeStateSchema.parse(
    JSON.parse(await readFile(runtimeStatePath(projectRoot), "utf8"))
  );
}

export async function writeRuntimeState(
  projectRoot: string,
  state: RuntimeState
): Promise<RuntimeState> {
  const parsed = runtimeStateSchema.parse(state);
  await mkdir(acrDir(projectRoot), { recursive: true });
  await atomicWriteFile(
    runtimeStatePath(projectRoot),
    `${JSON.stringify(parsed, null, 2)}\n`
  );
  return parsed;
}

export async function patchRuntimeState(
  projectRoot: string,
  mutate: (current: RuntimeState) => RuntimeState
): Promise<RuntimeState> {
  const current = await readRuntimeState(projectRoot);
  return writeRuntimeState(projectRoot, mutate(current));
}

export async function appendRuntimeLog(
  projectRoot: string,
  message: string,
  kind: "runtime" | "failover" = "runtime"
): Promise<void> {
  const logPath =
    kind === "failover"
      ? failoverLogPath(projectRoot)
      : runtimeLogPath(projectRoot);
  const previous = await readFile(logPath, "utf8").catch(() => "");
  await atomicWriteFile(logPath, `${previous}[${nowIso()}] ${message}\n`);
}

export async function writeSwitchRequest(
  projectRoot: string,
  request: SwitchRequest
): Promise<void> {
  await mkdir(sessionsDir(projectRoot), { recursive: true });
  await atomicWriteFile(
    switchRequestPath(projectRoot),
    `${JSON.stringify(request, null, 2)}\n`
  );
  await rm(switchResultPath(projectRoot), { force: true });
}

export async function readSwitchRequest(
  projectRoot: string
): Promise<SwitchRequest | null> {
  return readOptionalJson<SwitchRequest>(switchRequestPath(projectRoot));
}

export async function clearSwitchRequest(projectRoot: string): Promise<void> {
  await rm(switchRequestPath(projectRoot), { force: true });
}

export async function writeSwitchResult(
  projectRoot: string,
  input: Omit<SwitchResult, "createdAt">
): Promise<void> {
  await mkdir(sessionsDir(projectRoot), { recursive: true });
  const result = {
    ...input,
    createdAt: nowIso()
  } satisfies SwitchResult;
  await atomicWriteFile(
    switchResultPath(projectRoot),
    `${JSON.stringify(result, null, 2)}\n`
  );
}

export async function readSwitchResult(
  projectRoot: string
): Promise<SwitchResult | null> {
  return readOptionalJson<SwitchResult>(switchResultPath(projectRoot));
}

export async function clearSwitchResult(projectRoot: string): Promise<void> {
  await rm(switchResultPath(projectRoot), { force: true });
}

export function defaultRuntimeState(
  projectRoot: string,
  fallbackOrder = ["codex"]
): RuntimeState {
  return runtimeStateSchema.parse({
    schemaVersion,
    runtimeId: `runtime-${Date.now().toString(36)}`,
    projectRoot,
    status: "idle",
    activeAgent: null,
    fallbackOrder,
    startedAt: null,
    lastHeartbeatAt: null,
    mcp: {
      transport: "stdio",
      status: "stopped"
    },
    failover: {
      attempt: 0,
      maxAttempts: 2,
      lastReason: null
    }
  });
}
