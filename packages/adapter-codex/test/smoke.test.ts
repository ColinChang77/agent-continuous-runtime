import { describe, expect, it } from "vitest";

import { createCodexAdapter } from "../src/index.js";

const runSmoke = process.env.ACR_RUN_REAL_SMOKE === "1";

describe.skipIf(!runSmoke)("CodexAdapter smoke", () => {
  it("detects the installed Codex binary", async () => {
    const adapter = createCodexAdapter();
    const installation = await adapter.detectInstallation();

    expect(installation.installed).toBe(true);
    expect(installation.executablePath).toBeTruthy();
  });
});
