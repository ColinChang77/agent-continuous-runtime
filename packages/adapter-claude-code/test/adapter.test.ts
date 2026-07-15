import { describe, expect, it } from "vitest";

import { createClaudeCodeAdapter } from "../src/index.js";

describe("ClaudeCodeAdapter", () => {
  it("builds a launch spec in the target project root", async () => {
    const adapter = createClaudeCodeAdapter();
    const spec = await adapter.buildLaunchSpec({
      projectRoot: "/tmp/project",
      resumeInstruction: "Resume here."
    });

    expect(spec.command).toBe("claude");
    expect(spec.cwd).toBe("/tmp/project");
    expect(spec.args).toContain("Resume here.");
  });

  it("classifies authentication evidence conservatively", async () => {
    const adapter = createClaudeCodeAdapter();
    const classification = await adapter.classifyTermination({
      exitCode: 1,
      signal: null,
      output: "Authentication token expired. Please login again."
    });

    expect(classification.kind).toBe("authentication_failure");
    expect(classification.safeToFailover).toBe(true);
  });

  it("declares direct repository guidance rather than runtime-required MCP", () => {
    const adapter = createClaudeCodeAdapter();
    expect(adapter.capabilities().usesMcp).toBe(false);
  });

  it("defaults to the claude-code id and display name", () => {
    const adapter = createClaudeCodeAdapter();
    expect(adapter.id).toBe("claude-code");
    expect(adapter.displayName).toBe("Claude Code");
  });

  it("supports an alternate account via a custom id and env overrides", async () => {
    const adapter = createClaudeCodeAdapter({
      id: "claude-code-alt",
      displayName: "Claude Code (Alt Account)",
      envOverrides: {
        HOME: "/tmp/alt-home",
        ANTHROPIC_API_KEY: "sk-alt",
        // undefined values must be ignored, not injected into the launch env
        ACR_ALT_UNSET: undefined
      }
    });

    expect(adapter.id).toBe("claude-code-alt");

    const spec = await adapter.buildLaunchSpec({
      projectRoot: "/tmp/project",
      resumeInstruction: "Resume here."
    });

    expect(spec.command).toBe("claude");
    expect(spec.env?.HOME).toBe("/tmp/alt-home");
    expect(spec.env?.ANTHROPIC_API_KEY).toBe("sk-alt");
    expect(spec.env).not.toHaveProperty("ACR_ALT_UNSET");
  });
});
