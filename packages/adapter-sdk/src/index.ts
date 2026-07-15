import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type {
  AgentAdapter,
  AgentCapabilities,
  FailureClassification,
  InstallationStatus,
  LaunchInput as AgentLaunchRequest,
  ResumeInstructionInput as AgentResumeRequest
} from "@acr/core";
export type {
  AgentHealth,
  AgentPlugin,
  AgentPluginManifest,
  AdapterConfigurationSchema,
  RuntimeEvent,
  TransportMode
} from "@acr/core";

const execFileAsync = promisify(execFile);

export async function detectExecutableInstallation(
  command: string,
  args: string[] = ["--version"]
) {
  try {
    const result = await execFileAsync(command, args, {
      encoding: "utf8"
    });
    const details = result.stdout.trim() || result.stderr.trim();
    return {
      installed: true,
      executablePath: command,
      details,
      ...(details ? { version: details } : {}),
      authenticated: "unknown" as const
    };
  } catch {
    return {
      installed: false,
      executablePath: null,
      details: `${command} not found`,
      authenticated: "unknown" as const
    };
  }
}

export function safeArgs(
  ...values: Array<string | undefined | null>
): string[] {
  return values.filter((value): value is string => {
    return typeof value === "string" && value.length > 0;
  });
}

export function allowEnv(
  source: Record<string, string | undefined>,
  keys: string[]
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}
