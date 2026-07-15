import { describe, expect, it } from "vitest";

import { createGeminiAdapter } from "../src/index.js";

const runSmoke = process.env.ACR_RUN_REAL_SMOKE === "1";

describe.skipIf(!runSmoke)("GeminiAdapter smoke", () => {
  it("detects the installed Gemini binary", async () => {
    const adapter = createGeminiAdapter();
    const installation = await adapter.detectInstallation();

    expect(installation.installed).toBe(true);
    expect(installation.executablePath).toBeTruthy();
  });
});
