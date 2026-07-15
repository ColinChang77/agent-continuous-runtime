import { realpath } from "node:fs/promises";
import path from "node:path";

import { AcrToolError } from "./errors.js";

export async function canonicalizePath(inputPath: string): Promise<string> {
  return realpath(inputPath);
}

export async function ensureAllowedRoot(
  inputPath: string,
  allowedRoots: string[]
): Promise<string> {
  if (!path.isAbsolute(inputPath)) {
    throw new AcrToolError(
      "ACR_INVALID_INPUT",
      "projectRoot must be an absolute path."
    );
  }

  const resolved = await canonicalizePath(inputPath);
  const normalizedAllowedRoots = await Promise.all(
    allowedRoots.map((root) => canonicalizePath(root))
  );

  const isAllowed = normalizedAllowedRoots.some((root) => {
    const relative = path.relative(root, resolved);
    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  });

  if (!isAllowed) {
    throw new AcrToolError(
      "ACR_PATH_OUTSIDE_ROOT",
      `Path is outside the configured roots: ${inputPath}`,
      {
        projectRoot: inputPath
      }
    );
  }

  return resolved;
}
