import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { currentStateSchema } from "@acr/core";

import { validateManagedBlock } from "./managed-blocks.js";
import {
  agentDir,
  checkpointsDir,
  currentStatePath,
  documentNames
} from "./paths.js";

export interface ValidationIssue {
  severity: "error" | "warning";
  message: string;
}

export async function validateProjectState(
  projectRoot: string
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const agentRoot = agentDir(projectRoot);
  const filesToCheck = [
    "schema-version",
    "CURRENT_STATE.json",
    ...documentNames,
    "checkpoints",
    "snapshots",
    "locks"
  ];

  for (const entry of filesToCheck) {
    try {
      await access(path.join(agentRoot, entry));
    } catch {
      issues.push({
        severity: "error",
        message: `Missing required .agent entry: ${entry}`
      });
    }
  }

  try {
    const raw = await readFile(currentStatePath(projectRoot), "utf8");
    currentStateSchema.parse(JSON.parse(raw));
  } catch (error) {
    issues.push({
      severity: "error",
      message: `CURRENT_STATE.json is invalid: ${String(error)}`
    });
  }

  for (const fileName of ["AGENTS.md", "CLAUDE.md"] as const) {
    try {
      const content = await readFile(path.join(projectRoot, fileName), "utf8");
      for (const message of validateManagedBlock(content)) {
        issues.push({
          severity: "warning",
          message: `${fileName}: ${message}`
        });
      }
    } catch {
      issues.push({
        severity: "warning",
        message: `${fileName} is missing.`
      });
    }
  }

  try {
    const entries = await readdir(checkpointsDir(projectRoot), {
      withFileTypes: true
    });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        issues.push({
          severity: "warning",
          message: `Unexpected non-directory inside checkpoints: ${entry.name}`
        });
      }
    }
  } catch {
    issues.push({
      severity: "error",
      message: "Checkpoint directory is unreadable."
    });
  }

  return issues;
}
