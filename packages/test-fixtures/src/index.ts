import { schemaVersion, sha256 } from "@acr/core";

export function createFixtureFingerprint(input: string): string {
  return `${schemaVersion}:${sha256(input)}`;
}
