import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClaudeCodeAdapter } from "../packages/adapter-claude-code/dist/index.js";
import { createCodexAdapter } from "../packages/adapter-codex/dist/index.js";
import { createGeminiAdapter } from "../packages/adapter-gemini/dist/index.js";
import { createLocalStore } from "../packages/storage-local/dist/index.js";

async function createTempProject() {
  return mkdtemp(path.join(os.tmpdir(), "acr-real-failover-"));
}

async function inspectAdapter(adapter) {
  const installation = await adapter.detectInstallation();
  if (!installation.installed) {
    return {
      agent: adapter.id,
      status: "skipped",
      verificationLevel: "not-installed",
      details: installation.details ?? `${adapter.id} not installed`
    };
  }

  const projectRoot = await createTempProject();
  try {
    await createLocalStore().initialize(projectRoot);
    const resumeInstruction = await adapter.buildResumeInstruction({
      brief: {
        drift: "none",
        summary: "Resume from deterministic test handoff.",
        nextAction: "Verify resume context delivery only.",
        changedFiles: [],
        warnings: [],
        repository: {
          projectRoot,
          isGitRepository: false,
          head: null,
          branch: null,
          isDirty: false,
          stagedPaths: [],
          unstagedPaths: [],
          untrackedPaths: [],
          statusText: "",
          diffStat: "",
          capturedAt: new Date().toISOString()
        }
      }
    });
    const launchSpec = await adapter.buildLaunchSpec({
      projectRoot,
      resumeInstruction
    });

    return {
      agent: adapter.id,
      status: "partial",
      verificationLevel: "command-construction-only",
      details:
        "Real CLI detected. Resume prompt construction verified locally; live agent launch and end-to-end replacement remain opt-in and are not exercised by this harness.",
      command: launchSpec.command,
      argsPreview: launchSpec.args.slice(0, 3)
    };
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

async function run() {
  const results = await Promise.all([
    inspectAdapter(createClaudeCodeAdapter()),
    inspectAdapter(createCodexAdapter()),
    inspectAdapter(createGeminiAdapter())
  ]);

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

await run();
