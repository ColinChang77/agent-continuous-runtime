import { execFile } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  sha256,
  type CommitSummary,
  type DiffSummary,
  type RepositoryInspector,
  type RepositorySnapshot
} from "@acr/core";

const execFileAsync = promisify(execFile);

async function runGit(
  projectRoot: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, {
    cwd: projectRoot,
    encoding: "utf8"
  });
}

async function isGitRepository(projectRoot: string): Promise<boolean> {
  try {
    const result = await runGit(projectRoot, [
      "rev-parse",
      "--is-inside-work-tree"
    ]);
    return result.stdout.trim() === "true";
  } catch {
    return false;
  }
}

function parseStatusText(statusText: string): {
  stagedPaths: string[];
  unstagedPaths: string[];
  untrackedPaths: string[];
} {
  const stagedPaths: string[] = [];
  const unstagedPaths: string[] = [];
  const untrackedPaths: string[] = [];

  for (const line of statusText.split("\n")) {
    if (
      !line.startsWith("1 ") &&
      !line.startsWith("2 ") &&
      !line.startsWith("? ")
    ) {
      continue;
    }

    if (line.startsWith("? ")) {
      const untracked = line.slice(2).trim();
      if (untracked) untrackedPaths.push(untracked);
      continue;
    }

    const parts = line.split(" ");
    const xy = parts[1] ?? "..";
    const filePath = parts.at(-1) ?? "";
    if (!filePath) continue;

    if (xy[0] && xy[0] !== ".") stagedPaths.push(filePath);
    if (xy[1] && xy[1] !== ".") unstagedPaths.push(filePath);
  }

  return { stagedPaths, unstagedPaths, untrackedPaths };
}

async function fingerprintUntrackedFiles(projectRoot: string): Promise<string> {
  const { stdout } = await runGit(projectRoot, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ".",
    ":(exclude).agent/**",
    ":(exclude).acr/**"
  ]);
  const relativePaths = stdout.split("\0").filter(Boolean).sort();
  const fingerprints = await Promise.all(
    relativePaths.map(async (relativePath) => {
      const absolutePath = path.join(projectRoot, relativePath);
      const fileStat = await lstat(absolutePath);
      const content = fileStat.isSymbolicLink()
        ? Buffer.from(`symlink:${await readlink(absolutePath)}`)
        : await readFile(absolutePath);
      const digest = createHash("sha256").update(content).digest("hex");
      return `${relativePath}\0${digest}`;
    })
  );
  return fingerprints.join("\n");
}

export class GitRepositoryInspector implements RepositoryInspector {
  async inspect(projectRoot: string): Promise<RepositorySnapshot> {
    const capturedAt = new Date().toISOString();
    if (!(await isGitRepository(projectRoot))) {
      return {
        projectRoot,
        isGitRepository: false,
        head: null,
        branch: null,
        isDirty: false,
        stagedPaths: [],
        unstagedPaths: [],
        untrackedPaths: [],
        statusText: "",
        diffStat: "",
        capturedAt
      };
    }

    const [headResult, branchResult, statusResult, diffStatResult] =
      await Promise.all([
        runGit(projectRoot, ["rev-parse", "HEAD"]),
        runGit(projectRoot, ["branch", "--show-current"]),
        runGit(projectRoot, [
          "status",
          "--porcelain=v2",
          "--untracked-files=all"
        ]),
        runGit(projectRoot, ["diff", "--stat"])
      ]);

    const parsedStatus = parseStatusText(statusResult.stdout);

    return {
      projectRoot,
      isGitRepository: true,
      head: headResult.stdout.trim() || null,
      branch: branchResult.stdout.trim() || null,
      isDirty:
        parsedStatus.stagedPaths.length > 0 ||
        parsedStatus.unstagedPaths.length > 0 ||
        parsedStatus.untrackedPaths.length > 0,
      stagedPaths: parsedStatus.stagedPaths,
      unstagedPaths: parsedStatus.unstagedPaths,
      untrackedPaths: parsedStatus.untrackedPaths,
      statusText: statusResult.stdout,
      diffStat: diffStatResult.stdout,
      capturedAt
    };
  }

  async diff(projectRoot: string): Promise<DiffSummary> {
    if (!(await isGitRepository(projectRoot))) {
      return { files: [], text: "" };
    }

    const continuityExclusions = [
      "--",
      ".",
      ":(exclude).agent/**",
      ":(exclude).acr/**"
    ];
    const [namesResult, contentResult, untrackedFingerprints] =
      await Promise.all([
        runGit(projectRoot, [
          "diff",
          "HEAD",
          "--name-status",
          ...continuityExclusions
        ]),
        runGit(projectRoot, [
          "diff",
          "HEAD",
          "--binary",
          "--no-ext-diff",
          ...continuityExclusions
        ]),
        fingerprintUntrackedFiles(projectRoot)
      ]);
    const files = namesResult.stdout
      .split("\n")
      .map((line) => line.trim().split(/\s+/).at(-1) ?? "")
      .filter(Boolean);
    const text = [contentResult.stdout, untrackedFingerprints]
      .filter(Boolean)
      .join("\n# ACR untracked file fingerprints\n");
    return { files, text };
  }

  async recentHistory(
    projectRoot: string,
    limit: number
  ): Promise<CommitSummary[]> {
    if (!(await isGitRepository(projectRoot))) {
      return [];
    }

    const { stdout } = await runGit(projectRoot, [
      "log",
      `-n`,
      String(limit),
      "--format=%H%x09%s"
    ]);
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, subject] = line.split("\t");
        return {
          sha: sha ?? "",
          subject: subject ?? ""
        };
      });
  }
}

export function createRepositoryInspector(): RepositoryInspector {
  return new GitRepositoryInspector();
}

export function createStatusDigest(snapshot: RepositorySnapshot): string {
  return sha256(
    JSON.stringify({
      head: snapshot.head,
      branch: snapshot.branch,
      stagedPaths: snapshot.stagedPaths,
      unstagedPaths: snapshot.unstagedPaths,
      untrackedPaths: snapshot.untrackedPaths
    })
  );
}

export function createDiffDigest(diff: DiffSummary): string | null {
  return diff.text ? sha256(diff.text) : null;
}
