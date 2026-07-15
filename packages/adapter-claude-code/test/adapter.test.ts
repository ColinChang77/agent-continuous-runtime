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
});
