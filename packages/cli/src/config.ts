import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Per-account settings for an alternate adapter. `home` maps to HOME for Claude
 * and CODEX_HOME for Codex (the directory that holds that account's login).
 */
export interface AcrAccountConfig {
  home?: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * User-level ACR configuration, written by `acr setup` and read on every run so
 * the everyday command can be a bare `acr start .` with no flags.
 */
export interface AcrConfig {
  /** Default primary adapter id, e.g. "claude-code" or "codex". */
  primary?: string;
  /** Default fallback adapter id, e.g. "claude-code-alt" or "codex". */
  fallback?: string;
  /** Alternate-account settings keyed by adapter id. */
  accounts?: Record<string, AcrAccountConfig>;
}

export function acrConfigDir(): string {
  return path.join(os.homedir(), ".acr");
}

export function acrConfigPath(): string {
  return path.join(acrConfigDir(), "config.json");
}

/** Read the user config, returning an empty object if none exists or it is invalid. */
export function loadAcrConfig(): AcrConfig {
  const file = acrConfigPath();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as AcrConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveAcrConfig(config: AcrConfig): void {
  const dir = acrConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(acrConfigPath(), `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600
  });
}

/**
 * Build the env overrides for an alternate adapter, combining saved config with
 * environment variables. Environment variables win so power users can override
 * a saved account for a single run.
 *
 * `homeKey` is the env var the vendor reads for its config dir: HOME for Claude,
 * CODEX_HOME for Codex.
 */
export function accountEnvOverrides(
  account: AcrAccountConfig | undefined,
  envHome: string | undefined,
  envApiKey: string | undefined,
  envBaseUrl: string | undefined,
  homeKey: string,
  apiKeyKey: string,
  baseUrlKey: string
): Record<string, string | undefined> {
  return {
    [homeKey]: envHome ?? account?.home,
    [apiKeyKey]: envApiKey ?? account?.apiKey,
    [baseUrlKey]: envBaseUrl ?? account?.baseUrl
  };
}
