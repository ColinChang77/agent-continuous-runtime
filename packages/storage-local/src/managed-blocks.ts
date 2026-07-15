const beginMarker = "<!-- ACR:BEGIN -->";
const endMarker = "<!-- ACR:END -->";

function countOccurrences(input: string, token: string): number {
  return input.split(token).length - 1;
}

export function renderAgentsManagedBlock(): string {
  return [
    beginMarker,
    "Inspect `.agent/` continuity state before working.",
    "Inspect the actual working tree before trusting stored state.",
    "Call or emulate resume before making edits.",
    "Avoid destructive Git commands or history rewrites.",
    "Update continuity state after meaningful work.",
    "Validate evidence before claiming completion.",
    endMarker
  ].join("\n");
}

export function renderClaudeManagedBlock(): string {
  return [
    beginMarker,
    "Follow the root `AGENTS.md` instructions first.",
    "Read `.agent/` continuity files and inspect the working tree before editing.",
    "Avoid destructive Git commands.",
    "Update continuity state after meaningful work and before completion claims.",
    endMarker
  ].join("\n");
}

export function mergeManagedBlock(
  original: string,
  block: string
): { content: string; duplicateBlocks: boolean } {
  const duplicateBlocks =
    countOccurrences(original, beginMarker) > 1 ||
    countOccurrences(original, endMarker) > 1;

  const pattern = new RegExp(`${beginMarker}[\\s\\S]*?${endMarker}`, "m");
  if (pattern.test(original)) {
    return {
      content: original.replace(pattern, block),
      duplicateBlocks
    };
  }

  const trimmed = original.trimEnd();
  const separator = trimmed.length === 0 ? "" : "\n\n";
  return {
    content: `${trimmed}${separator}${block}\n`,
    duplicateBlocks
  };
}

export function validateManagedBlock(input: string): string[] {
  const beginCount = countOccurrences(input, beginMarker);
  const endCount = countOccurrences(input, endMarker);
  const issues: string[] = [];

  if (beginCount !== endCount) {
    issues.push("Managed instruction block markers are unbalanced.");
  }

  if (beginCount > 1 || endCount > 1) {
    issues.push("Managed instruction file contains duplicate ACR blocks.");
  }

  return issues;
}
