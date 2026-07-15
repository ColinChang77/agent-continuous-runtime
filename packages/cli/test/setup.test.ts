import { Readable } from "node:stream";
import type { Writable } from "node:stream";
import { setImmediate } from "node:timers";
import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runSetup } from "../src/index.js";
import { accountEnvOverrides, loadAcrConfig } from "../src/config.js";

async function tempHome(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "acr-setup-test-"));
}

/**
 * Drive the wizard by answering each prompt only after it is printed. readline
 * drops lines that arrive before `question()` is awaited, so answers must be
 * pushed reactively when the prompt (a line ending in ": ") appears.
 */
function scriptedIo(answers: string[]): { input: Readable; output: Writable } {
  const input = new Readable({ read() {} });
  let index = 0;
  const output = {
    write(chunk: string | Uint8Array): boolean {
      const text = String(chunk);
      if (text.trimEnd().endsWith(":")) {
        const answer = answers[index++] ?? "";
        setImmediate(() => input.push(`${answer}\n`));
      }
      return true;
    }
  } as unknown as Writable;
  return { input, output };
}

describe("acr setup wizard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("saves primary + the other tool as fallback", async () => {
    const home = await tempHome();
    vi.stubEnv("HOME", home);

    // primary = 2 (Codex), fallback mode = 2 (other tool -> claude-code)
    const { input, output } = scriptedIo(["2", "2"]);
    await runSetup(input, output);

    const config = loadAcrConfig();
    expect(config.primary).toBe("codex");
    expect(config.fallback).toBe("claude-code");
    expect(config.accounts).toBeUndefined();
  });

  it("saves a second-account fallback with a created home directory", async () => {
    const home = await tempHome();
    vi.stubEnv("HOME", home);
    const accountHome = path.join(home, "claude-account-b");

    // primary = 1 (Claude), mode = 1 (second account), home path, login = n
    const { input, output } = scriptedIo(["1", "1", accountHome, "n"]);
    await runSetup(input, output);

    const config = loadAcrConfig();
    expect(config.primary).toBe("claude-code");
    expect(config.fallback).toBe("claude-code-alt");
    expect(config.accounts?.["claude-code-alt"]?.home).toBe(accountHome);

    // the account home directory must have been created
    expect((await stat(accountHome)).isDirectory()).toBe(true);
  });
});

describe("accountEnvOverrides", () => {
  it("prefers env vars over saved config", () => {
    const env = accountEnvOverrides(
      { home: "/saved/home", apiKey: "saved-key" },
      "/env/home",
      undefined,
      undefined,
      "HOME",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_BASE_URL"
    );
    expect(env.HOME).toBe("/env/home");
    // no env override -> falls back to saved key
    expect(env.ANTHROPIC_API_KEY).toBe("saved-key");
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
  });
});
