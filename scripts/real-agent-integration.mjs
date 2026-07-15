import { createClaudeCodeAdapter } from "../packages/adapter-claude-code/dist/index.js";
import { createCodexAdapter } from "../packages/adapter-codex/dist/index.js";
import { createGeminiAdapter } from "../packages/adapter-gemini/dist/index.js";

async function detectCommand(command) {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    await execFileAsync(command, ["--version"], { encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

async function run() {
  const detections = {
    claude: await detectCommand("claude"),
    codex: await detectCommand("codex"),
    gemini: await detectCommand("gemini"),
    cursor: await detectCommand("cursor")
  };

  const results = [];

  if (detections.claude) {
    const adapter = createClaudeCodeAdapter();
    const installation = await adapter.detectInstallation();
    results.push({
      agent: "claude-code",
      status: installation.installed ? "verified" : "failed",
      details: installation.details ?? null
    });
  } else {
    results.push({
      agent: "claude-code",
      status: "skipped",
      details: "claude not installed locally"
    });
  }

  if (detections.codex) {
    const adapter = createCodexAdapter();
    const installation = await adapter.detectInstallation();
    results.push({
      agent: "codex",
      status: installation.installed ? "verified" : "failed",
      details: installation.details ?? null
    });
  } else {
    results.push({
      agent: "codex",
      status: "skipped",
      details: "codex not installed locally"
    });
  }

  if (detections.gemini) {
    const adapter = createGeminiAdapter();
    const installation = await adapter.detectInstallation();
    results.push({
      agent: "gemini",
      status: installation.installed ? "verified" : "failed",
      details: installation.details ?? null
    });
  } else {
    results.push({
      agent: "gemini",
      status: "skipped",
      details: "gemini not installed locally"
    });
  }

  for (const agent of ["cursor"]) {
    results.push({
      agent,
      status: detections[agent] ? "skipped" : "skipped",
      details: detections[agent]
        ? `${agent} detected, but no bundled adapter is registered. Use ACR_AGENT_PLUGINS to load a plugin.`
        : `${agent} not installed locally`
    });
  }

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

await run();
