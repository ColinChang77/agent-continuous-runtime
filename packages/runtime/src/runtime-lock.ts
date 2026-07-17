import { mkdir, open, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { atomicWriteFile } from "@acr/storage-local";

export interface RuntimeLockHandle {
  path: string;
  release(): Promise<void>;
}

const STALE_LOCK_THRESHOLD_MS = 30_000;

export class RuntimeLockedError extends Error {
  constructor(
    readonly lockPath: string,
    readonly owner?: Record<string, unknown>
  ) {
    super(`Runtime lock already exists: ${lockPath}`);
    this.name = "RuntimeLockedError";
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

async function readLockOwner(
  lockPath: string
): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(lockPath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isStaleOwner(owner: Record<string, unknown> | undefined): boolean {
  if (!owner) return false;
  const hostname = typeof owner.hostname === "string" ? owner.hostname : null;
  const createdAt =
    typeof owner.createdAt === "string" ? Date.parse(owner.createdAt) : NaN;
  const pid = typeof owner.pid === "number" ? owner.pid : null;

  if (hostname && hostname !== os.hostname()) {
    return false;
  }

  if (pid !== null && processExists(pid)) {
    return false;
  }

  return Number.isFinite(createdAt)
    ? Date.now() - createdAt >= STALE_LOCK_THRESHOLD_MS
    : true;
}

export async function acquireRuntimeLock(
  projectRoot: string,
  runtimeId = `runtime-${process.pid}`,
  purpose = "runtime-supervision",
  lockName = "runtime"
): Promise<RuntimeLockHandle> {
  if (!/^[a-zA-Z0-9_-]+$/.test(lockName)) {
    throw new Error(`Invalid runtime lock name: ${lockName}`);
  }
  const lockDir = path.join(projectRoot, ".acr", "locks");
  await mkdir(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, `${lockName}.lock.json`);

  try {
    const file = await open(lockPath, "wx");
    await file.close();
  } catch {
    const owner = await readLockOwner(lockPath);
    if (isStaleOwner(owner)) {
      await rm(lockPath, { force: true });
      const file = await open(lockPath, "wx");
      await file.close();
    } else {
      throw new RuntimeLockedError(lockPath, owner);
    }
  }

  await atomicWriteFile(
    lockPath,
    `${JSON.stringify(
      {
        pid: process.pid,
        hostname: os.hostname(),
        runtimeId,
        purpose,
        createdAt: nowIso(),
        heartbeatAt: nowIso()
      },
      null,
      2
    )}\n`
  );

  return {
    path: lockPath,
    async release() {
      await rm(lockPath, { force: true });
    }
  };
}
