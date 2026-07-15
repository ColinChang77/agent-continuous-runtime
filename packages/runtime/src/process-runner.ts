import type { LaunchSpec, TransportMode } from "@acr/core";

import {
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

export class StrategyProcessRunner implements ProcessRunner {
  private activeStrategy: TransportStrategy | null = null;

  constructor(
    private readonly strategies: TransportStrategy[] = [
      new PtyTransportStrategy(),
      new StdioTransportStrategy()
    ]
  ) {}

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
            "[acr] PTY transport unavailable (node-pty could not start); " +
              "falling back to non-interactive mode. Interactive agent TUIs " +
              "(Claude/Codex) need a working PTY — use Node 22 LTS, where " +
              "node-pty is supported.\n"
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
