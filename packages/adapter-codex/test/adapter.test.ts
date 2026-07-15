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
});
