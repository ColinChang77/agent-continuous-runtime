import { describe, expect, it } from "vitest";

import { createCodexAdapter } from "../src/index.js";

describe("CodexAdapter", () => {
  it("builds a launch spec in the target project root", async () => {
    const adapter = createCodexAdapter();
    const spec = await adapter.buildLaunchSpec({
      projectRoot: "/tmp/project",
      resumeInstruction: "Resume here."
    });

    expect(spec.command).toBe("codex");
    expect(spec.cwd).toBe("/tmp/project");
    expect(spec.args).toContain("Resume here.");
  });

  it("classifies usage-limit evidence conservatively", async () => {
    const adapter = createCodexAdapter();
    const classification = await adapter.classifyTermination({
      exitCode: 1,
      signal: null,
      output: "Rate limit reached due to quota exhaustion"
    });

    expect(classification.kind).toBe("usage_limit");
    expect(classification.safeToFailover).toBe(true);
  });

  it("declares direct repository guidance rather than runtime-required MCP", () => {
    const adapter = createCodexAdapter();
    expect(adapter.capabilities().usesMcp).toBe(false);
  });

  it("defaults to the codex id and display name", () => {
    const adapter = createCodexAdapter();
    expect(adapter.id).toBe("codex");
    expect(adapter.displayName).toBe("Codex");
  });

  it("supports an alternate account via a custom id and env overrides", async () => {
    const adapter = createCodexAdapter({
      id: "codex-alt",
      displayName: "Codex (Alt Account)",
      envOverrides: {
        CODEX_HOME: "/tmp/alt-codex",
        OPENAI_API_KEY: "sk-alt",
        // undefined values must be ignored, not injected into the launch env
        ACR_ALT_UNSET: undefined
      }
    });

    expect(adapter.id).toBe("codex-alt");

    const spec = await adapter.buildLaunchSpec({
      projectRoot: "/tmp/project",
      resumeInstruction: "Resume here."
    });

    expect(spec.command).toBe("codex");
    expect(spec.env?.CODEX_HOME).toBe("/tmp/alt-codex");
    expect(spec.env?.OPENAI_API_KEY).toBe("sk-alt");
    expect(spec.env).not.toHaveProperty("ACR_ALT_UNSET");
  });
});
