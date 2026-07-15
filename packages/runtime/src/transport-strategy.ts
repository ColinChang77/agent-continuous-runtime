import { Buffer } from "node:buffer";
import { spawn, type ChildProcess } from "node:child_process";

// node-pty is a native module. Import only its TYPES statically (fully erased at
// compile time, so no `require` is emitted) and load the implementation lazily
// inside run(). This lets ACR ship as a single executable or run on Node
// versions without a prebuilt binding: if the load fails, the error propagates
// to StrategyProcessRunner, which falls back to attached mode.
import type { IPty } from "node-pty";

import type { LaunchSpec, TransportMode } from "@acr/core";

import type { ProcessResult, ProcessRunHooks } from "./process-runner.js";

export interface TransportStrategy {
  readonly mode: TransportMode;
  run(spec: LaunchSpec, hooks?: ProcessRunHooks): Promise<ProcessResult>;
  terminate(reason: string): Promise<void>;
}

export class PtyTransportStrategy implements TransportStrategy {
  readonly mode = "pty" as const;
  private child: IPty | null = null;

  async run(spec: LaunchSpec, hooks?: ProcessRunHooks): Promise<ProcessResult> {
    // Load the native binding on demand. A missing/incompatible binary throws
    // here and StrategyProcessRunner falls back to the next transport.
    const pty = (await import("node-pty")).default;
    return new Promise<ProcessResult>((resolve, reject) => {
      const output: string[] = [];
      let child: IPty;
      try {
        child = pty.spawn(spec.command, spec.args, {
          cwd: spec.cwd,
          env: spec.env,
          name: "xterm-color",
          cols: process.stdout.columns || 80,
          rows: process.stdout.rows || 24
        });
      } catch (error) {
        reject(error);
        return;
      }
      this.child = child;

      hooks?.onTransportSelected?.(this.mode);
      hooks?.onStarted?.(child.pid ?? null, this.mode);

      child.onData((chunk) => {
        output.push(chunk);
        hooks?.onOutput?.("stdout", chunk);
        process.stdout.write(chunk);
      });

      // Interactive passthrough: forward the user's keystrokes to the agent and
      // keep the agent's view sized to the terminal. Only engage when stdin is a
      // TTY so non-interactive/test runs are unaffected.
      const stdin = process.stdin;
      const interactive = Boolean(stdin.isTTY);
      const onInput = (data: Buffer) => child.write(data.toString("utf8"));
      const onResize = () => {
        try {
          child.resize(process.stdout.columns || 80, process.stdout.rows || 24);
        } catch {
          // The child may have already exited; ignore late resize events.
        }
      };

      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        stdin.removeListener("data", onInput);
        process.stdout.removeListener("resize", onResize);
        if (interactive && stdin.isTTY) {
          try {
            stdin.setRawMode(false);
          } catch {
            // Restoring cooked mode is best-effort.
          }
        }
        // Release stdin so the parent CLI regains control after the session.
        stdin.pause();
      };

      if (interactive) {
        try {
          stdin.setRawMode(true);
        } catch {
          // Raw mode may be unavailable in some terminals; typing still works.
        }
        stdin.resume();
        stdin.on("data", onInput);
        process.stdout.on("resize", onResize);
      }

      child.onExit(({ exitCode, signal }) => {
        cleanup();
        this.child = null;
        hooks?.onExit?.(exitCode, signal === 0 ? null : String(signal));
        resolve({
          exitCode,
          signal: signal === 0 ? null : String(signal),
          stdout: output.join("").slice(-64000),
          stderr: "",
          output: output.join("").slice(-64000),
          transport: this.mode
        });
      });
    });
  }

  async terminate(reason: string): Promise<void> {
    void reason;
    this.child?.kill("SIGINT");
  }
}

/**
 * Fully attach the agent to the parent's real terminal (stdio: "inherit").
 *
 * This works on any Node version and platform with no native dependency, so it
 * is the portable interactive fallback when a PTY is unavailable. The trade-off
 * is that ACR cannot read the agent's output here, so termination is classified
 * from the exit code/signal alone (no reading of "usage limit" text). Automatic
 * usage-limit failover is therefore reduced; manual `acr switch` still works.
 */
export class InheritTransportStrategy implements TransportStrategy {
  readonly mode = "spawn" as const;
  private child: ChildProcess | null = null;

  async run(spec: LaunchSpec, hooks?: ProcessRunHooks): Promise<ProcessResult> {
    return new Promise<ProcessResult>((resolve, reject) => {
      const child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        stdio: "inherit"
      });
      this.child = child;
      child.on("error", reject);
      hooks?.onTransportSelected?.(this.mode);
      hooks?.onStarted?.(child.pid ?? null, this.mode);

      child.on("exit", (exitCode, signal) => {
        this.child = null;
        hooks?.onExit?.(exitCode, signal);
        resolve({
          exitCode,
          signal,
          stdout: "",
          stderr: "",
          // No capture in attached mode; classification uses exit code/signal.
          output: "",
          transport: this.mode
        });
      });
    });
  }

  async terminate(reason: string): Promise<void> {
    void reason;
    this.child?.kill("SIGINT");
  }
}

export class StdioTransportStrategy implements TransportStrategy {
  readonly mode = "stdio" as const;
  private child: ChildProcess | null = null;

  async run(spec: LaunchSpec, hooks?: ProcessRunHooks): Promise<ProcessResult> {
    return new Promise<ProcessResult>((resolve, reject) => {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        stdio: ["inherit", "pipe", "pipe"]
      });
      this.child = child;
      child.on("error", reject);
      hooks?.onTransportSelected?.(this.mode);
      hooks?.onStarted?.(child.pid ?? null, this.mode);

      child.stdout?.on("data", (chunk: Uint8Array) => {
        const text = Buffer.from(chunk).toString("utf8");
        stdout.push(text);
        hooks?.onOutput?.("stdout", text);
        process.stdout.write(text);
      });
      child.stderr?.on("data", (chunk: Uint8Array) => {
        const text = Buffer.from(chunk).toString("utf8");
        stderr.push(text);
        hooks?.onOutput?.("stderr", text);
        process.stderr.write(text);
      });
      child.on("exit", (exitCode, signal) => {
        this.child = null;
        hooks?.onExit?.(exitCode, signal);
        const boundedStdout = stdout.join("").slice(-64000);
        const boundedStderr = stderr.join("").slice(-64000);
        resolve({
          exitCode,
          signal,
          stdout: boundedStdout,
          stderr: boundedStderr,
          output: [boundedStdout, boundedStderr].filter(Boolean).join("\n"),
          transport: this.mode
        });
      });
    });
  }

  async terminate(reason: string): Promise<void> {
    void reason;
    this.child?.kill("SIGINT");
  }
}
