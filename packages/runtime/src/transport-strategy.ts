import { Buffer } from "node:buffer";
import { spawn, type ChildProcess } from "node:child_process";

import pty from "node-pty";

import type { LaunchSpec, TransportMode } from "@acr/core";

import type { ProcessResult, ProcessRunHooks } from "./process-runner.js";

export interface TransportStrategy {
  readonly mode: TransportMode;
  run(spec: LaunchSpec, hooks?: ProcessRunHooks): Promise<ProcessResult>;
  terminate(reason: string): Promise<void>;
}

export class PtyTransportStrategy implements TransportStrategy {
  readonly mode = "pty" as const;
  private child: pty.IPty | null = null;

  async run(spec: LaunchSpec, hooks?: ProcessRunHooks): Promise<ProcessResult> {
    return new Promise<ProcessResult>((resolve, reject) => {
      const output: string[] = [];
      try {
        this.child = pty.spawn(spec.command, spec.args, {
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

      hooks?.onTransportSelected?.(this.mode);
      hooks?.onStarted?.(this.child.pid ?? null, this.mode);

      this.child.onData((chunk) => {
        output.push(chunk);
        hooks?.onOutput?.("stdout", chunk);
        process.stdout.write(chunk);
      });

      this.child.onExit(({ exitCode, signal }) => {
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
