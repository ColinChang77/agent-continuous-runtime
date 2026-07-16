import type { LaunchSpec, TransportMode } from "@acr/core";

import {
  InheritTransportStrategy,
  PtyTransportStrategy,
  StdioTransportStrategy,
  type TransportStrategy
} from "./transport-strategy.js";

export interface ProcessResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  output: string;
  transport: TransportMode;
}

export interface ProcessRunHooks {
  onTransportSelected?(mode: TransportMode): void;
  onStarted?(pid: number | null, mode: TransportMode): void;
  onOutput?(stream: "stdout" | "stderr", text: string): void;
  onExit?(exitCode: number | null, signal: string | null): void;
}

export interface ProcessRunner {
  run(spec: LaunchSpec, hooks?: ProcessRunHooks): Promise<ProcessResult>;
  terminate(reason: string): Promise<void>;
}

/**
 * Choose transport strategies by whether this is a real interactive terminal.
 *
 * - Interactive (a TTY on both stdin and stdout): prefer a PTY for the full
 *   experience, then fall back to fully attaching the terminal (Inherit) so the
 *   agent TUI still works even without node-pty, then Stdio as a last resort.
 * - Non-interactive (piped/headless/CI): prefer Stdio. There is no terminal to
 *   emulate, so a PTY adds no benefit here (its interactive passthrough/resizing
 *   are inert when stdin is not a TTY) while carrying the native node-pty
 *   dependency. On some platforms (e.g. Windows ConPTY on non-LTS Node builds)
 *   node-pty spawns but the child aborts natively, which would otherwise mask the
 *   agent's real exit code. Stdio captures stdout+stderr reliably with no native
 *   dependency; PTY remains as a fallback.
 */
export function defaultTransportStrategies(): TransportStrategy[] {
  const interactive = Boolean(process.stdout.isTTY && process.stdin.isTTY);
  return interactive
    ? [
        new PtyTransportStrategy(),
        new InheritTransportStrategy(),
        new StdioTransportStrategy()
      ]
    : [new StdioTransportStrategy(), new PtyTransportStrategy()];
}

export class StrategyProcessRunner implements ProcessRunner {
  private activeStrategy: TransportStrategy | null = null;
  private readonly strategies: TransportStrategy[];

  constructor(strategies: TransportStrategy[] = defaultTransportStrategies()) {
    this.strategies = strategies;
  }

  async run(spec: LaunchSpec, hooks?: ProcessRunHooks): Promise<ProcessResult> {
    let lastError: unknown = null;
    for (const strategy of this.strategies) {
      try {
        this.activeStrategy = strategy;
        const result = await strategy.run(spec, hooks);
        this.activeStrategy = null;
        return result;
      } catch (error) {
        lastError = error;
        if (strategy.mode === "pty") {
          process.stderr.write(
            "[acr] PTY unavailable (node-pty could not start); falling back to " +
              "attached mode. Interactive agent TUIs still work, but automatic " +
              "usage-limit detection is reduced (use `acr switch` to hand off " +
              "manually). For full auto-failover use Node 22 LTS.\n"
          );
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("No transport strategy could launch the process.");
  }

  async terminate(reason: string): Promise<void> {
    await this.activeStrategy?.terminate(reason);
  }
}

export function createProcessRunner(): ProcessRunner {
  return new StrategyProcessRunner();
}
