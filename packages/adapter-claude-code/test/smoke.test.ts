import { describe, expect, it } from "vitest";

import { createClaudeCodeAdapter } from "../src/index.js";

const runSmoke = process.env.ACR_RUN_REAL_SMOKE === "1";

describe.skipIf(!runSmoke)("ClaudeCodeAdapter smoke", () => {
  it("detects the installed Claude Code binary", async () => {
    const adapter = createClaudeCodeAdapter();
    const installation = await adapter.detectInstallation();

    expect(installation.installed).toBe(true);
    expect(installation.executablePath).toBeTruthy();
  });
});
