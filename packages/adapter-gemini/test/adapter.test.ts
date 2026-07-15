import { describe, expect, it } from "vitest";

import { createGeminiAdapter } from "../src/index.js";

describe("GeminiAdapter", () => {
  it("builds a launch spec with interactive resume injection", async () => {
    const adapter = createGeminiAdapter();
    const spec = await adapter.buildLaunchSpec({
      projectRoot: "/tmp/project",
      resumeInstruction: "Resume here."
    });

    expect(spec.command).toBe("gemini");
    expect(spec.cwd).toBe("/tmp/project");
    expect(spec.args).toEqual([
      "--prompt-interactive",
      "Resume here.",
      "--skip-trust"
    ]);
  });

  it("classifies quota evidence conservatively", async () => {
    const adapter = createGeminiAdapter();
    const classification = await adapter.classifyTermination({
      exitCode: 1,
      signal: null,
      output: "429 RESOURCE_EXHAUSTED quota exceeded"
    });

    expect(classification.kind).toBe("usage_limit");
    expect(classification.safeToFailover).toBe(true);
  });

  it("classifies auth and network signals without guessing context limits", async () => {
    const adapter = createGeminiAdapter();
    const auth = await adapter.classifyTermination({
      exitCode: 1,
      signal: null,
      output: "Unauthorized: please login again"
    });
    const network = await adapter.classifyTermination({
      exitCode: 1,
      signal: null,
      output: "network timeout contacting endpoint"
    });

    expect(auth.kind).toBe("authentication_failure");
    expect(network.kind).toBe("network_failure");
  });
});
