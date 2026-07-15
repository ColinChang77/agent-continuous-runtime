import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  atomicWriteFile,
  createLocalStore,
  RevisionConflictError
} from "../src/index.js";

async function createTempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "acr-store-test-"));
}

describe("LocalContinuityStore", () => {
  it("initializes the continuity layout idempotently", async () => {
    const projectRoot = await createTempProject();
    const store = createLocalStore();

    const first = await store.initialize(projectRoot);
    const second = await store.initialize(projectRoot);

    expect(first.created).toContain(".agent/CURRENT_STATE.json");
    expect(second.created).not.toContain(".agent/CURRENT_STATE.json");
    expect(second.modified).not.toContain("AGENTS.md");
  });

  it("preserves existing instruction content while managing the bounded block", async () => {
    const projectRoot = await createTempProject();
    const agentsPath = path.join(projectRoot, "AGENTS.md");

    await writeFile(agentsPath, "# Custom\n\nKeep this content.\n", "utf8");

    const store = createLocalStore();
    await store.initialize(projectRoot);

    const content = await readFile(agentsPath, "utf8");

    expect(content).toContain("# Custom");
    expect(content).toContain("Keep this content.");
    expect(content).toContain("<!-- ACR:BEGIN -->");
    expect(content.match(/<!-- ACR:BEGIN -->/g)).toHaveLength(1);
  });

  it("rejects stale state revisions", async () => {
    const projectRoot = await createTempProject();
    const store = createLocalStore();

    await store.initialize(projectRoot);
    const current = await store.readCurrentState(projectRoot);
    await store.writeCurrentState(projectRoot, current, current.revision);

    await expect(
      store.writeCurrentState(projectRoot, current, current.revision)
    ).rejects.toBeInstanceOf(RevisionConflictError);
  });

  it("preserves the previous file when atomic write fails before rename", async () => {
    const projectRoot = await createTempProject();
    const targetPath = path.join(projectRoot, "state.json");

    await writeFile(targetPath, '{"ok":true}\n', "utf8");

    await expect(
      atomicWriteFile(targetPath, '{"ok":false}\n', {
        writeImpl: async () => {
          throw new Error("simulated write failure");
        }
      })
    ).rejects.toThrow("simulated write failure");

    expect(await readFile(targetPath, "utf8")).toBe('{"ok":true}\n');
  });

  it("creates valid checkpoint manifests", async () => {
    const projectRoot = await createTempProject();
    const store = createLocalStore();

    await store.initialize(projectRoot);
    const current = await store.readCurrentState(projectRoot);
    const checkpoint = await store.createCheckpoint(projectRoot, {
      checkpointId: "checkpoint-1",
      reason: "test",
      summary: "Checkpoint summary",
      handoff: "Continue from the next step.",
      currentState: current,
      safeToResume: true,
      parentCheckpointId: null
    });

    const manifest = JSON.parse(
      await readFile(
        path.join(projectRoot, ".agent/checkpoints/checkpoint-1/manifest.json"),
        "utf8"
      )
    ) as { checkpointId: string; reason: string };

    expect(checkpoint.checkpointId).toBe("checkpoint-1");
    expect(manifest).toMatchObject({
      checkpointId: "checkpoint-1",
      reason: "test"
    });
  });
});
